import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { MAP_ART } from "./src/game/map-art";
import { simHash } from "./tools/arena/files";

/**
 * Each map's terrain revision: a hash of its painted chunks (art/terrain.py
 * writes a folder of them per map). The game asks for `t_C_R.webp?v=<revision>`
 * (src/game/map-art.ts), so the cache-first map cache below never serves a
 * repainted map's old chunks, while maps that weren't repainted stay cached.
 */
function terrainRevisions(): Record<string, string> {
  const dir = fileURLToPath(new URL("public/assets/maps", import.meta.url));
  const revs: Record<string, string> = {};
  for (const map of readdirSync(dir, { withFileTypes: true })) {
    if (!map.isDirectory()) continue;
    const hash = createHash("sha256");
    for (const f of readdirSync(join(dir, map.name)).filter((f) => /^t_\d+_\d+\.webp$/.test(f)).sort())
      hash.update(f).update(readFileSync(join(dir, map.name, f)));
    revs[map.name] = hash.digest("hex").slice(0, 12);
  }
  return revs;
}

/**
 * The showcase battle records (battles/showcase/) go out with the build, at
 * the same path, so the game's `?replay=` links and the record viewer
 * (record-viewer.html) can link to them. The dev server serves them from the
 * project root already. (Not precached: they're fetched only when watched.)
 */
function showcaseBattles(): Plugin {
  const dir = fileURLToPath(new URL("battles/showcase", import.meta.url));
  return {
    name: "showcase-battles",
    apply: "build",
    generateBundle() {
      for (const f of readdirSync(dir).filter((f) => f.endsWith(".json")))
        this.emitFile({ type: "asset", fileName: `battles/showcase/${f}`, source: readFileSync(join(dir, f)) });
    }
  };
}

export default defineConfig({
  // Local builds are portable; Pages supplies an absolute base for each version.
  base: "./",
  server: { host: true },
  define: {
    __TERRAIN_REVS__: JSON.stringify(terrainRevisions()),
    // the sim this build plays: the battle viewer warns when a record was played by other code
    __SIM_HASH__: JSON.stringify(simHash(fileURLToPath(new URL(".", import.meta.url))))
  },
  build: {
    target: "es2022",
    outDir: "dist",
    chunkSizeWarningLimit: 1600,
    // the engine in its own chunk: game updates don't re-download three.js
    rollupOptions: {
      // the game, plus the standalone vehicles reference page and battle record viewer
      input: { main: "index.html", vehicles: "vehicles.html", records: "record-viewer.html" },
      output: { manualChunks: { three: ["three"] } }
    }
  },
  plugins: [
    showcaseBattles(),
    VitePWA({
      registerType: "autoUpdate",
      // precache the shell, icons and menu art; painted map terrain
      // (a few MB per map) and each biome's rock material are cached on
      // first play instead
      includeAssets: ["assets/icons/*", "assets/ui/*", "assets/maps/*/thumb.webp", "icons/*"],
      workbox: {
        // There are no client-side routes. Exact precached URLs still work
        // offline, but /v1/ etc. must reach their own game and service worker.
        navigateFallback: null,
        globPatterns: ["**/*.{js,css,html}"],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        runtimeCaching: [
          {
            urlPattern: MAP_ART,
            handler: "CacheFirst",
            options: { cacheName: "battledrones-maps", expiration: { maxEntries: 120 } }
          },
          {
            // (served from the cache, refreshed behind it: a re-tuned texture reaches players next game)
            urlPattern: /\/assets\/textures\/.*\.webp$/,
            handler: "StaleWhileRevalidate",
            options: { cacheName: "battledrones-textures", expiration: { maxEntries: 16 } }
          }
        ]
      },
      manifest: {
        name: "Battle Drones",
        short_name: "BattleDrones",
        description:
          "A mobile RTS: two armies of flying and ground drones battle for territory and resources.",
        display: "fullscreen",
        orientation: "any",
        background_color: "#070a10",
        theme_color: "#070a10",
        icons: [
          // recent iOS reads the Home Screen icon from here too: PNG only, opaque
          { src: "icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
          { src: "icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "icons/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "icons/icon-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable"
          }
        ]
      }
    })
  ]
});
