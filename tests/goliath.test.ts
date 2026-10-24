import { describe, expect, it } from "vitest";
import { planMenders } from "../src/sim/ai/menders";
import { BUILDINGS, COMBAT, ECONOMY, GOLIATH, OBJECTIVES, SALVAGE, TERRAIN, TICK_RATE, UNITS } from "../src/sim/balance";
import { findTarget } from "../src/sim/combat";
import { buildingBlocker, canPlaceBuilding, unitBlocker } from "../src/sim/economy";
import { isVisible, tickFog } from "../src/sim/fog";
import { anchorBlocker, goliathCost, goliathReach, modeProgress, unitCost } from "../src/sim/goliath";
import { unitSeenBy } from "../src/sim/infantry";
import { liftBlocker } from "../src/sim/lift";
import { createMapWorld } from "../src/sim/maps";
import { claimCrate } from "../src/sim/objectives";
import { placementBlocker } from "../src/sim/placement";
import { DEFAULT_RULES, MUTATORS, applyMutators, type MutatorId } from "../src/sim/rules";
import { step } from "../src/sim/sim";
import {
  Terrain,
  type Building,
  type BuildingKind,
  type Command,
  type Crate,
  type Faction,
  type FxEvent,
  type GoliathWeapon,
  type Unit,
  type UnitKind,
  type World,
  type Wreck
} from "../src/sim/types";
import {
  buildingAtTile,
  buildingCenter,
  createWorld,
  distToBuilding,
  domainOf,
  hqOf,
  nearestDropSite,
  onHomeLand,
  passable,
  setTerrain,
  spawnBuilding,
  spawnUnit,
  terrainAt
} from "../src/sim/world";

// ------------------------------------------------------------ helpers ---

type Ev<T extends FxEvent["type"]> = Extract<FxEvent, { type: T }>;
const evs = <T extends FxEvent["type"]>(fx: FxEvent[], type: T): Ev<T>[] => fx.filter((e): e is Ev<T> => e.type === type);

/** Step with these commands on the first tick, then `n - 1` empty ticks; returns every fx event. */
function run(w: World, n: number, cmds: Command[] = []): FxEvent[] {
  const out: FxEvent[] = [];
  for (let i = 0; i < n; i++) {
    step(w, i === 0 ? cmds : []);
    out.push(...w.fx);
  }
  return out;
}

/** Step until `done` (checked after each tick) or `max` ticks; returns the ticks taken (Infinity: never). */
function runUntil(w: World, done: () => boolean, max: number, out?: FxEvent[]): number {
  for (let i = 1; i <= max; i++) {
    step(w, []);
    out?.push(...w.fx);
    if (done()) return i;
  }
  return Infinity;
}

/** EMP a unit for good: it can't move or fire (but still takes damage). */
const freeze = (w: World, u: Unit) => w.powers.stunned.set(u.id, 1e9);

/** Paint a rectangle of terrain (inclusive). */
function paint(w: World, x0: number, y0: number, x1: number, y1: number, t: Terrain): void {
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) setTerrain(w, x, y, t);
}

const MAX_HP = UNITS.goliath.hp;
const ANCHOR_TICKS = Math.round(GOLIATH.anchorTime * TICK_RATE);
const PACK_TICKS = Math.round(GOLIATH.packTime * TICK_RATE);
const BUILD_TICKS = UNITS.goliath.buildTime * TICK_RATE;
const REBOOT_TICKS = Math.round(GOLIATH.reboot * TICK_RATE);
const WEAPONS: GoliathWeapon[] = ["mortars", "laser", "cannons", "mg"];
const W = GOLIATH.weapons;

/**
 * A flat 60×60 field: blue HQ in the top-left corner, red HQ in the
 * bottom-right, the middle open. No HQ trickle (so scrap sums are exact).
 */
function field(size = 60): World {
  const w = createWorld(size, size);
  w.rules = { ...DEFAULT_RULES, bannedUnits: [], bannedBuildings: [], startUnits: [], mutators: [], hqTrickle: 0 };
  spawnBuilding(w, "hq", "blue", 1, 1);
  spawnBuilding(w, "hq", "red", size - 4, size - 4);
  return w;
}

const PREREQS: BuildingKind[] = ["fab-plant", "airpad", "tech-lab", "assembly-bay"];

/** Give a side some of the Gantry's prerequisites, in a row beside its HQ. */
function giveTech(w: World, faction: Faction, kinds: readonly BuildingKind[]): void {
  PREREQS.forEach((k, i) => {
    if (!kinds.includes(k)) return;
    if (faction === "blue") spawnBuilding(w, k, "blue", 5 + i * 3, 1);
    else spawnBuilding(w, k, "red", w.width - 7 - i * 3, w.height - 3);
  });
}

/** Blue with its whole tech tree and a Gantry at (8, 8) (plenty of room around it), and scrap to spend. */
function gantryBase(): { w: World; gantry: Building } {
  const w = field();
  giveTech(w, "blue", PREREQS);
  const gantry = spawnBuilding(w, "gantry", "blue", 8, 8);
  w.factions.blue.scrap = 20_000;
  return { w, gantry };
}

const produce = (faction: Faction, buildingId: number, unit: UnitKind): Command => ({ type: "produce", faction, buildingId, unit });
const cancel = (faction: Faction, buildingId: number, unit: UnitKind): Command => ({ type: "cancelProduce", faction, buildingId, unit });
const anchorCmd = (g: Unit): Command => ({ type: "anchor", faction: g.faction, unitIds: [g.id] });
const packCmd = (g: Unit): Command => ({ type: "packUp", faction: g.faction, unitIds: [g.id] });

/** Spawn a Goliath at (x, y) and anchor it there (through the command). */
function anchoredAt(w: World, faction: Faction, x: number, y: number): Unit {
  const g = spawnUnit(w, "goliath", faction, x, y);
  run(w, ANCHOR_TICKS + 1, [anchorCmd(g)]);
  expect(g.goliath!.mode).toBe("anchored");
  return g;
}

/** Place `kind` at (tx, ty) as if its construction just finished. Returns the new building, or null if refused. */
function placeNow(w: World, faction: Faction, kind: BuildingKind, tx: number, ty: number): Building | null {
  w.factions[faction].pending = { kind, remaining: 0, ready: true };
  step(w, [{ type: "placeBuilding", faction, tx, ty }]);
  const b = buildingAtTile(w, tx, ty);
  if (b && b.kind === kind && b.tx === tx && b.ty === ty) return b;
  w.factions[faction].pending = null;
  return null;
}

/** Which of Goliath `g`'s weapons have fired since tick `t0`. */
const firedSince = (g: Unit, t0: number): Record<GoliathWeapon, boolean> =>
  Object.fromEntries(WEAPONS.map((k) => [k, g.goliath!.weapons[k].firedTick >= t0])) as Record<GoliathWeapon, boolean>;

const piles = (w: World): Wreck[] => w.wrecks.filter((r) => r.pile);
const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);

// ------------------------------------------------------------- the Gantry ---

describe("the Gantry: tech", () => {
  it("needs ALL of Fab Plant, Airpad, Tech Lab and Assembly Bay, and names every one that is missing", () => {
    expect([...(BUILDINGS.gantry.requiresAll ?? [])].sort()).toEqual([...PREREQS].sort());
    // every proper subset (none, any one, any two, any three) is refused, naming exactly what's missing
    for (let mask = 0; mask < 15; mask++) {
      const have = PREREQS.filter((_, i) => mask & (1 << i));
      const w = field();
      giveTech(w, "blue", have);
      const why = buildingBlocker(w, "blue", "gantry");
      expect(why, `with ${have.join("+") || "nothing"}`).not.toBeNull();
      for (const k of PREREQS)
        expect(why!.includes(BUILDINGS[k].name), `with ${have.join("+") || "nothing"}: names ${k}?`).toBe(!have.includes(k));
      // and the command does nothing
      w.factions.blue.scrap = 5000;
      step(w, [{ type: "startBuilding", faction: "blue", building: "gantry" }]);
      expect(w.factions.blue.pending).toBeNull();
      expect(w.factions.blue.scrap).toBe(5000);
    }
    const w = field();
    giveTech(w, "blue", PREREQS);
    expect(buildingBlocker(w, "blue", "gantry")).toBeNull();
    w.factions.blue.scrap = BUILDINGS.gantry.cost;
    step(w, [{ type: "startBuilding", faction: "blue", building: "gantry" }]);
    expect(w.factions.blue.pending?.kind).toBe("gantry");
    expect(w.factions.blue.scrap).toBe(0);
  });

  it("is one per side: refused while one is under construction or standing (the other side unaffected)", () => {
    const w = field();
    giveTech(w, "blue", PREREQS);
    giveTech(w, "red", PREREQS);
    w.factions.blue.scrap = 5000;
    step(w, [{ type: "startBuilding", faction: "blue", building: "gantry" }]);
    expect(w.factions.blue.pending?.kind).toBe("gantry");
    expect(buildingBlocker(w, "blue", "gantry")).toBe("One per side");
    expect(buildingBlocker(w, "red", "gantry")).toBeNull();
    // finished but not yet placed: still pending
    w.factions.blue.pending = { kind: "gantry", remaining: 0, ready: true };
    expect(buildingBlocker(w, "blue", "gantry")).toBe("One per side");

    const w2 = field();
    giveTech(w2, "blue", PREREQS);
    giveTech(w2, "red", PREREQS);
    const g = spawnBuilding(w2, "gantry", "blue", 8, 8);
    expect(buildingBlocker(w2, "blue", "gantry")).toBe("One per side");
    expect(buildingBlocker(w2, "red", "gantry")).toBeNull();
    w2.factions.blue.scrap = 5000;
    step(w2, [{ type: "startBuilding", faction: "blue", building: "gantry" }]);
    expect(w2.factions.blue.pending).toBeNull();
    expect(w2.factions.blue.scrap).toBe(5000);
    // once it is destroyed, another may go up
    g.hp = 0;
    step(w2, []);
    expect(buildingBlocker(w2, "blue", "gantry")).toBeNull();
  });

  it("is banned, along with the Goliath, by every mutator that bans ground combat (Air War)", () => {
    const groundBanners = (Object.keys(MUTATORS) as MutatorId[]).filter((id) => MUTATORS[id].bansUnits?.includes("mastodon"));
    expect(groundBanners).toContain("airwar");
    for (const id of groundBanners) {
      const w = field();
      giveTech(w, "blue", PREREQS);
      spawnBuilding(w, "gantry", "red", 40, 40); // (red has one already: it can't build Goliaths either)
      applyMutators(w, [id]);
      expect(buildingBlocker(w, "blue", "gantry"), id).toContain(MUTATORS[id].name);
      expect(unitBlocker(w, "blue", "goliath"), id).toContain(MUTATORS[id].name);
      expect(unitBlocker(w, "red", "goliath"), id).toContain(MUTATORS[id].name);
      const red = [...w.buildings.values()].find((b) => b.kind === "gantry")!;
      w.factions.red.scrap = 10_000;
      step(w, [produce("red", red.id, "goliath")]);
      expect(red.queue, id).toHaveLength(0);
    }
    // a mutator that leaves ground combat alone leaves the Gantry alone
    const w = field();
    giveTech(w, "blue", PREREQS);
    applyMutators(w, ["blitz"]);
    expect(buildingBlocker(w, "blue", "gantry")).toBeNull();
  });
});

