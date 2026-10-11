import { DIFFICULTY, type Difficulty } from "./sim/ai/commander";
import { MAPS, mapById } from "./sim/maps";
import { sfx } from "./game/audio";
import { music } from "./game/music";
import { loadTerrainArt, mapAssetBase } from "./game/assets";
import { GameScene, type MatchFeed } from "./game/GameScene";
import { gameMode, loadSettings, saveSettings, type GameType } from "./game/mode";
import { loadBest } from "./game/survival";
import { HELP_HTML } from "./ui/hud";
import { mountMenuCareer, starsText } from "./ui/career";
import { dailyOp, today, type DailyOp } from "./game/daily";
import { opById, type OpDef } from "./sim/ops";
import type { MutatorId } from "./sim/rules";
import { mountMenuOps } from "./ui/ops";
import { fullscreen } from "./ui/fullscreen";
import { appUpdate, mountUpdatePill } from "./ui/update";
import { scrollCue } from "./ui/hscroll";
import { showReplayPicker } from "./ui/replay-picker";

document.addEventListener("contextmenu", (e) => e.preventDefault());

// iOS Safari ignores user-scalable=no: pinch zooms the PAGE (scaling the
// HUD with it) and offers no way back. Kill browser zoom at the source —
// the game camera handles all zooming.
for (const type of ["gesturestart", "gesturechange", "gestureend"])
  document.addEventListener(type, (e) => e.preventDefault(), { passive: false });
document.addEventListener(
  "touchmove",
  (e) => {
    // (only iOS has a pinch scale; elsewhere it's undefined, and an uncancelable
    // move — a scroll already under way — just logs an intervention)
    const scale = (e as TouchEvent & { scale?: number }).scale;
    if (e.cancelable && typeof scale === "number" && scale !== 1) e.preventDefault();
  },
  { passive: false }
);
document.addEventListener("dblclick", (e) => e.preventDefault(), { passive: false });

// Safety net: if browser page-zoom happens anyway (iOS finds ways), show a
// rescue button pinned inside the VISUAL viewport (fixed-position elements
// live in the layout viewport and can be off-screen while zoomed).
function setupPageZoomRescue(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const btn = document.createElement("button");
  btn.id = "unzoom";
  btn.textContent = "⤺ Zoom back out";
  btn.hidden = true;
  document.body.appendChild(btn);

  const place = () => {
    const zoomed = vv.scale > 1.05;
    btn.hidden = !zoomed;
    if (!zoomed) return;
    const s = 1 / vv.scale;
    btn.style.left = `${vv.offsetLeft}px`;
    btn.style.top = `${vv.offsetTop + vv.height - 56 * s}px`;
    btn.style.width = `${vv.width}px`;
    btn.style.height = `${56 * s}px`;
    btn.style.fontSize = `${17 * s}px`;
  };
  vv.addEventListener("resize", place);
  vv.addEventListener("scroll", place);
  place();

  btn.addEventListener("click", () => {
    // rewriting the viewport meta forces Safari to re-clamp scale to 1
    const meta = document.querySelector<HTMLMetaElement>("meta[name=viewport]");
    if (!meta) return;
    const content = meta.content;
    meta.content = "width=device-width, initial-scale=1.0, maximum-scale=1.0";
    requestAnimationFrame(() => {
      meta.content = content;
      place();
    });
  });
}
setupPageZoomRescue();
// a rematch or Menu reload dropped full screen: ask again on the first tap
fullscreen.restoreOnGesture();
// a new build: the menu offers to reload into it (ui/update.ts)
appUpdate.watch();

/** Render at device resolution (capped at 2× for phone GPUs) for crisp art. */
const dpr = () => Math.min(2, Math.max(1, window.devicePixelRatio || 1));

