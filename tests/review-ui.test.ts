/**
 * Regressions from the adversarial review's UI / input / audio pass: the
 * engine-free halves of the fixes (the DOM halves are checked in a browser).
 */
import { afterEach, describe, expect, it, vi } from "vitest";


import { createMapWorld } from "../src/sim/maps";
import { OPS } from "../src/sim/ops";
import { TICK_RATE } from "../src/sim/balance";
import { THEME_COUNTERS } from "../src/sim/modes/survival";
import { onAnnounce, type Announcement } from "../src/game/announce";
import { SurvivalPresenter } from "../src/game/survival";
import { BattleCallouts, type RadioLine } from "../src/game/callouts";
import { finaleOutcome } from "../src/game/finale";
import { GestureRecognizer } from "../src/game/gestures";
import { gameMode, rematchToken } from "../src/game/mode";
import { UnitVoices } from "../src/game/voices";
import { dailyOp, today } from "../src/game/daily";
import { Fullscreen, reloadWithoutLink, type FullscreenEnv } from "../src/ui/fullscreen";

describe("a watched Last Stand ends on a lament", () => {
  it("resolves the score: fanfare for a win, a record or a watched skirmish; lament for a watched Last Stand", () => {
    const o = { won: false, newRecord: false, spectator: false, survival: false };
    expect(finaleOutcome({ ...o, won: true })).toBe("victory");
    expect(finaleOutcome(o)).toBe("defeat");
    expect(finaleOutcome({ ...o, survival: true, newRecord: true })).toBe("victory");
    expect(finaleOutcome({ ...o, survival: true })).toBe("defeat");
    expect(finaleOutcome({ ...o, spectator: true })).toBe("victory"); // AI vs AI: whoever won
    expect(finaleOutcome({ ...o, spectator: true, survival: true })).toBe("defeat"); // "Watch AI defend": overrun
  });

  it("the radio says the base was overrun, matching the banner", () => {
    const w = createMapWorld("riverlands", { seed: 7, survival: { difficulty: "normal" } });
    const radio: RadioLine[] = [];
    const c = new BattleCallouts({
      world: w, player: "blue", spectator: true, onScreen: () => false,
      radio: (l) => radio.push(l), announce: (_a: Announcement) => {}
    });
    w.winner = "red";
    c.events([], 300);
    expect(radio.at(-1)).toMatchObject({ key: "defeat", tone: "bad", text: "Base overrun. The HQ has fallen." });
  });
});

describe("Last Stand wave warnings", () => {
  it("say what beats the wave, wave 1 included (no 'cleared' banner names it before)", () => {
    const w = createMapWorld("riverlands", { seed: 7, survival: { difficulty: "normal" } });
    const p = new SurvivalPresenter(w, { mapId: "riverlands", difficulty: "normal", spectator: true, ping: () => {}, gfx: null });
    const seen: Announcement[] = [];
    const off = onAnnounce((a) => seen.push(a));
    try {
      p.handleFx({ type: "waveIncoming", wave: 1, theme: "swarm", name: "Bot Swarm", x: 50, y: 10, dir: "north-east", eta: 15 * TICK_RATE, early: 0 });
      p.handleFx({ type: "waveIncoming", wave: 3, theme: "air", name: "Air Raid", x: 50, y: 10, dir: "north", eta: 15 * TICK_RATE, early: 40 });
    } finally {
      off();
    }
    expect(seen.map((a) => a.sub)).toEqual([
      `🤖 Wave 1 from the north-east in 15 s — ${THEME_COUNTERS.swarm}`,
      `✈ Wave 3 from the north in 15 s · +40 scrap — ${THEME_COUNTERS.air}`
    ]);
  });
});