describe("the Goliath's price", () => {
  const price = (n: number) => Math.round(UNITS.goliath.cost * (1 + GOLIATH.costStep * n));

  it("is list with none, +costStep of list per Goliath owned (alive or queued), refunds what was paid, and drops after a loss", () => {
    const { w, gantry } = gantryBase();
    expect(goliathCost(w, "blue")).toBe(UNITS.goliath.cost);
    expect(unitCost(w, "blue", "goliath")).toBe(UNITS.goliath.cost);
    const g1 = spawnUnit(w, "goliath", "blue", 30, 30);
    expect(goliathCost(w, "blue")).toBe(price(1));
    expect(goliathCost(w, "red")).toBe(price(0)); // per side
    // list-price scrap is no longer enough
    w.factions.blue.scrap = price(1) - 1;
    step(w, [produce("blue", gantry.id, "goliath")]);
    expect(gantry.queue).toHaveLength(0);
    expect(w.factions.blue.scrap).toBe(price(1) - 1);
    // queued: it pays today's price, and the queued one counts toward the next
    w.factions.blue.scrap = 20_000;
    step(w, [produce("blue", gantry.id, "goliath")]);
    expect(gantry.queue).toHaveLength(1);
    expect(w.factions.blue.scrap).toBe(20_000 - price(1));
    expect(goliathCost(w, "blue")).toBe(price(2));
    const g2 = spawnUnit(w, "goliath", "blue", 34, 30);
    expect(goliathCost(w, "blue")).toBe(price(3));
    // cancelling refunds exactly what was paid for it (not the list price, not today's price)
    step(w, [cancel("blue", gantry.id, "goliath")]);
    expect(gantry.queue).toHaveLength(0);
    expect(w.factions.blue.scrap).toBe(20_000);
    expect(goliathCost(w, "blue")).toBe(price(2));
    // each loss makes the next one cheaper again
    g1.hp = 0;
    step(w, []);
    expect(goliathCost(w, "blue")).toBe(price(1));
    g2.hp = 0;
    step(w, []);
    expect(goliathCost(w, "blue")).toBe(price(0));
    step(w, [produce("blue", gantry.id, "goliath")]);
    expect(w.factions.blue.scrap).toBe(20_000 - price(0));
  });

  it("a Gantry queues at most GOLIATH.queueMax Goliaths (and charges for no more)", () => {
    const { w, gantry } = gantryBase();
    const cmds = Array.from({ length: GOLIATH.queueMax + 2 }, () => produce("blue", gantry.id, "goliath"));
    step(w, cmds);
    expect(gantry.queue).toHaveLength(GOLIATH.queueMax);
    const paid = sum(Array.from({ length: GOLIATH.queueMax }, (_, i) => price(i)));
    expect(w.factions.blue.scrap).toBe(20_000 - paid);
  });

  it("needs a Gantry", () => {
    const w = field();
    giveTech(w, "blue", PREREQS);
    expect(unitBlocker(w, "blue", "goliath")).toContain(BUILDINGS.gantry.name);
  });
});

describe("Gantry production", () => {
  it("announces the build (started once, nearlyDone once past GOLIATH.nearlyDone), then rolls a ready Goliath out clear of the Gantry", () => {
    const { w, gantry } = gantryBase();
    const fx: { tick: number; e: FxEvent; progress: number }[] = [];
    let rolled: Ev<"goliathRollout"> | undefined;
    step(w, [produce("blue", gantry.id, "goliath")]);
    for (let i = 0; i < BUILD_TICKS + 20 && !rolled; i++) {
      if (i > 0) step(w, []);
      const head = gantry.queue[0];
      const progress = head ? 1 - head.remaining / BUILD_TICKS : 1;
      for (const e of w.fx) fx.push({ tick: i, e, progress });
      rolled = evs(w.fx, "goliathRollout")[0];
    }
    const started = fx.filter((f) => f.e.type === "goliathBuild" && f.e.stage === "started");
    const nearly = fx.filter((f) => f.e.type === "goliathBuild" && f.e.stage === "nearlyDone");
    expect(started).toHaveLength(1);
    expect(started[0]!.tick).toBe(0);
    expect(started[0]!.e).toMatchObject({ faction: "blue", buildingId: gantry.id });
    expect(nearly).toHaveLength(1);
    expect(nearly[0]!.e).toMatchObject({ faction: "blue", buildingId: gantry.id });
    // fired as the build passed the line: at or past it now, short of it a tick earlier
    expect(nearly[0]!.progress).toBeGreaterThanOrEqual(GOLIATH.nearlyDone - 1e-9);
    expect(nearly[0]!.progress - 1 / BUILD_TICKS).toBeLessThan(GOLIATH.nearlyDone);
    // rollout at spawn, after both
    expect(rolled).toBeDefined();
    const rollTick = fx.find((f) => f.e === rolled)!.tick;
    expect(rollTick).toBeGreaterThan(nearly[0]!.tick);
    expect(rollTick).toBeGreaterThanOrEqual(BUILD_TICKS - 1);
    expect(rolled).toMatchObject({ faction: "blue", buildingId: gantry.id });
    const g = w.units.get(rolled!.id)!;
    expect(g).toBeDefined();
    expect(g.kind).toBe("goliath");
    expect(g.faction).toBe("blue");
    expect(g.hp).toBe(MAX_HP);
    expect(gantry.queue).toHaveLength(0);
    // its own state: walking, every weapon system online
    expect(g.goliath).toBeDefined();
    expect(g.goliath!.mode).toBe("walking");
    expect(g.goliath!.lift).toBeNull();
    expect(g.goliath!.queue).toHaveLength(0);
    for (const k of WEAPONS) expect(g.goliath!.weapons[k].online, k).toBe(true);
    // its body is clear of the Gantry (and of every other building)
    expect(distToBuilding(gantry, g.x, g.y)).toBeGreaterThanOrEqual(UNITS.goliath.radius);
    for (const b of w.buildings.values()) expect(distToBuilding(b, g.x, g.y), b.kind).toBeGreaterThanOrEqual(UNITS.goliath.radius);
    // the Gantry is free for the next one, at the next price
    expect(goliathCost(w, "blue")).toBe(Math.round(UNITS.goliath.cost * (1 + GOLIATH.costStep)));
  });

  it("a red Gantry rolls out clear of its footprint too", () => {
    const w = field();
    giveTech(w, "red", PREREQS);
    const gantry = spawnBuilding(w, "gantry", "red", 46, 46);
    w.factions.red.scrap = 20_000;
    const fx = run(w, BUILD_TICKS + 5, [produce("red", gantry.id, "goliath")]);
    const r = evs(fx, "goliathRollout");
    expect(r).toHaveLength(1);
    const g = w.units.get(r[0]!.id)!;
    expect(distToBuilding(gantry, g.x, g.y)).toBeGreaterThanOrEqual(UNITS.goliath.radius);
  });
});

// --------------------------------------------------- walking and anchored ---

describe("anchoring", () => {
  it("digs in on the anchor command: anchoring for GOLIATH.anchorTime, then anchored (goliathMode events)", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 30, 30);
    expect(anchorBlocker(w, g)).toBeNull(); // far from base: no build-range requirement
    const fx: FxEvent[] = [];
    step(w, [anchorCmd(g)]);
    fx.push(...w.fx);
    expect(g.goliath!.mode).toBe("anchoring");
    expect(evs(w.fx, "goliathMode").map((e) => e.mode)).toEqual(["anchoring"]);
    const ticks = 1 + runUntil(w, () => g.goliath!.mode === "anchored", ANCHOR_TICKS * 3, fx);
    expect(Math.abs(ticks - ANCHOR_TICKS)).toBeLessThanOrEqual(1);
    const modes = evs(fx, "goliathMode");
    expect(modes.map((e) => e.mode)).toEqual(["anchoring", "anchored"]);
    expect(modes.every((e) => e.id === g.id && e.faction === "blue")).toBe(true);
    // anchoring again is refused
    expect(anchorBlocker(w, g)).not.toBeNull();
  });

  it("refuses water, rock and other unbuildable ground, a building, a ground unit in the way, and a lift", () => {
    const at = (setup: (w: World, g: Unit) => void): { w: World; g: Unit; why: string | null } => {
      const w = field();
      const g = spawnUnit(w, "goliath", "blue", 30, 30);
      setup(w, g);
      return { w, g, why: anchorBlocker(w, g) };
    };
    // the ground it stands on (its footprint is the tiles round (30, 30))
    for (const t of [Terrain.Water, Terrain.Rock, Terrain.Deep, Terrain.Forest, Terrain.Scrap, Terrain.Rough]) {
      const { w, g, why } = at((w) => setTerrain(w, 29, 29, t));
      expect(why, `terrain ${t}`).not.toBeNull();
      run(w, 3, [anchorCmd(g)]);
      expect(g.goliath!.mode, `terrain ${t}`).toBe("walking");
    }
    expect(at((w) => spawnBuilding(w, "turret", "blue", 30, 30)).why).not.toBeNull();
    expect(at((w) => spawnBuilding(w, "turret", "red", 29, 30)).why).not.toBeNull();
    expect(at((w) => spawnUnit(w, "stinger", "blue", 29.5, 29.5)).why).toBe("Unit in the way");
    expect(at((w) => spawnUnit(w, "harvester", "red", 30.5, 30.5)).why).toBe("Unit in the way");
    // an aircraft overhead is not in the way
    expect(at((w) => spawnUnit(w, "wasp", "blue", 29.5, 29.5)).why).toBeNull();
    // on a lift (Condors hooking on)
    const { w, g, why } = at((w, g) => {
      const a = spawnUnit(w, "condor", "blue", 27, 28);
      const b = spawnUnit(w, "condor", "blue", 33, 28);
      step(w, [{ type: "lift", faction: "blue", unitIds: [a.id, b.id], goliathId: g.id }]);
    });
    expect(g.goliath!.lift).not.toBeNull();
    expect(why).not.toBeNull();
    run(w, 2, [anchorCmd(g)]);
    expect(g.goliath!.mode).toBe("walking");
  });

  it("packs up in GOLIATH.packTime, which is slower than anchoring", () => {
    expect(GOLIATH.packTime).toBeGreaterThan(GOLIATH.anchorTime);
    const w = field();
    const g = anchoredAt(w, "blue", 30, 30);
    const fx: FxEvent[] = [];
    step(w, [packCmd(g)]);
    fx.push(...w.fx);
    expect(g.goliath!.mode).toBe("packing");
    const ticks = 1 + runUntil(w, () => g.goliath!.mode === "walking", PACK_TICKS * 3, fx);
    expect(Math.abs(ticks - PACK_TICKS)).toBeLessThanOrEqual(1);
    expect(ticks).toBeGreaterThan(ANCHOR_TICKS);
    expect(evs(fx, "goliathMode").map((e) => e.mode)).toEqual(["packing", "walking"]);
    // the progress arc (modeProgress) runs 0 → 1 over the pack-up
    const w2 = field();
    const g2 = anchoredAt(w2, "blue", 30, 30);
    expect(modeProgress(g2)).toBe(1);
    run(w2, 1, [packCmd(g2)]);
    expect(modeProgress(g2)).toBeLessThan(0.1);
    run(w2, Math.round(PACK_TICKS / 2) - 1);
    expect(modeProgress(g2)).toBeCloseTo(0.5, 1);
    run(w2, PACK_TICKS);
    expect(modeProgress(g2)).toBe(1);
  });

  it("can't move while anchoring, anchored or packing up (and nothing shoves it)", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 30, 30);
    step(w, [anchorCmd(g)]);
    const p = { x: g.x, y: g.y };
    const still = () => expect({ x: g.x, y: g.y }).toEqual(p);
    // an order slipped in directly (not through a command, which would pack it up) goes nowhere
    g.order = { type: "move", x: 40, y: 30 };
    run(w, 10);
    expect(g.goliath!.mode).toBe("anchoring");
    still();
    run(w, ANCHOR_TICKS);
    expect(g.goliath!.mode).toBe("anchored");
    g.order = { type: "move", x: 40, y: 30 };
    // a friendly tank driving through it is shoved aside, not the Goliath
    const tank = spawnUnit(w, "mastodon", "blue", 26, 30);
    run(w, 30, [{ type: "move", faction: "blue", unitIds: [tank.id], x: 34, y: 30 }]);
    still();
    step(w, [packCmd(g)]);
    g.order = { type: "move", x: 40, y: 30 };
    run(w, PACK_TICKS - 3);
    expect(g.goliath!.mode).toBe("packing");
    still();
    run(w, 20);
    expect(g.goliath!.mode).toBe("walking");
    expect(g.x).toBeGreaterThan(p.x + 0.5); // now it walks
  });

  // (regression: two Goliaths once shared separation's push, so a walking one shoved a dug-in one off its ground)
  it("stays dug in when another Goliath (either side) walks into it", () => {
    for (const f of ["blue", "red"] as const) {
      const w = field();
      const g = anchoredAt(w, "blue", 30, 30);
      const p = { x: g.x, y: g.y };
      const other = spawnUnit(w, "goliath", f, 24.5, 30.5);
      run(w, 300, [{ type: "move", faction: f, unitIds: [other.id], x: 36, y: 30.5 }]);
      expect(g.goliath!.mode, f).toBe("anchored");
      expect({ x: g.x, y: g.y }, f).toEqual(p);
    }
  });

  it("a move order to an anchored Goliath packs it up first, then it walks to the point", () => {
    const w = field();
    const g = anchoredAt(w, "blue", 30, 30);
    const p = { x: g.x, y: g.y };
    const fx = run(w, 1, [{ type: "move", faction: "blue", unitIds: [g.id], x: 36, y: 30 }]);
    expect(g.goliath!.mode).toBe("packing");
    expect(evs(fx, "goliathMode").map((e) => e.mode)).toEqual(["packing"]);
    run(w, PACK_TICKS - 2);
    expect({ x: g.x, y: g.y }).toEqual(p);
    const t = runUntil(w, () => Math.hypot(g.x - 36, g.y - 30) < 0.6, 400);
    expect(t).toBeLessThan(400);
    expect(g.goliath!.mode).toBe("walking");
  });
});