async function startGame(feed?: MatchFeed): Promise<void> {
  const hud = document.getElementById("hud")!;
  const loading = document.createElement("div");
  loading.id = "loading";
  loading.className = "screen";
  loading.innerHTML = `<div class="loadbox"><p>Deploying to ${MAPS.find((m) => m.id === gameMode.mapId)?.name ?? "battlefield"}…</p><div class="loadtrack"><div id="loadbar"></div></div></div>`;
  hud.appendChild(loading);
  const bar = loading.querySelector<HTMLElement>("#loadbar");
  const def = mapById(gameMode.mapId);
  // the painted terrain is draped over the 3D landscape; a failed chunk falls back to flat colours
  const art = await loadTerrainArt(def.id, def.size, def.biome, (k) => {
    if (bar) bar.style.width = `${Math.round(k * 90)}%`;
  });
  if (bar) bar.style.width = "100%";
  // (let the full bar paint before the scene build blocks the main thread)
  await new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0)));
  const scene = new GameScene(document.getElementById("game")!, dpr(), art, feed);
  window.addEventListener("resize", () => scene.resize());
  window.addEventListener("orientationchange", () => setTimeout(() => scene.resize(), 200));
}

function showMenu(): void {
  loadSettings();
  const hud = document.getElementById("hud")!;
  const menu = document.createElement("div");
  menu.id = "splash";
  menu.className = "menu";
  const diffs = Object.keys(DIFFICULTY) as Difficulty[];
  menu.innerHTML = `
    <div class="keyart"></div>
    <button class="round menu-mute" id="menu-mute" title="Mute all">🔊</button>
    <div class="menu-inner">
      <h1 class="logo">BATTLE<br/><span>DRONES</span></h1>
      <div class="menu-side" id="menuside">
        <button class="rankbadge" id="rankbadge"></button>
        <div class="dailyop" id="dailyop"></div>
        <button class="mutbtn side"></button>
      </div>
      <p class="sub" id="sub"></p>
      <div class="seg modes" id="gmode">
        <button data-m="skirmish">⚔ Skirmish</button>
        <button data-m="survival">🛡 Last Stand</button>
        <button data-m="ops">🎖 Ops</button>
      </div>
      <p class="lsbest" id="lsbest" hidden></p>
      <p class="lsbest opsum" id="opsum" hidden></p>
      <div class="maps opcards" id="opcards" hidden></div>
      <p class="blurb opblurb" id="opblurb" hidden></p>
      <div class="maps" id="maps">
        ${MAPS.map(
          (m) => `
          <button class="mapcard" data-id="${m.id}">
            <img src="${mapAssetBase(m.id)}/thumb.webp" alt="" draggable="false" />
            <span class="mn">${m.name}</span>
            <span class="mb">${m.size}×${m.size} · ${m.biome}</span>
            <span class="mbest" hidden></span>
            <span class="mstars" hidden></span>
          </button>`
        ).join("")}
      </div>
      <p class="blurb" id="blurb"></p>
      <div class="seg" id="diff">
        ${diffs.map((d) => `<button data-d="${d}">${DIFFICULTY[d].label}</button>`).join("")}
      </div>
      <button class="mutbtn main"></button>
      <button class="cta big" id="play">▶ Play</button>
      <div class="row">
        <button class="cta alt" id="play-spectate">🤖 Watch AI vs AI</button>
        <button class="cta alt" id="play-replay">🎬 Watch a replay</button>
        <button class="cta alt" id="howto">? How to play</button>
      </div>
      <div class="help" id="helpbox" hidden>${HELP_HTML}</div>
      <p class="credits">Art generated with OpenAI gpt-image-2.5 · sound synthesised live</p>
    </div>
  `;
  hud.appendChild(menu);
  // inline, document-relative URLs keep GitHub Pages subpaths working
  const art = menu.querySelector<HTMLElement>(".keyart")!;
  const landscape = window.matchMedia("(orientation: landscape)");
  const setArt = () =>
    (art.style.backgroundImage = `url(assets/ui/keyart-${landscape.matches ? "landscape" : "portrait"}.webp)`);
  setArt();
  landscape.addEventListener("change", setArt);

  // menu music: a gentle take on the selected map's theme, from the first touch
  const biomeOf = (id: string) => MAPS.find((m) => m.id === id)?.biome ?? "temperate";
  sfx.unlockOnGesture();
  const muteBtn = menu.querySelector<HTMLButtonElement>("#menu-mute")!;
  const syncMute = () => (muteBtn.textContent = sfx.muted ? "🔇" : "🔊");
  syncMute();
  const offMute = sfx.onChange(syncMute);
  muteBtn.addEventListener("click", () => sfx.setMuted(!sfx.muted));
  const offUpdate = mountUpdatePill(menu);

  // career: rank badge, Daily Op card, mutator picker, map stars (ui/career.ts)
  const career = mountMenuCareer(menu, {
    playDaily: (op) => void begin(false, () => startDaily(op)),
    changed: () => saveSettings()
  });
  // Ops: op cards, progress line and the briefing sheet (ui/ops.ts)
  const ops = mountMenuOps(menu, {
    start: (op) => void begin(false, () => startOp(op)),
    selectedId: () => gameMode.opId,
    select: (id) => {
      gameMode.opId = id;
      saveSettings();
      sync(); // the Play button names the picked op
    }
  });
  /** Is this map offered in the mode picked (Last Stand isn't played on the island map)? */
  const offered = (id: string) => gameMode.mode !== "survival" || mapById(id).lastStand !== false;
  /** The map the menu shows and Play starts: the pick, or the first one offered in this mode. */
  const shownMap = () => (offered(gameMode.mapId) ? gameMode.mapId : MAPS.find((x) => offered(x.id))!.id);
  let menuBiome: string | null = null;
  // the map and Ops rows scroll sideways on phones: fade + chevrons say so
  const mapRow = scrollCue(menu.querySelector<HTMLElement>("#maps")!);
  scrollCue(menu.querySelector<HTMLElement>("#opcards")!);
  let revealed = "";
  const sync = () => {
    const survival = gameMode.mode === "survival";
    const opsMode = gameMode.mode === "ops";
    career.sync();
    for (const id of ["#opsum", "#opcards", "#opblurb"]) menu.querySelector<HTMLElement>(id)!.hidden = !opsMode;
    for (const id of ["#maps", "#blurb", "#diff"]) menu.querySelector<HTMLElement>(id)!.hidden = opsMode;
    ops.sync();
    menu.querySelector<HTMLElement>("#play-spectate")!.hidden = opsMode;
    menu.classList.toggle("ops-mode", opsMode);
    // Last Stand isn't offered on every map (the island map): show the first that is, without
    // losing the skirmish pick (Play points the match at the shown map: see begin)
    const shown = shownMap();
    menu.querySelectorAll<HTMLElement>("#maps .mapcard").forEach((el) => {
      el.hidden = !offered(el.dataset.id!);
      el.classList.toggle("on", el.dataset.id === shown);
      // Last Stand: each map card shows its best for the chosen difficulty
      const badge = el.querySelector<HTMLElement>(".mbest")!;
      const rec = survival ? loadBest(el.dataset.id!, gameMode.difficulty) : null;
      badge.hidden = !rec;
      badge.textContent = rec ? `🛡 ${rec.best}` : "";
      const stars = el.querySelector<HTMLElement>(".mstars")!;
      const mask = survival ? 0 : career.starsFor(el.dataset.id!);
      stars.hidden = survival;
      stars.textContent = starsText(mask);
      stars.classList.toggle("got", mask > 0);
    });
    // bring the picked map into view when the row first shows (or shows again)
    const pick = menu.querySelector<HTMLElement>(`#maps .mapcard[data-id="${shown}"]`);
    const key = opsMode ? "" : `${gameMode.mode}:${shown}`;
    if (key && key !== revealed && pick) {
      const smooth = revealed !== ""; // (opening the menu: already centred, no slide)
      requestAnimationFrame(() => mapRow.reveal(pick, smooth));
      revealed = key;
    }
    // the menu theme follows the map on show
    const biome = biomeOf(shown);
    if (biome !== menuBiome) {
      menuBiome = biome;
      music.play("menu", biome);
    }
    menu.querySelectorAll<HTMLElement>("#diff button").forEach((el) => el.classList.toggle("on", el.dataset.d === gameMode.difficulty));
    menu.querySelectorAll<HTMLElement>("#gmode button").forEach((el) => el.classList.toggle("on", el.dataset.m === gameMode.mode));
    const m = MAPS.find((x) => x.id === shown);
    menu.querySelector("#blurb")!.textContent = m?.blurb ?? "";
    menu.querySelector("#sub")!.textContent = opsMode
      ? "Short missions with a twist. Three stars each — can you take them all?"
      : survival
        ? "Hold your base against endless, themed waves. How long can you last?"
        : "Mine scrap. Build your swarm. Destroy the enemy HQ.";
    const best = menu.querySelector<HTMLElement>("#lsbest")!;
    best.hidden = !survival;
    if (survival) {
      const rec = loadBest(shown, gameMode.difficulty);
      const where = `${m?.name ?? "this map"} · ${DIFFICULTY[gameMode.difficulty].label}`;
      best.innerHTML = rec
        ? `🏆 Best on ${where}: <b>${rec.best} wave${rec.best === 1 ? "" : "s"}</b>`
        : `No record yet on ${where} — set one!`;
    }
    const sel = ops.selected();
    menu.querySelector("#play")!.textContent = opsMode
      ? ops.locked(sel) ? "🔒 Locked" : `▶ Op: ${sel.title}`
      : survival ? "▶ Start Last Stand" : "▶ Play";
    menu.querySelector("#play")!.classList.toggle("locked", opsMode && ops.locked(sel));
    menu.querySelector("#play-spectate")!.textContent = survival ? "🤖 Watch AI defend" : "🤖 Watch AI vs AI";
  };
  sync();
  menu.querySelectorAll<HTMLElement>("#maps .mapcard").forEach((el) =>
    el.addEventListener("click", () => {
      gameMode.mapId = el.dataset.id!;
      saveSettings();
      sync();
    })
  );
  menu.querySelectorAll<HTMLElement>("#diff button").forEach((el) =>
    el.addEventListener("click", () => {
      gameMode.difficulty = el.dataset.d as Difficulty;
      saveSettings();
      sync();
    })
  );
  menu.querySelectorAll<HTMLElement>("#gmode button").forEach((el) =>
    el.addEventListener("click", () => {
      gameMode.mode = el.dataset.m as GameType;
      sfx.play("click", 0.5);
      saveSettings();
      sync();
    })
  );
  menu.querySelector("#howto")!.addEventListener("click", () => {
    const h = menu.querySelector<HTMLElement>("#helpbox")!;
    h.hidden = !h.hidden;
  });

  // one match per page: a second tap while the full-screen request is
  // pending (Android takes a moment) must not boot a second game
  let starting = false;
  const begin = async (spectator: boolean, setup?: () => void, feed?: MatchFeed) => {
    if (starting) return;
    starting = true;
    // a Last Stand on a map it isn't offered on plays the shown one (not saved: the pick stays)
    if (!setup && !offered(gameMode.mapId)) gameMode.mapId = shownMap();
    setup?.(); // (the Daily Op / an op points the match at its map and rules)
    gameMode.spectator = spectator;
    sfx.unlock();
    sfx.play("click");
    await fullscreen.enter(); // (Android/desktop; iOS Safari's dvh layout covers it)
    offMute();
    offUpdate();
    menu.remove();
    void startGame(feed);
  };
  menu.querySelector("#play")!.addEventListener("click", () => {
    if (gameMode.mode !== "ops") return void begin(false);
    const op = ops.selected();
    sfx.play("click", 0.5);
    if (!ops.locked(op)) ops.openBrief(op);
  });
  menu.querySelector("#play-spectate")!.addEventListener("click", () => begin(true));
  // an agent battle's record, pasted or picked: the viewer loads only now (game/replay.ts)
  menu.querySelector("#play-replay")!.addEventListener("click", () => {
    sfx.play("click", 0.5);
    showReplayPicker(menu, async (json) => {
      const { replayFromJson } = await import("./game/replay");
      const feed = replayFromJson(json);
      await begin(true, () => watchSetup(feed), feed);
    });
  });

  // "Rematch" from the end screen skips straight back into a game
  let rematch = false;
  try {
    const token = sessionStorage.getItem("battledrones.rematch");
    const op = token?.startsWith("op:") ? opById(token.slice(3)) : null;
    rematch = token === "1" || token === "spectate" || token === "daily" || !!op;
    if (token === "spectate") gameMode.spectator = true; // another AI-vs-AI match
    if (token === "daily") startDaily(dailyOp(today()));
    if (op) startOp(op);
    sessionStorage.removeItem("battledrones.rematch");
  } catch {
    /* ignore */
  }
  if (rematch) {
    offMute();
    offUpdate();
    menu.remove();
    void startGame();
    // audio needs a gesture: sfx.unlockOnGesture() (above) starts it on the first touch
  }
}

