// Plays a battle record in the battle viewer (AGENT-BATTLES.md "Watching")
// and checks the hash trail in the browser: the replay must match the battle
// the arena recorded (Chromium runs the same JavaScript engine as Node).
// Usage: node tools/arena-viewer-check.mjs battles/<file>.json [--paste] [--prod] [--shot out.png]
//   --paste  load it the way a player does: menu → "Watch a replay", paste the JSON (else by its link, /?replay=<file>)
//   --prod   against the production build in dist/ (npm run build first) instead of the dev server
//            (by link, only battles/showcase/ records: the build serves those)
// Starts its own Vite server on a free port.
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { relative, resolve } from "node:path";
import { chromium } from "playwright-core";

const file = process.argv[2];
if (!file) {
  console.error("usage: node tools/arena-viewer-check.mjs battles/<file>.json [--shot out.png]");
  process.exit(1);
}
const shotAt = process.argv.indexOf("--shot");
const shot = shotAt > 0 ? process.argv[shotAt + 1] : null;
const paste = process.argv.includes("--paste");
const prod = process.argv.includes("--prod");
const root = resolve(import.meta.dirname, "..");
const record = JSON.parse(readFileSync(file, "utf8"));
const ref = relative(root, resolve(file)).replaceAll("\\", "/");
const port = 5200 + Math.floor(Math.random() * 500);
const vite = spawn("npx", ["vite", ...(prod ? ["preview"] : []), "--port", String(port), "--strictPort"], { cwd: root, stdio: ["ignore", "pipe", "inherit"], detached: true });
await new Promise((ok) => vite.stdout.on("data", (d) => String(d).includes("Local") && ok()));
const exe = ["/opt/pw-browsers/chromium", "/opt/pw-browsers/chromium-1194/chrome-linux/chrome"].find((p) => existsSync(p));
const browser = await chromium.launch({ executablePath: exe, args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
let failed = false;
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  if (paste) {
    await page.goto(`http://localhost:${port}/`, { waitUntil: "networkidle" });
    await page.click("#play-replay");
    await page.fill("#replay-json", readFileSync(file, "utf8"));
    await page.click("#replay-go");
  } else await page.goto(`http://localhost:${port}/?replay=${encodeURIComponent(ref)}`, { waitUntil: "networkidle" });
  await page.waitForFunction(() => window.__replay && window.__bd?.world?.tick > 0, null, { timeout: 180_000 });
  // play it through: seek to the end (rendering off), checking every hash on the way
  const end = record.end?.tick ?? record.tick;
  const res = await page.evaluate((t) => {
    window.__bd.scene.seek(t);
    const f = window.__replay;
    return { tick: window.__bd.world.tick, winner: window.__bd.world.winner, divergedAt: f.divergedAt };
  }, end);
  if (shot) {
    await page.waitForTimeout(1500);
    await page.screenshot({ path: shot });
  }
  const want = record.end?.winner ?? null;
  console.log(`${file}: replayed in the browser to tick ${res.tick} (record: ${end}), winner ${res.winner ?? "none"} (record: ${want ?? "none"})`);
  if (res.divergedAt !== null) {
    console.log(`⚠ diverged at tick ${res.divergedAt}`);
    failed = true;
  } else console.log(`hash trail: ${record.hashes.filter(([t]) => t <= end).length} checks, all match`);
  if (res.tick !== end || res.winner !== want) failed = true;
  if (errors.length) {
    console.log("page errors:", errors);
    failed = true;
  }
} finally {
  await browser.close();
  process.kill(-vite.pid);
}
process.exit(failed ? 1 : 0);