// ------------------------------------------------------------- drop-off ---

describe("scrap drop-off", () => {
  /** A long field: blue HQ far west, a scrap field far east; a harvester with a full hold by the field. */
  function farField(): { w: World; h: Unit } {
    const w = createWorld(64, 24);
    w.rules = { ...DEFAULT_RULES, bannedUnits: [], bannedBuildings: [], startUnits: [], mutators: [], hqTrickle: 0 };
    spawnBuilding(w, "hq", "blue", 1, 10);
    spawnBuilding(w, "hq", "red", 1, 1); // (far from it all)
    paint(w, 56, 10, 58, 12, Terrain.Scrap);
    const h = spawnUnit(w, "harvester", "blue", 54.5, 11.5);
    h.cargo = ECONOMY.harvesterCapacity;
    h.order = { type: "harvest", fieldX: 56, fieldY: 11, phase: "toBase" };
    return { w, h };
  }

  it("a harvester unloads at an anchored Goliath far from base", () => {
    const { w, h } = farField();
    anchoredAt(w, "blue", 48, 12);
    // (re-arm the hold: it may have been parked a while)
    h.cargo = ECONOMY.harvesterCapacity;
    h.order = { type: "harvest", fieldX: 56, fieldY: 11, phase: "toBase" };
    const s0 = w.factions.blue.scrap;
    const t0 = w.tick;
    const fx: FxEvent[] = [];
    runUntil(w, () => h.cargo === 0, 200, fx);
    // (and the Goliath's own trickle, paid at each whole second)
    const seconds = Math.floor(w.tick / TICK_RATE) - Math.floor(t0 / TICK_RATE);
    expect(w.factions.blue.scrap).toBeCloseTo(s0 + ECONOMY.harvesterCapacity + GOLIATH.trickle * seconds, 6);
    const dep = evs(fx, "deposit");
    expect(dep.length).toBeGreaterThan(0);
    expect(Math.hypot(dep[0]!.x - 48, dep[0]!.y - 12)).toBeLessThan(1.5);
    expect(h.x).toBeGreaterThan(40); // never went home
  });

  it("harvesters dock at it from every side", () => {
    for (let k = 0; k < 8; k++) {
      const a = (k / 8) * Math.PI * 2;
      const w = field(80);
      const g = anchoredAt(w, "blue", 40, 40);
      const fx = Math.floor(40 + Math.sin(a) * 9);
      const fy = Math.floor(40 - Math.cos(a) * 9);
      setTerrain(w, fx, fy, Terrain.Scrap);
      const h = spawnUnit(w, "harvester", "blue", fx + 0.5, fy + 0.5);
      h.cargo = ECONOMY.harvesterCapacity;
      h.order = { type: "harvest", fieldX: fx, fieldY: fy, phase: "toBase" };
      const out: FxEvent[] = [];
      const t = runUntil(w, () => h.cargo === 0, 300, out);
      expect(t, `from ${fx},${fy}`).toBeLessThan(300);
      expect(evs(out, "deposit").every((e) => Math.hypot(e.x - g.x, e.y - g.y) < 0.01), `from ${fx},${fy}`).toBe(true);
    }
  });

  it("does not count while walking (or still digging in)", () => {
    const { w, h } = farField();
    const g = spawnUnit(w, "goliath", "blue", 48, 6);
    expect(nearestDropSite(w, "blue", h.x, h.y)?.id).toBe(hqOf(w, "blue")!.id);
    run(w, 1, [anchorCmd(g)]);
    expect(g.goliath!.mode).toBe("anchoring");
    expect(nearestDropSite(w, "blue", h.x, h.y)?.id).toBe(hqOf(w, "blue")!.id);
    run(w, 1, [packCmd(g)]);
    const fx = run(w, 120);
    expect(evs(fx, "deposit")).toHaveLength(0);
    expect(h.x).toBeLessThan(40); // heading home
    expect(h.cargo).toBe(ECONOMY.harvesterCapacity);
  });

  it("once it starts packing up, a harvester bound for it reroutes to the nearest other drop-off", () => {
    const { w, h } = farField();
    const g = anchoredAt(w, "blue", 46, 12);
    const depot = spawnBuilding(w, "depot", "blue", 38, 20); // nearer than the HQ, farther than the Goliath
    h.x = 38.5;
    h.y = 11.5;
    h.cargo = ECONOMY.harvesterCapacity;
    h.order = { type: "harvest", fieldX: 56, fieldY: 11, phase: "toBase" };
    run(w, 3);
    expect(nearestDropSite(w, "blue", h.x, h.y)?.id).toBe(g.id); // bound for the Goliath
    expect(h.order.type === "harvest" && h.order.phase).toBe("toBase");
    const fx: FxEvent[] = [];
    step(w, [packCmd(g)]);
    fx.push(...w.fx);
    expect(nearestDropSite(w, "blue", h.x, h.y)?.id).toBe(depot.id);
    runUntil(w, () => h.cargo === 0, 400, fx);
    const dep = evs(fx, "deposit");
    expect(dep.length).toBeGreaterThan(0);
    const c = buildingCenter(depot);
    expect(Math.hypot(dep[0]!.x - c.x, dep[0]!.y - c.y)).toBeLessThan(0.01);
  });
});

describe("an unreachable drop-off", () => {
  // (regression: drop sites were picked by straight-line distance; a Goliath or outpost must be reachable by ground)
  it("a harvester never unloads across the sea at an island Goliath: it takes its load home", () => {
    const w = createWorld(64, 30);
    w.rules = { ...DEFAULT_RULES, bannedUnits: [], bannedBuildings: [], startUnits: [], mutators: [], hqTrickle: 0, islands: true };
    const hq = spawnBuilding(w, "hq", "blue", 1, 12);
    spawnBuilding(w, "hq", "red", 1, 1);
    paint(w, 40, 0, 47, 29, Terrain.Deep);
    paint(w, 36, 12, 38, 14, Terrain.Scrap);
    const g = anchoredAt(w, "blue", 50, 14);
    const h = spawnUnit(w, "harvester", "blue", 35.5, 13.5);
    h.cargo = ECONOMY.harvesterCapacity;
    h.order = { type: "harvest", fieldX: 36, fieldY: 13, phase: "toBase" };
    const fx = run(w, 400);
    const dep = evs(fx, "deposit");
    expect(dep.some((e) => Math.hypot(e.x - g.x, e.y - g.y) < 0.01)).toBe(false);
    const c = buildingCenter(hq);
    expect(dep.some((e) => Math.hypot(e.x - c.x, e.y - c.y) < 0.01)).toBe(true);
  });
});

describe("getting past a Goliath", () => {
  // (regression: paths ignored a dug-in Goliath and jammed against it; its footprint is now in the occupancy grid)
  it("a harvester rerouted past the packed-up Goliath reaches the other drop-off", () => {
    const w = createWorld(64, 24);
    w.rules = { ...DEFAULT_RULES, bannedUnits: [], bannedBuildings: [], startUnits: [], mutators: [], hqTrickle: 0 };
    spawnBuilding(w, "hq", "blue", 1, 10);
    spawnBuilding(w, "hq", "red", 1, 1);
    const g = anchoredAt(w, "blue", 46, 12);
    const depot = spawnBuilding(w, "depot", "blue", 56, 18); // beyond the Goliath
    const h = spawnUnit(w, "harvester", "blue", 36.5, 11.5);
    paint(w, 56, 10, 58, 12, Terrain.Scrap);
    h.cargo = ECONOMY.harvesterCapacity;
    h.order = { type: "harvest", fieldX: 56, fieldY: 11, phase: "toBase" };
    run(w, 3);
    expect(nearestDropSite(w, "blue", h.x, h.y)?.id).toBe(g.id);
    const fx = run(w, 1, [packCmd(g)]);
    runUntil(w, () => h.cargo === 0, 600, fx);
    const c = buildingCenter(depot);
    expect(evs(fx, "deposit").some((e) => Math.hypot(e.x - c.x, e.y - c.y) < 0.01)).toBe(true);
  });

  // (regression: same cause as above, for every ground unit size)
  it("ground units driving straight through a parked Goliath's spot get round it", () => {
    for (const kind of ["harvester", "mastodon", "stinger", "trooper"] as UnitKind[])
      for (const anchored of [false, true]) {
        const w = field();
        const g = spawnUnit(w, "goliath", "blue", 30, 30);
        if (anchored) run(w, ANCHOR_TICKS + 1, [anchorCmd(g)]);
        const u = spawnUnit(w, kind, "blue", 24.5, 30.5);
        const t = (() => {
          step(w, [{ type: "move", faction: "blue", unitIds: [u.id], x: 36.5, y: 30.5 }]);
          return runUntil(w, () => Math.hypot(u.x - 36.5, u.y - 30.5) < 1, 400);
        })();
        expect(t, `${kind} past a ${anchored ? "anchored" : "walking"} Goliath`).toBeLessThan(400);
      }
  });
});

// ------------------------------------------------------------- training ---