describe("a spectator's promotion keeps its chime", () => {
  it("unit voices never answer for a spectator, so the plain chime plays", () => {
    const v = new UnitVoices();
    expect(v.answers({ spectator: false })).toBe(false); // no audio engine yet: chimes
    (v as unknown as { e: object }).e = {}; // audio unlocked, Voice on (the default)
    expect(v.active).toBe(true);
    expect(v.answers({ spectator: false })).toBe(true); // the unit's voiced sparkle replaces the chime
    expect(v.answers({ spectator: true })).toBe(false); // spectators hear no unit voices: chime
  });
});

describe("rematch replays the same kind of match", () => {
  const saved = { ...gameMode };
  afterEach(() => Object.assign(gameMode, saved));

  it("an AI-vs-AI match rematches as another one; a watched Last Stand hands over", () => {
    Object.assign(gameMode, { spectator: false, mode: "skirmish", op: null, daily: null });
    expect(rematchToken()).toBe("1");
    gameMode.spectator = true;
    expect(rematchToken()).toBe("spectate");
    gameMode.mode = "survival"; // "Watch AI defend" → "▶ Your turn"
    expect(rematchToken()).toBe("1");
    Object.assign(gameMode, { spectator: false, mode: "skirmish", daily: dailyOp(today()) });
    expect(rematchToken()).toBe("daily");
    Object.assign(gameMode, { daily: null, op: OPS[0]! });
    expect(rematchToken()).toBe(`op:${OPS[0]!.id}`);
  });
});

/** A fake browser: a document that may be full screen, a window that dispatches, sessionStorage. */
function fakeEnv(opts: { api?: boolean; full?: boolean } = {}) {
  const store = new Map<string, string>();
  const listeners = new Map<string, Set<(e: Event) => void>>();
  const doc: FullscreenEnv["doc"] = {
    documentElement: {},
    fullscreenElement: opts.full ? ({} as Element) : null
  };
  const requests: FullscreenOptions[] = [];
  if (opts.api !== false)
    doc.documentElement.requestFullscreen = (o?: FullscreenOptions) => {
      requests.push(o ?? {});
      doc.fullscreenElement = {} as Element;
      return Promise.resolve();
    };
  let reloads = 0;
  const env: FullscreenEnv = {
    doc,
    win: {
      addEventListener: (type: string, fn: EventListenerOrEventListenerObject) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(fn as (e: Event) => void);
      },
      removeEventListener: (type: string, fn: EventListenerOrEventListenerObject) =>
        void listeners.get(type)?.delete(fn as (e: Event) => void)
    } as FullscreenEnv["win"],
    storage: {
      getItem: (k) => store.get(k) ?? null,
      setItem: (k, v) => void store.set(k, v),
      removeItem: (k) => void store.delete(k)
    },
    reload: () => void reloads++
  };
  const fire = (type: string, extra: Record<string, unknown> = {}) => {
    for (const fn of [...(listeners.get(type) ?? [])]) fn({ type, ...extra } as unknown as Event);
  };
  const count = () => [...listeners.values()].reduce((n, s) => n + s.size, 0);
  return { env, doc, store, requests, fire, count, reloads: () => reloads };
}