/**
 * `/?replay=<record>`, in every build: fetch a battle record by its link
 * (relative to the game, any CORS-enabled URL, a file on GitHub or a Gist) and
 * watch it. Its Menu buttons leave the link behind (ui/fullscreen.ts).
 */
async function watchLinked(url: string, follow: boolean): Promise<void> {
  const note = document.createElement("div");
  note.className = "screen";
  note.innerHTML = `<div class="loadbox"><p>Fetching the battle record…</p></div>`;
  document.getElementById("hud")!.appendChild(note);
  const feed = await import("./game/replay")
    .then((m) => m.loadReplay(url, follow))
    .catch((e: unknown) => {
      note.innerHTML = `<div class="panel"><p class="time"></p><button class="cta">Main menu</button></div>`;
      note.querySelector("p")!.textContent = `Couldn't play that battle record. ${e instanceof Error ? e.message : String(e)}`;
      note.querySelector("button")!.addEventListener("click", () => location.assign("./"));
      return null;
    });
  if (!feed) return;
  note.remove();
  watchSetup(feed);
  sfx.unlockOnGesture(); // (no menu was tapped: the sound starts on the first touch)
  await startGame(feed);
}

/** Point the next match at a battle replay's map and rules (not saved: the player's own picks stay). */
function watchSetup(feed: { record: { map: string; mutators: MutatorId[] } }): void {
  Object.assign(gameMode, { mapId: feed.record.map, spectator: true, mode: "skirmish", mutators: feed.record.mutators, daily: null, op: null });
}

/** Point the next match at an op (not saved: the op fixes map, enemy and rules). */
function startOp(op: OpDef): void {
  // remember the pick (and the Ops tab) before the op's own map and difficulty take over
  gameMode.opId = op.id;
  gameMode.mode = "ops";
  saveSettings();
  gameMode.op = op;
  gameMode.mapId = op.map;
  gameMode.difficulty = op.ai && op.ai !== "survival" ? op.ai.difficulty : op.survival?.difficulty ?? "normal";
}

/** Point the next match at the Daily Op (not saved: the player's own picks stay). */
function startDaily(op: DailyOp): void {
  gameMode.daily = op;
  gameMode.mapId = op.mapId;
  gameMode.difficulty = op.difficulty;
  gameMode.mode = "skirmish";
}

// The battle viewer for agent battles (AGENT-BATTLES.md "Watching") by a record's link, in every build:
// /?replay=<record> (watchLinked). &follow, a live battle on the dev server, is dev-only: production builds
// drop it (import.meta.env.DEV is false there).
const params = new URLSearchParams(location.search);
const replayLink = params.get("replay")?.trim();
if (replayLink) void watchLinked(replayLink, import.meta.env.DEV && params.has("follow"));
else showMenu();