describe("training infantry", () => {
  it("an anchored Goliath trains squads (no Assembly Bay needed); they appear by it; cancel refunds", () => {
    const w = field();
    const g = anchoredAt(w, "blue", 30, 30);
    expect([...w.buildings.values()].some((b) => b.kind === "assembly-bay")).toBe(false);
    w.factions.blue.scrap = 1000;
    step(w, [produce("blue", g.id, "trooper"), produce("blue", g.id, "rocket-squad")]);
    expect(g.goliath!.queue.map((q) => q.kind)).toEqual(["trooper", "rocket-squad"]);
    expect(w.factions.blue.scrap).toBe(1000 - UNITS.trooper.cost - UNITS["rocket-squad"].cost);
    step(w, [cancel("blue", g.id, "rocket-squad")]);
    expect(g.goliath!.queue.map((q) => q.kind)).toEqual(["trooper"]);
    expect(w.factions.blue.scrap).toBe(1000 - UNITS.trooper.cost);
    const fx: FxEvent[] = [];
    runUntil(w, () => g.goliath!.queue.length === 0, UNITS.trooper.buildTime * TICK_RATE + 10, fx);
    const built = evs(fx, "built").map((e) => w.units.get(e.id)).filter((u): u is Unit => !!u);
    expect(built.map((u) => u.kind)).toEqual(["trooper"]);
    const t = built[0]!;
    expect(t.faction).toBe("blue");
    expect(Math.hypot(t.x - g.x, t.y - g.y)).toBeLessThanOrEqual(GOLIATH.footprint / 2 + 2.5);
    expect(Math.hypot(t.x - g.x, t.y - g.y)).toBeGreaterThanOrEqual(UNITS.goliath.radius); // not inside it
  });

  it("is refused while walking (and while digging in), and for anything but infantry", () => {
    const w = field();
    w.factions.blue.scrap = 5000;
    w.factions.blue.incomeMult = 0; // (no trickle once it's dug in: only an order it took could change the bank)
    const g = spawnUnit(w, "goliath", "blue", 30, 30);
    step(w, [produce("blue", g.id, "trooper")]);
    expect(g.goliath!.queue).toHaveLength(0);
    step(w, [anchorCmd(g)]);
    step(w, [produce("blue", g.id, "trooper")]);
    expect(g.goliath!.mode).toBe("anchoring");
    expect(g.goliath!.queue).toHaveLength(0);
    expect(w.factions.blue.scrap).toBe(5000);
    run(w, ANCHOR_TICKS);
    expect(g.goliath!.mode).toBe("anchored");
    // give it the whole tech tree: still nothing but robot infantry
    giveTech(w, "blue", PREREQS);
    spawnBuilding(w, "gantry", "blue", 8, 8);
    for (const k of Object.keys(UNITS) as UnitKind[]) {
      if (UNITS[k].builtAt === "assembly-bay") continue;
      step(w, [produce("blue", g.id, k)]);
      expect(g.goliath!.queue, k).toHaveLength(0);
    }
    expect(w.factions.blue.scrap).toBe(5000);
    // and another side can't use it
    w.factions.red.scrap = 5000;
    step(w, [produce("red", g.id, "trooper")]);
    expect(g.goliath!.queue).toHaveLength(0);
    expect(w.factions.red.scrap).toBe(5000);
  });

  it("a Sniper Team needs a Tech Lab", () => {
    const w = field();
    const g = anchoredAt(w, "blue", 30, 30);
    w.factions.blue.scrap = 5000;
    step(w, [produce("blue", g.id, "sniper")]);
    expect(g.goliath!.queue).toHaveLength(0);
    spawnBuilding(w, "tech-lab", "blue", 6, 1);
    step(w, [produce("blue", g.id, "sniper")]);
    expect(g.goliath!.queue.map((q) => q.kind)).toEqual(["sniper"]);
    expect(w.factions.blue.scrap).toBe(5000 - UNITS.sniper.cost);
  });

  it("the queue pauses while it packs up and walks, and resumes once anchored again", () => {
    const w = field();
    const g = anchoredAt(w, "blue", 30, 30);
    w.factions.blue.scrap = 1000;
    step(w, [produce("blue", g.id, "trooper")]);
    run(w, 10);
    const head = g.goliath!.queue[0]!;
    const r0 = head.remaining;
    expect(r0).toBeLessThan(UNITS.trooper.buildTime * TICK_RATE);
    step(w, [packCmd(g)]);
    const r1 = head.remaining;
    run(w, PACK_TICKS + 20); // packing, then walking
    expect(g.goliath!.mode).toBe("walking");
    expect(head.remaining).toBe(r1);
    expect(r1 - r0).toBeLessThanOrEqual(1);
    step(w, [anchorCmd(g)]);
    run(w, ANCHOR_TICKS - 2);
    expect(g.goliath!.mode).toBe("anchoring");
    expect(head.remaining).toBe(r1);
    const fx: FxEvent[] = [];
    const t = runUntil(w, () => g.goliath!.queue.length === 0, 200, fx);
    expect(t).toBeLessThan(200);
    expect(evs(fx, "built").map((e) => w.units.get(e.id)?.kind)).toEqual(["trooper"]);
  });
});

// -------------------------------------------------------------- outposts ---

describe("outposts", () => {
  it("anything but an HQ can go up within GOLIATH.buildRing of an anchored Goliath far from base, as an outpost", () => {
    const w = field();
    const g = anchoredAt(w, "blue", 30, 30);
    // a turret beside it, far outside base range
    expect(canPlaceBuilding(w, "blue", "turret", 32, 30)).toBe(true);
    expect(canPlaceBuilding(w, "blue", "hq", 32, 30)).toBe(false);
    expect(canPlaceBuilding(w, "blue", "hq", 32, 28)).toBe(false);
    // just outside the ring: no
    const R = GOLIATH.buildRing;
    expect(canPlaceBuilding(w, "blue", "turret", Math.floor(g.x + R) + 1, Math.floor(g.y))).toBe(false);
    expect(canPlaceBuilding(w, "blue", "turret", Math.floor(g.x + R) - 1, Math.floor(g.y))).toBe(true);
    for (const kind of Object.keys(BUILDINGS) as BuildingKind[]) {
      if (kind === "hq") continue;
      const w2 = field();
      const g2 = anchoredAt(w2, "blue", 30, 30);
      const tx = Math.floor(g2.x) + 1;
      const ty = Math.floor(g2.y) - BUILDINGS[kind].size - 1;
      const b = placeNow(w2, "blue", kind, tx, ty);
      expect(b, kind).not.toBeNull();
      expect(b!.outpost, kind).toBe(true);
    }
    // the red side's ring is no use to blue
    const r = anchoredAt(w, "red", 30, 44);
    expect(canPlaceBuilding(w, "blue", "turret", Math.floor(r.x) + 1, Math.floor(r.y))).toBe(false);
    expect(canPlaceBuilding(w, "red", "turret", Math.floor(r.x) + 1, Math.floor(r.y))).toBe(true);
  });

  it("a walking or still-anchoring Goliath has no build ring", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 30, 30);
    expect(canPlaceBuilding(w, "blue", "turret", 32, 30)).toBe(false);
    step(w, [anchorCmd(g)]);
    expect(g.goliath!.mode).toBe("anchoring");
    expect(canPlaceBuilding(w, "blue", "turret", 32, 30)).toBe(false);
    run(w, ANCHOR_TICKS);
    expect(canPlaceBuilding(w, "blue", "turret", 32, 30)).toBe(true);
    step(w, [packCmd(g)]);
    expect(canPlaceBuilding(w, "blue", "turret", 32, 30)).toBe(false);
  });

  it("nothing can be built off an outpost alone: its ring goes when the Goliath packs up", () => {
    const w = field();
    const g = anchoredAt(w, "blue", 30, 30);
    const depot = placeNow(w, "blue", "depot", 32, 29)!;
    expect(depot.outpost).toBe(true);
    // in range of the outpost but out of the ring: no, even with the Goliath still anchored
    expect(canPlaceBuilding(w, "blue", "turret", 38, 30)).toBe(false);
    expect(placementBlocker(w, "blue", "turret", 38, 30)).toBe("Too far from base");
    run(w, PACK_TICKS + 2, [packCmd(g)]);
    run(w, 1, [{ type: "move", faction: "blue", unitIds: [g.id], x: 20, y: 30 }]);
    run(w, 60);
    for (let ty = 25; ty <= 36; ty++) for (let tx = 26; tx <= 40; tx++) expect(canPlaceBuilding(w, "blue", "turret", tx, ty), `${tx},${ty}`).toBe(false);
    // an outpost isn't base: a building in its range still counts as one when it goes up (once a Goliath anchors again)
    anchoredAt(w, "blue", 37, 34);
    const t = placeNow(w, "blue", "turret", 38, 31);
    expect(t).not.toBeNull();
    expect(t!.outpost).toBe(true);
  });

  it("an outpost Depot keeps taking harvester scrap after the Goliath has gone", () => {
    const w = field();
    const g = anchoredAt(w, "blue", 40, 30);
    const depot = placeNow(w, "blue", "depot", 42, 29)!;
    expect(depot.outpost).toBe(true);
    run(w, 1, [{ type: "move", faction: "blue", unitIds: [g.id], x: 40, y: 50 }]);
    run(w, PACK_TICKS + 40);
    expect(g.goliath!.mode).toBe("walking");
    paint(w, 48, 28, 49, 31, Terrain.Scrap);
    const h = spawnUnit(w, "harvester", "blue", 47.5, 29.5);
    h.cargo = ECONOMY.harvesterCapacity;
    h.order = { type: "harvest", fieldX: 48, fieldY: 29, phase: "toBase" };
    const s0 = w.factions.blue.scrap;
    const fx: FxEvent[] = [];
    runUntil(w, () => h.cargo === 0, 200, fx);
    expect(w.factions.blue.scrap).toBeCloseTo(s0 + ECONOMY.harvesterCapacity, 6);
    const c = buildingCenter(depot);
    expect(evs(fx, "deposit").some((e) => Math.hypot(e.x - c.x, e.y - c.y) < 0.01)).toBe(true);
  });

  it("a building placed inside normal base range is a normal building, even beside an anchored Goliath", () => {
    const w = field();
    // blue's HQ covers (1..4, 1..4); the Goliath anchors just outside it
    const g = anchoredAt(w, "blue", 8, 5);
    expect(canPlaceBuilding(w, "blue", "turret", 12, 3)).toBe(false); // (outside base range and ring)
    const t = placeNow(w, "blue", "turret", 6, 3); // in base range AND the Goliath's ring
    expect(t).not.toBeNull();
    expect(t!.outpost ?? false).toBe(false);
    // so it is base: build off it, beyond the HQ's reach and the ring's
    run(w, PACK_TICKS + 2, [packCmd(g)]);
    expect(canPlaceBuilding(w, "blue", "turret", 12, 3)).toBe(true);
  });

  it("can't overlap a Goliath's body (anchored or walking, either side)", () => {
    const w = field();
    const g = anchoredAt(w, "blue", 30, 30);
    expect({ x: g.x, y: g.y }).toEqual({ x: 30, y: 30 });
    // every tile of the ground it stands on
    for (const [tx, ty] of [[29, 29], [30, 29], [29, 30], [30, 30]] as const) {
      expect(canPlaceBuilding(w, "blue", "turret", tx, ty), `${tx},${ty}`).toBe(false);
      expect(placementBlocker(w, "blue", "turret", tx, ty), `${tx},${ty}`).toBe("Unit in the way");
    }
    expect(canPlaceBuilding(w, "blue", "fab-plant", 28, 28)).toBe(false);
    // a walking one parked in the base
    const w2 = field();
    spawnUnit(w2, "goliath", "red", 6, 6);
    expect(canPlaceBuilding(w2, "blue", "turret", 5, 5)).toBe(false);
    expect(canPlaceBuilding(w2, "blue", "turret", 6, 6)).toBe(false);
    expect(canPlaceBuilding(w2, "blue", "turret", 5, 6)).toBe(false);
    expect(canPlaceBuilding(w2, "blue", "turret", 8, 6)).toBe(true);
  });

  it("placementBlocker agrees with canPlaceBuilding (null exactly when placeable) all round an anchored Goliath", () => {
    const w = field();
    const g = anchoredAt(w, "blue", 30, 30);
    spawnUnit(w, "stinger", "blue", 33.5, 30.5);
    setTerrain(w, 27, 31, Terrain.Water);
    spawnBuilding(w, "turret", "blue", 31, 33);
    for (const kind of ["turret", "depot", "gantry", "hq"] as BuildingKind[])
      for (let ty = Math.floor(g.y) - 7; ty <= g.y + 7; ty++)
        for (let tx = Math.floor(g.x) - 7; tx <= g.x + 7; tx++) {
          const ok = canPlaceBuilding(w, "blue", kind, tx, ty);
          const why = placementBlocker(w, "blue", kind, tx, ty);
          expect(why === null, `${kind} ${tx},${ty}: ${why}`).toBe(ok);
        }
  });
});