describe("full screen survives the reload-based flows", () => {
  it("a reload made while full screen asks again on the next page's first tap", async () => {
    const page1 = fakeEnv({ full: true });
    new Fullscreen(() => page1.env).reload();
    expect(page1.reloads()).toBe(1);
    // the next page (same tab: same sessionStorage), not full screen any more
    const page2 = fakeEnv();
    for (const [k, v] of page1.store) page2.store.set(k, v);
    const fs = new Fullscreen(() => page2.env);
    fs.restoreOnGesture();
    expect(page2.requests).toHaveLength(0); // no gesture yet: browsers would refuse
    expect(page2.count()).toBe(2); // waiting on pointerup / keydown
    page2.fire("keydown", { key: "Escape" }); // Escape grants no activation
    expect(page2.requests).toHaveLength(0);
    page2.fire("pointerup");
    expect(page2.requests).toEqual([{ navigationUI: "hide" }]);
    expect(page2.count()).toBe(0); // once
    page2.fire("pointerup");
    expect(page2.requests).toHaveLength(1);
    await Promise.resolve();
    // and the next reload remembers it again
    fs.reload();
    expect(page2.store.get("battledrones.fullscreen")).toBe("1");
  });

  it("does nothing when the game wasn't full screen, or where the API is missing (iOS)", () => {
    const off = fakeEnv();
    new Fullscreen(() => off.env).reload();
    expect(off.store.size).toBe(0);
    const next = fakeEnv();
    new Fullscreen(() => next.env).restoreOnGesture();
    expect(next.count()).toBe(0);

    const ios = fakeEnv({ api: false });
    ios.store.set("battledrones.fullscreen", "1");
    new Fullscreen(() => ios.env).restoreOnGesture();
    expect(ios.count()).toBe(0);
    expect(ios.store.size).toBe(0); // the note is used up either way
  });

  it("a reload before the first gesture (or mid-request) keeps the note", () => {
    const page = fakeEnv();
    page.store.set("battledrones.fullscreen", "1");
    const fs = new Fullscreen(() => page.env);
    fs.restoreOnGesture();
    expect(page.store.size).toBe(0);
    fs.reload(); // e.g. ‹ Menu straight away: still wanted
    expect(page.store.get("battledrones.fullscreen")).toBe("1");
  });
});

describe("the finale takes the camera from a gesture in progress", () => {
  it("reset() lets go of a pan or pinch without firing anything", () => {
    const cb = {
      onTap: vi.fn(), onDoubleTap: vi.fn(), onBoxStart: vi.fn(), onBoxMove: vi.fn(), onBoxEnd: vi.fn(),
      onPan: vi.fn(), onPanEnd: vi.fn(), onPinch: vi.fn(), onRightClick: vi.fn(), onWheel: vi.fn()
    };
    const g = new GestureRecognizer(cb);
    const touch = (id: number, x: number, y: number) => ({ id, x, y, pointerType: "touch" as const });
    g.down(touch(1, 100, 100), 0);
    g.move(touch(1, 140, 100), 50);
    expect(cb.onPan).toHaveBeenCalledTimes(1);
    g.reset();
    g.move(touch(1, 180, 100), 80);
    g.up(touch(1, 180, 100), 100);
    g.tick(1000);
    expect(cb.onPan).toHaveBeenCalledTimes(1);
    expect(cb.onPanEnd).not.toHaveBeenCalled(); // no momentum glide after the cinematic starts
    // a pinch, likewise
    g.down(touch(1, 100, 100), 2000);
    g.down(touch(2, 200, 100), 2010);
    g.move(touch(2, 260, 100), 2050);
    const pinches = cb.onPinch.mock.calls.length;
    g.reset();
    g.move(touch(2, 320, 100), 2080);
    g.up(touch(1, 100, 100), 2100);
    g.up(touch(2, 320, 100), 2110);
    expect(cb.onPinch).toHaveBeenCalledTimes(pinches);
    expect(cb.onPanEnd).not.toHaveBeenCalled();
    expect(cb.onTap).not.toHaveBeenCalled();
    expect(cb.onBoxStart).not.toHaveBeenCalled();
    // the next touch starts afresh
    g.down(touch(3, 50, 50), 3000);
    g.up(touch(3, 50, 50), 3100);
    expect(cb.onTap).toHaveBeenCalledTimes(1);
  });
});

describe("a replay opened by its link", () => {
  const page = (href: string) => {
    const went: string[] = [];
    return { href, went, reload: () => void went.push("reload"), assign: (u: string | URL) => void went.push(String(u)) };
  };
  it("Menu and Rematch leave the ?replay= link behind instead of watching it again", () => {
    const linked = page("https://example.com/battledrones/?replay=battles/showcase/a.json&follow&debug#x");
    reloadWithoutLink(linked);
    expect(linked.went).toEqual(["https://example.com/battledrones/?debug=#x"]);
    const plain = page("https://example.com/battledrones/?debug");
    reloadWithoutLink(plain);
    expect(plain.went).toEqual(["reload"]);
  });
});