// -------------------------------------------------- weapons and damage ---

describe("weapons and damage stages", () => {
  it("loses the mortars, then the laser, then the cannons below each line; the machine guns never go", () => {
    expect(W.mortars.lostBelow).toBeGreaterThan(W.laser.lostBelow);
    expect(W.laser.lostBelow).toBeGreaterThan(W.cannons.lostBelow);
    expect(W.cannons.lostBelow).toBeGreaterThan(0);
    expect(W.mg.lostBelow).toBe(0);
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 30, 30);
    const log: string[] = [];
    // exactly at a line it still works
    g.hp = MAX_HP * W.mortars.lostBelow;
    run(w, 2);
    expect(g.goliath!.weapons.mortars.online).toBe(true);
    for (const k of ["mortars", "laser", "cannons"] as const) {
      g.hp = MAX_HP * W[k].lostBelow - 1;
      const fx = run(w, 2);
      for (const e of evs(fx, "goliathWeapon")) {
        expect(e).toMatchObject({ id: g.id, faction: "blue" });
        log.push(`${e.weapon}:${e.state}`);
      }
      expect(g.goliath!.weapons[k].online, k).toBe(false);
    }
    expect(log).toEqual(["mortars:offline", "laser:offline", "cannons:offline"]);
    g.hp = 1;
    run(w, 5);
    expect(g.goliath!.weapons.mg.online).toBe(true);
    // one big hit from full health: all three go in order, on the same tick
    const w2 = field();
    const g2 = spawnUnit(w2, "goliath", "blue", 30, 30);
    g2.hp = MAX_HP * W.cannons.lostBelow - 1;
    const fx2 = run(w2, 1);
    expect(evs(fx2, "goliathWeapon").map((e) => `${e.weapon}:${e.state}`)).toEqual(["mortars:offline", "laser:offline", "cannons:offline"]);
  });

  it("arms as the spec says: explosive mortars, a laser, cannons, and kinetic machine guns that hit air too", () => {
    expect(W.mortars.dmgType).toBe(UNITS.mortar.dmgType);
    expect(W.laser.dmgType).toBe(UNITS.lancer.dmgType);
    expect(W.cannons.dmgType).toBe(UNITS.mastodon.dmgType);
    expect(W.mg.dmgType).toBe(UNITS.trooper.dmgType);
    expect(W.mortars.dmgType).toBe("explosive");
    expect(W.mg.targets).toBe("both");
  });

  it("its reach (threat ring) shrinks as the weapons go", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 30, 30);
    const reach = [goliathReach(g)];
    for (const k of ["mortars", "laser", "cannons"] as const) {
      g.hp = MAX_HP * W[k].lostBelow - 1;
      run(w, 1);
      reach.push(goliathReach(g));
    }
    expect(reach[0]).toBe(Math.max(...WEAPONS.map((k) => W[k].range)));
    expect(reach.at(-1)).toBe(W.mg.range);
    for (let i = 1; i < reach.length; i++) expect(reach[i]!).toBeLessThanOrEqual(reach[i - 1]!);
    expect(reach[1]!).toBeLessThan(reach[0]!); // losing the mortars costs its long reach
  });

  it("restoring HP to the line doesn't reboot a weapon; line + restoreMargin does, and it's back GOLIATH.reboot seconds later", () => {
    for (const k of ["mortars", "laser", "cannons"] as const) {
      const w = field();
      const g = spawnUnit(w, "goliath", "blue", 30, 30);
      const line = W[k].lostBelow;
      g.hp = MAX_HP * (line - 0.03);
      run(w, 2);
      expect(g.goliath!.weapons[k].online, k).toBe(false);
      // exactly at the line, and just short of the margin: still down, no reboot
      for (const share of [line, line + GOLIATH.restoreMargin - 0.002]) {
        g.hp = MAX_HP * share;
        const fx = run(w, 10);
        expect(evs(fx, "goliathWeapon").filter((e) => e.weapon === k), `${k} at ${share}`).toHaveLength(0);
        expect(g.goliath!.weapons[k].online, k).toBe(false);
        expect(g.goliath!.weapons[k].reboot, k).toBe(-1);
      }
      g.hp = MAX_HP * (line + GOLIATH.restoreMargin) + 0.01;
      const fx: FxEvent[] = [];
      step(w, []);
      fx.push(...w.fx);
      expect(evs(fx, "goliathWeapon").filter((e) => e.weapon === k).map((e) => e.state), k).toEqual(["rebooting"]);
      expect(g.goliath!.weapons[k].online, k).toBe(false);
      const t = runUntil(w, () => g.goliath!.weapons[k].online, REBOOT_TICKS * 3, fx);
      expect(Math.abs(t - REBOOT_TICKS), k).toBeLessThanOrEqual(1);
      expect(evs(fx, "goliathWeapon").filter((e) => e.weapon === k).map((e) => e.state), k).toEqual(["rebooting", "online"]);
    }
  });

  it("knocked back below the line mid-reboot, a weapon goes offline again (and must reboot from scratch)", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 30, 30);
    const line = W.laser.lostBelow;
    g.hp = MAX_HP * (line - 0.1);
    run(w, 2);
    g.hp = MAX_HP * (line + GOLIATH.restoreMargin + 0.01);
    run(w, Math.max(1, REBOOT_TICKS - 5));
    expect(g.goliath!.weapons.laser.reboot).toBeGreaterThan(0);
    g.hp = MAX_HP * (line - 0.01);
    const fx = run(w, 1);
    expect(evs(fx, "goliathWeapon").filter((e) => e.weapon === "laser").map((e) => e.state)).toEqual(["offline"]);
    expect(g.goliath!.weapons.laser.online).toBe(false);
    run(w, REBOOT_TICKS + 5);
    expect(g.goliath!.weapons.laser.online).toBe(false);
    g.hp = MAX_HP * (line + GOLIATH.restoreMargin + 0.01);
    const t = runUntil(w, () => g.goliath!.weapons.laser.online, REBOOT_TICKS * 3);
    expect(t).toBeGreaterThanOrEqual(REBOOT_TICKS);
  });

  /** Blue Goliath at (30, 30) (optionally hurt) and a frozen red target `dist` tiles east; which weapons fire in 3 s. */
  function shootout(kind: UnitKind, dist: number, hpShare = 1) {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 30, 30);
    g.hp = MAX_HP * hpShare;
    run(w, 1); // (damage stages settle)
    const t = spawnUnit(w, kind, "red", 30 + dist, 30);
    freeze(w, t);
    const t0 = w.tick;
    run(w, 30);
    return { w, g, t, fired: firedSince(g, t0) };
  }
  const longest = Math.max(W.laser.range, W.cannons.range, W.mg.range);
  const shortReach = Math.min(W.laser.range, W.cannons.range, W.mg.range);

  it("shells a ground target beyond its other weapons' reach with the mortars only", () => {
    expect(W.mortars.range).toBeGreaterThan(longest);
    const { t, fired } = shootout("stinger", (longest + W.mortars.range) / 2);
    expect(fired).toEqual({ mortars: true, laser: false, cannons: false, mg: false });
    expect(t.hp).toBeLessThan(UNITS.stinger.hp);
  });

  it("never fires mortars inside their minRange; everything else hits a ground target that close", () => {
    expect(W.mortars.minRange!).toBeGreaterThan(0);
    const d = Math.min(W.mortars.minRange! * 0.8, shortReach - 0.2);
    const { fired, t } = shootout("stinger", d);
    expect(fired).toEqual({ mortars: false, laser: true, cannons: true, mg: true });
    expect(t.hp).toBeLessThan(UNITS.stinger.hp);
  });

  it("hits aircraft with the machine guns and laser, never with mortars or cannons", () => {
    // in reach of all four (and past the mortars' minimum range), were they all able to hit air
    const d = (Math.max(W.mortars.minRange ?? 0, 0) + Math.min(W.mg.range, W.cannons.range)) / 2;
    expect(d).toBeLessThan(W.mg.range);
    expect(d).toBeGreaterThan(W.mortars.minRange ?? 0);
    const { fired, t } = shootout("wasp", d);
    expect(fired).toEqual({ mortars: false, laser: true, cannons: false, mg: true });
    expect(t.hp).toBeLessThan(UNITS.wasp.hp);
  });

  it("a damaged Goliath can no longer shell a base: weapons offline don't fire", () => {
    const far = (longest + W.mortars.range) / 2;
    expect(shootout("stinger", far, W.mortars.lostBelow - 0.01).fired.mortars).toBe(false);
    const air = (Math.max(W.mortars.minRange ?? 0, 0) + Math.min(W.mg.range, W.cannons.range)) / 2;
    expect(shootout("wasp", air, W.laser.lostBelow - 0.01).fired).toEqual({ mortars: false, laser: false, cannons: false, mg: true });
    const close = Math.min(W.mortars.minRange! * 0.8, shortReach - 0.2);
    expect(shootout("stinger", close, W.cannons.lostBelow - 0.01).fired).toEqual({ mortars: false, laser: false, cannons: false, mg: true });
  });

  it("fires normally while anchored", () => {
    const w = field();
    const g = anchoredAt(w, "blue", 30, 30);
    const t = spawnUnit(w, "stinger", "red", 30 + (longest + W.mortars.range) / 2, 30);
    freeze(w, t);
    const t0 = w.tick;
    run(w, 30);
    expect(firedSince(g, t0).mortars).toBe(true);
    expect(t.hp).toBeLessThan(UNITS.stinger.hp);
  });
});

// ---------------------------------------------------------------- repair ---

describe("repair", () => {
  it("a Field Repair crate doesn't heal a Goliath (it heals the units beside it)", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 20, 20);
    g.hp = MAX_HP * 0.5;
    const s = spawnUnit(w, "stinger", "blue", 21, 21);
    s.hp = 50;
    const c: Crate = { id: w.nextId++, x: 20.5, y: 20.5, reward: "repair", drop: 0, announcedTick: 0, landTick: 0, expireTick: 1e9 };
    w.objectives.crates.push(c);
    claimCrate(w, c, "blue", g.id);
    expect(g.hp).toBe(MAX_HP * 0.5);
    expect(s.hp).toBeGreaterThan(50);
  });

  it("a rank-3 Goliath doesn't patch itself up like other elites", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 20, 20);
    g.rank = 3;
    g.hp = MAX_HP * 0.6;
    const m = spawnUnit(w, "mastodon", "blue", 30, 20);
    m.rank = 3;
    m.hp = UNITS.mastodon.hp * 0.5;
    run(w, 3 * TICK_RATE + 1);
    expect(g.hp).toBe(MAX_HP * 0.6);
    expect(m.hp).toBeGreaterThan(UNITS.mastodon.hp * 0.5); // (they do)
    expect(COMBAT.eliteRegen).toBeGreaterThan(0);
  });

  it("a Mender repairs it, which brings a lost weapon back", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 20, 20);
    const line = W.mortars.lostBelow;
    g.hp = MAX_HP * (line - 0.02);
    run(w, 2);
    expect(g.goliath!.weapons.mortars.online).toBe(false);
    g.hp = MAX_HP * (line + GOLIATH.restoreMargin) - 2; // two HP short of a reboot
    const hp0 = g.hp;
    spawnUnit(w, "mender", "blue", 21.5, 20);
    const fx: FxEvent[] = [];
    const t = runUntil(w, () => g.goliath!.weapons.mortars.online, 20 * TICK_RATE, fx);
    expect(t).toBeLessThan(20 * TICK_RATE);
    expect(g.hp).toBeGreaterThan(hp0);
    expect(evs(fx, "goliathWeapon").map((e) => `${e.weapon}:${e.state}`)).toEqual(["mortars:rebooting", "mortars:online"]);
  });

  it("a Mender favours a Goliath with a weapon down over an equally hurt tank", () => {
    const share = W.mortars.lostBelow - 0.02;
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 22, 20);
    g.hp = MAX_HP * share;
    const m = spawnUnit(w, "mastodon", "blue", 18, 20);
    m.hp = UNITS.mastodon.hp * share;
    run(w, 2);
    expect(g.goliath!.weapons.mortars.online).toBe(false);
    spawnUnit(w, "mender", "blue", 20, 20);
    const g0 = g.hp;
    const m0 = m.hp;
    run(w, 10);
    expect(g.hp).toBeGreaterThan(g0);
    expect(m.hp).toBe(m0);
  });

  it("the Mender AI sends a Mender to a Goliath with a weapon down before an equally far, slightly more hurt tank", () => {
    const w = field();
    const share = W.mortars.lostBelow - 0.02;
    const g = spawnUnit(w, "goliath", "red", 30, 40);
    g.hp = MAX_HP * share;
    run(w, 1);
    expect(g.goliath!.weapons.mortars.online).toBe(false);
    const tank = spawnUnit(w, "mastodon", "red", 30, 20);
    tank.hp = UNITS.mastodon.hp * (share - 0.03);
    const mender = spawnUnit(w, "mender", "red", 30, 30);
    const army = [...w.units.values()].filter((u) => u.faction === "red" && u.kind !== "harvester");
    const cmds = planMenders("red", army, [], new Set(), { x: 55, y: 55 }, { x: 2, y: 2 });
    const order = cmds.find((c) => "unitIds" in c && c.unitIds.includes(mender.id)) as Extract<Command, { type: "attackMove" }> | undefined;
    expect(order).toBeDefined();
    expect(Math.hypot(order!.x - g.x, order!.y - g.y)).toBeLessThan(1);
  });

  it("an EMP on the Goliath blocks a Mender's repair while it lasts", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 20, 20);
    g.hp = MAX_HP * 0.5;
    spawnUnit(w, "mender", "blue", 21.5, 20);
    w.powers.stunned.set(g.id, w.tick + 30);
    run(w, 25);
    expect(g.hp).toBe(MAX_HP * 0.5);
    run(w, 15);
    expect(g.hp).toBeGreaterThan(MAX_HP * 0.5);
  });

  it("an EMP'd Mender repairs nothing", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 20, 20);
    g.hp = MAX_HP * 0.5;
    const m = spawnUnit(w, "mender", "blue", 21.5, 20);
    freeze(w, m);
    run(w, 30);
    expect(g.hp).toBe(MAX_HP * 0.5);
  });
});

// ------------------------------------------------------------ visibility ---

describe("sight and visibility", () => {
  it("the enemy always sees a Goliath, deep in the fog", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 45, 10);
    const s = spawnUnit(w, "stinger", "blue", 45, 14);
    tickFog(w);
    expect(isVisible(w, "red", 45, 10)).toBe(false);
    expect(unitSeenBy(w, "red", s)).toBe(false); // (an ordinary unit there is hidden)
    expect(unitSeenBy(w, "red", g)).toBe(true);
    expect(UNITS.goliath.alwaysVisible).toBe(true);
  });

  it("the enemy knows a Gantry without ever having sight of it, and learns at once when it falls", () => {
    const w = field();
    const gantry = spawnBuilding(w, "gantry", "blue", 40, 8);
    const depot = spawnBuilding(w, "depot", "blue", 46, 8);
    tickFog(w);
    expect(isVisible(w, "red", 41, 9)).toBe(false);
    expect(w.fog.red.known.has(gantry.id)).toBe(true);
    expect(w.fog.red.known.get(gantry.id)).toMatchObject({ kind: "gantry", faction: "blue", tx: 40, ty: 8 });
    expect(w.fog.red.known.has(depot.id)).toBe(false);
    gantry.hp = 0;
    step(w, []);
    tickFog(w);
    expect(w.fog.red.known.has(gantry.id)).toBe(false);
  });

  it("a Goliath sees further than any other unit", () => {
    for (const k of Object.keys(UNITS) as UnitKind[])
      if (k !== "goliath") expect(UNITS.goliath.sight, k).toBeGreaterThan(UNITS[k].sight);
    const w = field();
    spawnUnit(w, "goliath", "blue", 30, 30);
    tickFog(w);
    expect(isVisible(w, "blue", Math.floor(30 + UNITS.goliath.sight - 0.6), 30)).toBe(true);
  });
});

// ---------------------------------------------------------------- defeat ---

describe("defeat", () => {
  it("HQ destroyed while the side has a Goliath: no winner; its last Goliath destroyed: the enemy wins", () => {
    const w = field();
    const g1 = spawnUnit(w, "goliath", "blue", 30, 30);
    const g2 = spawnUnit(w, "goliath", "blue", 36, 30);
    hqOf(w, "blue")!.hp = 0;
    step(w, []);
    expect(hqOf(w, "blue")).toBeNull();
    expect(w.winner).toBeNull();
    g1.hp = 0;
    step(w, []);
    expect(w.winner).toBeNull();
    g2.hp = 0;
    step(w, []);
    expect(w.winner).toBe("red");
  });

  it("a Goliath on a lift still keeps its side in the game", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 30, 30);
    const a = spawnUnit(w, "condor", "blue", 28, 28);
    const b = spawnUnit(w, "condor", "blue", 32, 28);
    run(w, 1, [{ type: "lift", faction: "blue", unitIds: [a.id, b.id], goliathId: g.id }]);
    runUntil(w, () => g.goliath!.lift?.phase === "carrying", 100);
    hqOf(w, "blue")!.hp = 0;
    step(w, []);
    expect(w.winner).toBeNull();
  });

  it("a Goliath destroyed with the HQ standing decides nothing", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "red", 30, 30);
    g.hp = 0;
    step(w, []);
    expect(w.units.has(g.id)).toBe(false);
    expect(w.winner).toBeNull();
  });

  it("HQ and last Goliath lost on the same tick: the enemy wins", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "red", 30, 30);
    g.hp = 0;
    hqOf(w, "red")!.hp = 0;
    step(w, []);
    expect(w.winner).toBe("blue");
  });

  it("a classic match without Goliaths: HQ death still decides at once", () => {
    const w = field();
    hqOf(w, "red")!.hp = 0;
    step(w, []);
    expect(w.winner).toBe("blue");
  });

  it("after the HQ falls the side still builds: by an anchored Goliath and in range of surviving buildings, but never an HQ", () => {
    const w = field();
    const g = anchoredAt(w, "blue", 40, 30);
    spawnBuilding(w, "depot", "blue", 10, 10);
    hqOf(w, "blue")!.hp = 0;
    step(w, []);
    expect(w.winner).toBeNull();
    expect(buildingBlocker(w, "blue", "turret")).toBeNull();
    expect(placeNow(w, "blue", "turret", 13, 10)).not.toBeNull();
    expect(placeNow(w, "blue", "turret", Math.floor(g.x) + 1, Math.floor(g.y))).not.toBeNull();
    expect(buildingBlocker(w, "blue", "hq")).not.toBeNull();
    w.factions.blue.scrap = 10_000;
    step(w, [{ type: "startBuilding", faction: "blue", building: "hq" }]);
    expect(w.factions.blue.pending).toBeNull();
  });
});

// ----------------------------------------------------------- death salvage ---

describe("death salvage", () => {
  it("a destroyed Goliath leaves no hull but GOLIATH.salvage piles spread round where it fell, worth its share of list price", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 30, 30);
    const friend = spawnUnit(w, "stinger", "blue", 31.5, 30);
    const harv = spawnUnit(w, "harvester", "blue", 30, 31.5);
    g.hp = 0;
    const fx = run(w, 1);
    expect(evs(fx, "death").some((e) => e.id === g.id)).toBe(true);
    expect(w.wrecks.some((r) => r.id === g.id && !r.pile)).toBe(false);
    expect(w.wrecks.every((r) => r.pile)).toBe(true);
    const ps = piles(w);
    const [lo, hi] = GOLIATH.salvage.piles;
    expect(ps.length).toBeGreaterThanOrEqual(lo);
    expect(ps.length).toBeLessThanOrEqual(hi);
    for (const p of ps) {
      expect(p.kind).toBe("goliath");
      expect(p.faction).toBe("blue");
      expect(Math.hypot(p.x - 30, p.y - 30)).toBeLessThanOrEqual(GOLIATH.salvage.spread + 1);
    }
    // spread out, not one heap
    let far = 0;
    for (const a of ps) for (const b of ps) far = Math.max(far, Math.hypot(a.x - b.x, a.y - b.y));
    expect(far).toBeGreaterThan(GOLIATH.salvage.spread * 0.6);
    expect(new Set(ps.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`)).size).toBe(ps.length);
    const total = sum(ps.map((p) => p.value));
    expect(Math.abs(total - UNITS.goliath.cost * GOLIATH.salvage.share)).toBeLessThanOrEqual(ps.length);
    // the fall deals no damage
    expect(friend.hp).toBe(UNITS.stinger.hp);
    expect(harv.hp).toBe(UNITS.harvester.hp);
  });

  it("its piles can be collected once cool", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "red", 30, 30);
    g.hp = 0;
    run(w, 1);
    const ps = piles(w);
    expect(ps.length).toBeGreaterThan(0);
    const p = ps[0]!;
    const s0 = w.factions.blue.scrap;
    spawnUnit(w, "flak-crawler", "blue", p.x, p.y);
    run(w, SALVAGE.hot * TICK_RATE + 3);
    expect(w.wrecks.some((r) => r.id === p.id)).toBe(false);
    expect(w.factions.blue.scrap).toBeGreaterThanOrEqual(s0 + p.value - 1e-6);
  });

  /** A Gantry destroyed `ticks` into a Goliath build (null: nothing on the cradle). */
  function gantryDeath(ticks: number | null): { ps: Wreck[]; progress: number; paid: number; c: { x: number; y: number } } {
    const { w, gantry } = gantryBase();
    let progress = 0;
    let paid = 0;
    if (ticks !== null) {
      const s0 = w.factions.blue.scrap;
      run(w, ticks, [produce("blue", gantry.id, "goliath")]);
      paid = s0 - w.factions.blue.scrap;
    }
    const head = gantry.queue[0];
    gantry.hp = 0;
    step(w, []);
    if (head) progress = 1 - head.remaining / BUILD_TICKS;
    expect(w.buildings.has(gantry.id)).toBe(false);
    expect(goliathCost(w, "blue")).toBe(UNITS.goliath.cost); // the build is lost
    return { ps: piles(w), progress, paid, c: buildingCenter(gantry) };
  }

  it("a Gantry destroyed mid-build scatters scrap in proportion to the build's progress", () => {
    const S = GOLIATH.gantrySalvage;
    const early = gantryDeath(Math.round(BUILD_TICKS * 0.25));
    const late = gantryDeath(Math.round(BUILD_TICKS * 0.75));
    for (const r of [early, late]) {
      expect(r.paid).toBe(UNITS.goliath.cost);
      expect(r.ps.length).toBeGreaterThan(0);
      const total = sum(r.ps.map((p) => p.value));
      expect(Math.abs(total - S.share * r.paid * r.progress)).toBeLessThanOrEqual(r.ps.length);
      for (const p of r.ps) expect(Math.hypot(p.x - r.c.x, p.y - r.c.y)).toBeLessThanOrEqual(S.spread + BUILDINGS.gantry.size / 2 + 1.5);
    }
    expect(sum(late.ps.map((p) => p.value))).toBeGreaterThan(sum(early.ps.map((p) => p.value)));
    // an empty cradle leaves nothing
    expect(gantryDeath(null).ps).toHaveLength(0);
  });
});

// ------------------------------------------------------------------ lift ---

describe("two-Condor lift", () => {
  const condorStep = UNITS.condor.speed / TICK_RATE;

  /** A blue Goliath at (20, 20) with two empty Condors above it, hooked on and carrying it. */
  function lifted(w = field()): { w: World; g: Unit; a: Unit; b: Unit; fx: FxEvent[] } {
    const g = spawnUnit(w, "goliath", "blue", 20, 20);
    const a = spawnUnit(w, "condor", "blue", 17, 18);
    const b = spawnUnit(w, "condor", "blue", 23, 18);
    const fx = run(w, 1, [{ type: "lift", faction: "blue", unitIds: [a.id, b.id], goliathId: g.id }]);
    const t = runUntil(w, () => evs(w.fx, "goliathLift").length > 0, 100, fx);
    expect(t).toBeLessThan(100);
    return { w, g, a, b, fx };
  }

  it("two empty Condors hook on ('hooked'), fly it at about speedMult of a Condor's speed, and set it down with unload ('setDown')", () => {
    const { w, g, a, b, fx } = lifted();
    const hooked = evs(fx, "goliathLift");
    expect(hooked).toHaveLength(1);
    expect(hooked[0]).toMatchObject({ state: "hooked", id: g.id, faction: "blue" });
    expect([...hooked[0]!.carrierIds].sort()).toEqual([a.id, b.id].sort());
    expect(g.goliath!.lift?.phase).toBe("carrying");
    expect(domainOf(g)).toBe("air");
    // flies (a move to either Condor flies the lift)
    run(w, 2, [{ type: "move", faction: "blue", unitIds: [a.id], x: 50, y: 20 }]);
    const x0 = g.x;
    run(w, 10);
    const perTick = (g.x - x0) / 10;
    expect(perTick).toBeCloseTo(condorStep * GOLIATH.lift.speedMult, 6);
    expect(perTick).toBeLessThan(condorStep);
    expect(g.y).toBeCloseTo(20, 6);
    // the Condors stay with it
    for (const c of [a, b]) expect(Math.hypot(c.x - g.x, c.y - g.y)).toBeLessThanOrEqual(GOLIATH.lift.span + 0.01);
    // set down at a point
    const fx2: FxEvent[] = [];
    step(w, [{ type: "unload", faction: "blue", unitIds: [b.id], x: 30, y: 24 }]);
    fx2.push(...w.fx);
    const t = runUntil(w, () => !g.goliath!.lift, 300, fx2);
    expect(t).toBeLessThan(300);
    const down = evs(fx2, "goliathLift");
    expect(down.map((e) => e.state)).toEqual(["setDown"]);
    expect(Math.hypot(g.x - 30, g.y - 24)).toBeLessThan(0.6);
    expect(domainOf(g)).toBe("ground");
    expect(g.goliath!.mode).toBe("walking");
    expect(a.order.type).not.toBe("lift");
    expect(b.order.type).not.toBe("lift");
    expect(g.hp).toBe(MAX_HP);
    // and it can anchor there
    run(w, ANCHOR_TICKS + 1, [anchorCmd(g)]);
    expect(g.goliath!.mode).toBe("anchored");
  });

  it("set down over water or a building, it lands on the nearest ground it can stand on", () => {
    const setDownAt = (setup: (w: World) => void, x: number, y: number) => {
      const w = field();
      setup(w);
      const { g, a } = lifted(w);
      const fx: FxEvent[] = [];
      step(w, [{ type: "unload", faction: "blue", unitIds: [a.id], x, y }]);
      fx.push(...w.fx);
      expect(runUntil(w, () => !g.goliath!.lift, 400, fx)).toBeLessThan(400);
      expect(evs(fx, "goliathLift").map((e) => e.state)).toEqual(["setDown"]);
      expect(w.units.has(g.id)).toBe(true);
      expect(g.hp).toBe(MAX_HP);
      expect(passable(w, Math.floor(g.x), Math.floor(g.y), "ground")).toBe(true);
      return { w, g };
    };
    // the middle of a lake: the nearest shore
    const lake = setDownAt((w) => paint(w, 26, 14, 33, 26, Terrain.Water), 29.5, 20.5);
    expect(Math.hypot(lake.g.x - 29.5, lake.g.y - 20.5)).toBeLessThanOrEqual(GOLIATH.lift.setDownSearch);
    // onto a building: beside it
    const onto = setDownAt((w) => void spawnBuilding(w, "fab-plant", "blue", 30, 20), 30.5, 20.5);
    const fab = [...onto.w.buildings.values()].find((b) => b.kind === "fab-plant")!;
    expect(distToBuilding(fab, onto.g.x, onto.g.y)).toBeGreaterThan(0);
  });

  it("refuses an anchored Goliath, and Condors carrying squads", () => {
    const w = field();
    const g = anchoredAt(w, "blue", 20, 20);
    const a = spawnUnit(w, "condor", "blue", 17, 18);
    const b = spawnUnit(w, "condor", "blue", 23, 18);
    expect(liftBlocker([a, b], g)).not.toBeNull();
    run(w, 20, [{ type: "lift", faction: "blue", unitIds: [a.id, b.id], goliathId: g.id }]);
    expect(g.goliath!.lift).toBeNull();
    expect(a.order.type).not.toBe("lift");
    expect(g.goliath!.mode).toBe("anchored");

    const w2 = field();
    const g2 = spawnUnit(w2, "goliath", "blue", 20, 20);
    const c1 = spawnUnit(w2, "condor", "blue", 17, 18);
    const c2 = spawnUnit(w2, "condor", "blue", 23, 18);
    const sq = spawnUnit(w2, "trooper", "blue", 23, 18);
    w2.units.delete(sq.id);
    c2.passengers!.push(sq);
    expect(liftBlocker([c1, c2], g2)).not.toBeNull();
    run(w2, 30, [{ type: "lift", faction: "blue", unitIds: [c1.id, c2.id], goliathId: g2.id }]);
    expect(g2.goliath!.lift).toBeNull();
    expect(evs(w2.fx, "goliathLift")).toHaveLength(0);
    // one Condor alone can't
    expect(liftBlocker([c1], g2)).not.toBeNull();
    // enemy Condors can't
    const r1 = spawnUnit(w2, "condor", "red", 18, 22);
    const r2 = spawnUnit(w2, "condor", "red", 22, 22);
    run(w2, 30, [{ type: "lift", faction: "red", unitIds: [r1.id, r2.id], goliathId: g2.id }]);
    expect(g2.goliath!.lift).toBeNull();
  });

  it("in flight only the machine guns fire", () => {
    const { w, g } = lifted();
    // a ground target every weapon could reach on the ground (past the mortars' minimum range)
    const d = (Math.max(W.mortars.minRange ?? 0, 0) + Math.min(W.mg.range, W.cannons.range, W.laser.range)) / 2;
    const t = spawnUnit(w, "stinger", "red", g.x, g.y + d);
    freeze(w, t);
    const t0 = w.tick;
    run(w, 30);
    expect(firedSince(g, t0)).toEqual({ mortars: false, laser: false, cannons: false, mg: true });
    expect(t.hp).toBeLessThan(UNITS.stinger.hp);
  });

  it("in flight it is an air target: a ground-only unit can't hit it, an anti-air one can", () => {
    const { w, g } = lifted();
    expect(findTarget(w, "red", "ground", g.x, g.y, 0.5)).toBeNull();
    expect(findTarget(w, "red", "air", g.x, g.y, 0.5)?.id).toBe(g.id);
    const st = spawnUnit(w, "stinger", "red", g.x, g.y + 2);
    run(w, 20, [{ type: "attack", faction: "red", unitIds: [st.id], targetId: g.id }]);
    expect(g.hp).toBe(MAX_HP);
    st.hp = 0;
    step(w, []);
    const fl = spawnUnit(w, "flak-crawler", "red", g.x, g.y + 2.5);
    run(w, 20, [{ type: "attack", faction: "red", unitIds: [fl.id], targetId: g.id }]);
    expect(g.hp).toBeLessThan(MAX_HP);
  });

  it("a Condor shot down over land drops it: it lands with about dropDamage × max HP of damage", () => {
    const { w, g, a, b } = lifted();
    run(w, 10, [{ type: "move", faction: "blue", unitIds: [a.id], x: 40, y: 20 }]);
    const hp0 = g.hp;
    a.hp = 0;
    const fx = run(w, 1);
    const drop = evs(fx, "goliathLift");
    expect(drop.map((e) => e.state)).toEqual(["dropped"]);
    expect(drop[0]!.destroyed ?? false).toBe(false);
    expect(w.units.has(g.id)).toBe(true);
    expect(hp0 - g.hp).toBeCloseTo(MAX_HP * GOLIATH.lift.dropDamage, 6);
    expect(g.goliath!.lift).toBeNull();
    expect(domainOf(g)).toBe("ground");
    expect(b.order.type).not.toBe("lift");
  });

  for (const [name, t] of [["water", Terrain.Water], ["open sea", Terrain.Deep], ["rock", Terrain.Rock]] as const)
    it(`a Condor shot down over ${name}: the Goliath is destroyed`, () => {
      const { w, g, b } = lifted();
      paint(w, Math.floor(g.x) - 3, Math.floor(g.y) - 3, Math.floor(g.x) + 3, Math.floor(g.y) + 3, t);
      b.hp = 0;
      const fx = run(w, 1);
      const drop = evs(fx, "goliathLift");
      expect(drop.map((e) => e.state)).toEqual(["dropped"]);
      expect(drop[0]!.destroyed).toBe(true);
      expect(w.units.has(g.id)).toBe(false);
      expect(evs(fx, "death").some((e) => e.id === g.id)).toBe(true);
    });

  it("flown out over a lake and dropped, it is lost", () => {
    const w = field();
    paint(w, 26, 10, 34, 30, Terrain.Water);
    const { g, a } = lifted(w);
    run(w, 1, [{ type: "move", faction: "blue", unitIds: [g.id], x: 30, y: 20 }]);
    runUntil(w, () => Math.abs(g.x - 30) < 0.01, 300);
    a.hp = 0;
    run(w, 1);
    expect(w.units.has(g.id)).toBe(false);
  });

  it("a Condor lost while still hooking on calls the lift off: the Goliath stays on its feet, unharmed", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 20, 20);
    const a = spawnUnit(w, "condor", "blue", 10, 10);
    const b = spawnUnit(w, "condor", "blue", 30, 10);
    run(w, 3, [{ type: "lift", faction: "blue", unitIds: [a.id, b.id], goliathId: g.id }]);
    expect(g.goliath!.lift?.phase).toBe("hooking");
    a.hp = 0;
    const fx = run(w, 2);
    expect(g.goliath!.lift).toBeNull();
    expect(evs(fx, "goliathLift").filter((e) => e.state === "dropped")).toHaveLength(0);
    expect(g.hp).toBe(MAX_HP);
    expect(b.order.type).not.toBe("lift");
    expect(domainOf(g)).toBe("ground");
    // and it walks again
    run(w, 30, [{ type: "move", faction: "blue", unitIds: [g.id], x: 26, y: 20 }]);
    expect(g.x).toBeGreaterThan(20.5);
  });

  it("squads can't board a Condor that's on a lift", () => {
    const { w, a } = lifted();
    const sq = spawnUnit(w, "trooper", "blue", a.x, a.y + 0.5);
    run(w, 40, [{ type: "board", faction: "blue", unitIds: [sq.id], carrierId: a.id }]);
    expect(a.passengers).toHaveLength(0);
    expect(w.units.has(sq.id)).toBe(true);
    expect(sq.order.type).not.toBe("board");
  });

  it("a Goliath destroyed while carried lets its Condors go", () => {
    const { w, g, a, b } = lifted();
    g.hp = 0;
    run(w, 2);
    expect(w.units.has(g.id)).toBe(false);
    expect(a.order.type).not.toBe("lift");
    expect(b.order.type).not.toBe("lift");
  });
});

// ------------------------------------------------------------- islands ---

describe("no special island rules", () => {
  const island = (w: World, tx: number, ty: number) => !onHomeLand(w, "blue", tx, ty) && !onHomeLand(w, "red", tx, ty);

  /**
   * An Archipelago island spot (on neither side's home land) where a Goliath could anchor, with
   * open island ground for a 2×2 building just north of it, in its build ring.
   */
  function islandSpot(w: World): { x: number; y: number } {
    const probe = spawnUnit(w, "goliath", "blue", 0, 0);
    let spot: { x: number; y: number } | null = null;
    for (let y = 6; y < w.height - 4 && !spot; y++)
      for (let x = 4; x < w.width - 4 && !spot; x++) {
        if (!island(w, x, y) || !island(w, x - 1, y - 1)) continue;
        probe.x = x;
        probe.y = y;
        if (anchorBlocker(w, probe) !== null) continue;
        let room = true;
        for (let dy = -4; dy <= -3; dy++)
          for (let dx = 0; dx <= 1; dx++) if (!TERRAIN[terrainAt(w, x + dx, y + dy)].buildable || !island(w, x + dx, y + dy)) room = false;
        if (room) spot = { x, y };
      }
    w.units.delete(probe.id);
    expect(spot).not.toBeNull();
    return spot!;
  }

  it("on the Archipelago, a Goliath lifted onto an island anchors, trains squads and builds outposts there", () => {
    const w = createMapWorld("archipelago");
    expect(w.rules?.islands).toBe(true);
    const spot = islandSpot(w);
    // the nearest open home ground to it, for the Goliath and its Condors to start from
    let start: { x: number; y: number } | null = null;
    let best = Infinity;
    for (let y = 2; y < w.height - 2; y++)
      for (let x = 2; x < w.width - 2; x++) {
        if (!onHomeLand(w, "blue", x, y) || !passable(w, x, y, "ground")) continue;
        const d = Math.hypot(x - spot.x, y - spot.y);
        if (d < best) {
          best = d;
          start = { x: x + 0.5, y: y + 0.5 };
        }
      }
    const g = spawnUnit(w, "goliath", "blue", start!.x, start!.y);
    const a = spawnUnit(w, "condor", "blue", start!.x - 2, start!.y - 2);
    const b = spawnUnit(w, "condor", "blue", start!.x + 2, start!.y - 2);
    run(w, 1, [{ type: "lift", faction: "blue", unitIds: [a.id, b.id], goliathId: g.id }]);
    expect(runUntil(w, () => g.goliath!.lift?.phase === "carrying", 100)).toBeLessThan(100);
    step(w, [{ type: "unload", faction: "blue", unitIds: [a.id], x: spot.x, y: spot.y }]);
    expect(runUntil(w, () => !g.goliath!.lift, 2000)).toBeLessThan(2000);
    expect(Math.hypot(g.x - spot.x, g.y - spot.y)).toBeLessThan(0.01);
    expect(island(w, Math.floor(g.x), Math.floor(g.y))).toBe(true);
    // anchors
    run(w, ANCHOR_TICKS + 1, [anchorCmd(g)]);
    expect(g.goliath!.mode).toBe("anchored");
    // trains (the squad appears on the island, beside it)
    w.factions.blue.scrap = 5000;
    step(w, [produce("blue", g.id, "trooper")]);
    const fx: FxEvent[] = [];
    runUntil(w, () => g.goliath!.queue.length === 0, UNITS.trooper.buildTime * TICK_RATE + 10, fx);
    const sq = evs(fx, "built").map((e) => w.units.get(e.id)).find((u) => u?.kind === "trooper");
    expect(sq).toBeDefined();
    expect(Math.hypot(sq!.x - g.x, sq!.y - g.y)).toBeLessThan(4);
    expect(passable(w, Math.floor(sq!.x), Math.floor(sq!.y), "foot")).toBe(true);
    // builds an outpost there
    const t = placeNow(w, "blue", "turret", spot.x + 1, spot.y - 3);
    expect(t).not.toBeNull();
    expect(t!.outpost).toBe(true);
  });

  // (regression: outposts spawned on home land only, so an island outpost dropped units in the sea)
  it("an outpost Assembly Bay on an island rolls its squads out onto the island", () => {
    const w = createMapWorld("archipelago");
    const spot = islandSpot(w);
    anchoredAt(w, "blue", spot.x, spot.y);
    const bay = placeNow(w, "blue", "assembly-bay", spot.x, spot.y - 4);
    expect(bay).not.toBeNull();
    expect(bay!.outpost).toBe(true);
    w.factions.blue.scrap = 5000;
    step(w, [produce("blue", bay!.id, "trooper")]);
    const fx: FxEvent[] = [];
    runUntil(w, () => bay!.queue.length === 0, UNITS.trooper.buildTime * TICK_RATE + 10, fx);
    const sq = evs(fx, "built").map((e) => w.units.get(e.id)).find((u) => u?.kind === "trooper");
    expect(sq).toBeDefined();
    expect(passable(w, Math.floor(sq!.x), Math.floor(sq!.y), "foot")).toBe(true);
    expect(distToBuilding(bay!, sq!.x, sq!.y)).toBeLessThan(4);
  });
});

// --------------------------------------------------------- determinism ---

describe("determinism", () => {
  /** A short skirmish with every Goliath system in play; returns a snapshot of the end state. */
  function scenario(): string {
    const w = field();
    giveTech(w, "blue", PREREQS);
    const gantry = spawnBuilding(w, "gantry", "blue", 8, 8);
    w.factions.blue.scrap = 20_000;
    const g = spawnUnit(w, "goliath", "blue", 20, 20);
    const a = spawnUnit(w, "condor", "blue", 17, 18);
    const b = spawnUnit(w, "condor", "blue", 23, 18);
    spawnUnit(w, "mender", "blue", 19, 22);
    const foe = spawnUnit(w, "goliath", "red", 33, 24);
    foe.hp = 400;
    for (let i = 0; i < 4; i++) spawnUnit(w, i % 2 ? "stinger" : "wasp", "red", 36 + i, 22 + i);
    run(w, 1, [{ type: "lift", faction: "blue", unitIds: [a.id, b.id], goliathId: g.id }, produce("blue", gantry.id, "goliath")]);
    run(w, 40);
    run(w, 1, [{ type: "unload", faction: "blue", unitIds: [a.id], x: 28, y: 22 }]);
    run(w, 120);
    run(w, 1, [anchorCmd(g)]);
    run(w, 80);
    run(w, 1, [produce("blue", g.id, "trooper")]);
    run(w, 100);
    return JSON.stringify({
      tick: w.tick,
      units: [...w.units.values()].map((u) => [u.id, u.kind, u.faction, u.x, u.y, u.hp, u.goliath?.mode, u.goliath && WEAPONS.map((k) => u.goliath!.weapons[k].online)]),
      wrecks: w.wrecks.map((r) => [r.id, r.x, r.y, r.value, r.pile]),
      buildings: [...w.buildings.values()].map((b) => [b.id, b.hp, b.queue.map((q) => q.remaining)]),
      scrap: [w.factions.blue.scrap, w.factions.red.scrap],
      winner: w.winner
    });
  }

  it("mirror-image Goliaths anchor, roll out and scatter their salvage as mirror images", () => {
    const S = 60;
    const m = (p: { x: number; y: number }) => ({ x: S - p.x, y: S - p.y });
    const key = (ws: Wreck[], flip: boolean) =>
      ws.map((r) => (flip ? m(r) : r)).map((p, i) => `${p.x.toFixed(4)},${p.y.toFixed(4)}:${ws[i]!.value}`).sort();
    const w = createWorld(S, S);
    const b = spawnUnit(w, "goliath", "blue", 20.3, 24.7);
    const r = spawnUnit(w, "goliath", "red", S - 20.3, S - 24.7);
    step(w, [anchorCmd(b), anchorCmd(r)]);
    expect(m(r)).toEqual({ x: b.x, y: b.y });
    b.hp = 0;
    r.hp = 0;
    step(w, []);
    expect(key(w.wrecks.filter((x) => x.faction === "red"), true)).toEqual(key(w.wrecks.filter((x) => x.faction === "blue"), false));
    const w2 = createWorld(S, S);
    const gb = spawnBuilding(w2, "gantry", "blue", 10, 12);
    const gr = spawnBuilding(w2, "gantry", "red", S - 10 - BUILDINGS.gantry.size, S - 12 - BUILDINGS.gantry.size);
    w2.factions.blue.scrap = w2.factions.red.scrap = 20_000;
    const fx = run(w2, BUILD_TICKS + 2, [produce("blue", gb.id, "goliath"), produce("red", gr.id, "goliath")]);
    const out = evs(fx, "goliathRollout").map((e) => w2.units.get(e.id)!);
    expect(out.map((u) => u.faction).sort()).toEqual(["blue", "red"]);
    const [ub, ur] = [out.find((u) => u.faction === "blue")!, out.find((u) => u.faction === "red")!];
    expect(m(ur)).toEqual({ x: ub.x, y: ub.y });
  });

  it("the same scenario run twice ends identically", () => {
    const one = scenario();
    const two = scenario();
    expect(two).toBe(one);
    // (and it did something: a Goliath fell and scattered its salvage)
    expect(JSON.parse(one).wrecks.some((r: unknown[]) => r[4] === true)).toBe(true);
  });
});

describe("the anchored Goliath's trickle", () => {
  it("salvages GOLIATH.trickle (half an Uplink's pay) a second while dug in, × the side's income; walking, nothing", () => {
    const w = field();
    const g = spawnUnit(w, "goliath", "blue", 30, 30);
    const s0 = w.factions.blue.scrap;
    run(w, 10 * TICK_RATE);
    expect(w.factions.blue.scrap).toBe(s0); // (walking: and field() has no HQ trickle)
    run(w, ANCHOR_TICKS + 1, [anchorCmd(g)]);
    expect(g.goliath!.mode).toBe("anchored");
    const s1 = w.factions.blue.scrap;
    const t1 = w.tick;
    run(w, 30 * TICK_RATE);
    const seconds = Math.floor(w.tick / TICK_RATE) - Math.floor(t1 / TICK_RATE);
    expect(w.factions.blue.scrap - s1).toBeCloseTo(GOLIATH.trickle * seconds, 9);
    expect(GOLIATH.trickle).toBe(OBJECTIVES.uplink.income / 2);
    // a richer side (an AI's handicap, a mutator) gets its share, as the HQ's trickle does
    w.factions.blue.incomeMult = 2;
    const s2 = w.factions.blue.scrap;
    run(w, 10 * TICK_RATE);
    expect(w.factions.blue.scrap - s2).toBeCloseTo(2 * GOLIATH.trickle * 10, 9);
  });
});
