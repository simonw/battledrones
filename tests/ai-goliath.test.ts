import { describe, expect, it } from "vitest";
import { STRATEGIES, createAiState, tickAi, type AiState, type Difficulty, type StrategyName } from "../src/sim/ai/commander";
import { canPlaceBuilding } from "../src/sim/economy";
import { GOLIATH_AI, goliathPhases, goliathSite, liftCondors } from "../src/sim/ai/goliath";
import { FFA_TACTICS } from "../src/sim/ai/ffa";
import { planMenders } from "../src/sim/ai/menders";
import { BUILDINGS, GOLIATH, TICK_RATE, UNITS } from "../src/sim/balance";
import { tickFog } from "../src/sim/fog";
import { goliathCost, goliathsOf, isAnchored } from "../src/sim/goliath";
import { createMapWorld } from "../src/sim/maps";
import { step } from "../src/sim/sim";
import { Terrain, type BuildingKind, type Command, type Faction, type FxEvent, type Unit, type World } from "../src/sim/types";
import { buildingCenter, hqOf, regionAt, removeBuilding, setTerrain, spawnBuilding, spawnUnit } from "../src/sim/world";
import { perSide } from "../src/sim/sides";

/**
 * The commander and the Goliath (GOLIATH.md "Balancing and playtesting": the
 * AI has to use Goliaths before automated playtesting means anything). It
 * builds a Gantry late and rich, digs a Goliath in at a distant field with
 * outposts, harvesters and squads, mends it, lifts it by two Condors to an
 * island, keeps fighting with it after the HQ falls, hunts the enemy's, and
 * plays the Nomads and Robot Love mutators.
 */

const units = (w: World, f: Faction, kind?: string) =>
  [...w.units.values()].filter((u) => u.faction === f && (!kind || u.kind === kind));
const buildings = (w: World, f: Faction, kind?: string) =>
  [...w.buildings.values()].filter((b) => b.faction === f && (!kind || b.kind === kind));

/** Red's AI alone (blue sits still, its HQ never falls) for `secs`; every command it gave, and every event. */
function runRed(w: World, secs: number, s: AiState, each?: (cmds: Command[]) => void): { cmds: Command[]; fx: FxEvent[] } {
  const blueHq = hqOf(w, "blue");
  if (blueHq) blueHq.hp = 1e9;
  const cmds: Command[] = [];
  const fx: FxEvent[] = [];
  for (let i = 0; i < secs * TICK_RATE && !w.winner; i++) {
    const c = tickAi(w, "red", s);
    each?.(c);
    cmds.push(...c);
    step(w, c);
    fx.push(...w.fx);
  }
  return { cmds, fx };
}

/** Put up a red `kind` at the open spot nearest (x, y). */
function placeNear(w: World, kind: BuildingKind, x: number, y: number): void {
  const size = BUILDINGS[kind].size;
  let best: [number, number] | null = null;
  let bestD = Infinity;
  for (let ty = 0; ty < w.height; ty++)
    for (let tx = 0; tx < w.width; tx++) {
      const d = Math.hypot(tx + size / 2 - x, ty + size / 2 - y);
      if (d < bestD && canPlaceBuilding(w, "red", kind, tx, ty)) {
        bestD = d;
        best = [tx, ty];
      }
    }
  spawnBuilding(w, kind, "red", best![0], best![1]);
}

/**
 * Proving Grounds, red well along: its personality's build order up (with a
 * Fab Plant, Airpad and Tech Lab), its Assembly Bay only with `bay`, an army,
 * scrap, and the clock at `secs`.
 */
function midGame(strategy: StrategyName, difficulty: Difficulty = "normal", secs = 330, bay = false) {
  const w = createMapWorld("proving-grounds");
  const ai = createAiState(strategy, difficulty, 1);
  const hq = hqOf(w, "red")!;
  const c = buildingCenter(hq);
  const order = [...STRATEGIES[strategy].buildOrder];
  for (const k of ["fab-plant", "airpad", "tech-lab"] as const) if (!order.includes(k)) order.push(k);
  if (bay && !order.includes("assembly-bay")) order.push("assembly-bay");
  for (const k of order) if (k !== "assembly-bay" || bay) placeNear(w, k, c.x - 4, c.y + 3);
  for (let i = 0; i < 6; i++) spawnUnit(w, "stinger", "red", c.x - 3 + (i % 3), c.y + 6 + Math.floor(i / 3));
  w.factions.red.scrap = 3000;
  w.tick = secs * TICK_RATE;
  return { w, ai, hq };
}

describe("the Gantry", () => {
  it("comes late and rich: Boom builds the Assembly Bay it lacks, then a Gantry behind its HQ", () => {
    const { w, ai, hq } = midGame("boom");
    const started: string[] = [];
    runRed(w, 90, ai, (cmds) => {
      for (const c of cmds) if (c.type === "startBuilding") started.push(c.building);
    });
    expect(started).toContain("assembly-bay");
    expect(started).toContain("gantry");
    expect(started.indexOf("assembly-bay")).toBeLessThan(started.indexOf("gantry"));
    const gantry = buildings(w, "red", "gantry")[0]!;
    expect(gantry).toBeDefined();
    // behind the HQ: farther from the enemy than the HQ is
    const enemy = buildingCenter(hqOf(w, "blue")!);
    const g = buildingCenter(gantry);
    const h = buildingCenter(hq);
    expect(Math.hypot(g.x - enemy.x, g.y - enemy.y)).toBeGreaterThan(Math.hypot(h.x - enemy.x, h.y - enemy.y));
  }, 30000);

  it("not before the personality's hour, never on Easy, never in Last Stand", () => {
    // Rush's hour is later than Boom's: at 4:30 Boom builds one, Rush doesn't
    expect(GOLIATH_AI.gantryFrom.rush).toBeGreaterThan(GOLIATH_AI.gantryFrom.boom);
    expect(GOLIATH_AI.gantryFrom.ironclad).toBeLessThanOrEqual(GOLIATH_AI.gantryFrom.boom);
    for (const [strategy, difficulty, secs, want] of [
      ["boom", "normal", 270, true],
      ["rush", "normal", 270, false],
      ["balanced", "easy", 900, false]
    ] as const) {
      const { w, ai } = midGame(strategy, difficulty, secs, true);
      const { cmds } = runRed(w, 40, ai);
      expect(cmds.some((c) => c.type === "startBuilding" && c.building === "gantry"), `${strategy} ${difficulty}`).toBe(want);
    }
  }, 30000);

  it("never starves the army for it: no Gantry with the army below GOLIATH_AI.armyFloor", () => {
    const { w, ai } = midGame("boom", "normal", 330, true);
    for (const u of units(w, "red", "stinger")) w.units.delete(u.id);
    const { cmds } = runRed(w, 10, ai);
    expect(cmds.some((c) => c.type === "startBuilding" && c.building === "gantry")).toBe(false);
  });

  /** Ironclad at 6:40 with a Gantry and 5,000 scrap; every Goliath it orders, and the price it paid. */
  function gantrySide() {
    const { w, ai, hq } = midGame("ironclad", "normal", 400, true);
    placeNear(w, "gantry", buildingCenter(hq).x, buildingCenter(hq).y + 10);
    w.factions.red.scrap = 5000;
    const orders: { tick: number; paid: number }[] = [];
    const watch = (cmds: Command[]) => {
      for (const c of cmds) if (c.type === "produce" && c.unit === "goliath") orders.push({ tick: w.tick, paid: goliathCost(w, "red") });
    };
    return { w, ai, orders, watch };
  }

  it("queues a Goliath, and no second within GOLIATH_AI.again", () => {
    const { w, ai, orders, watch } = gantrySide();
    runRed(w, 90, ai, watch);
    expect(orders).toHaveLength(1);
    expect(orders[0]!.paid).toBe(UNITS.goliath.cost);
    expect(GOLIATH_AI.again).toBeGreaterThan(90);
  }, 30000);

  it("a second, while one walks, only on an income that pays for it — at the escalated price", () => {
    const { w, ai, orders, watch } = gantrySide();
    spawnUnit(w, "goliath", "red", 30.5, 14.5);
    // out of the bank alone: no (the army spends it)
    runRed(w, 30, ai, watch);
    expect(orders).toHaveLength(0);
    // with a harvest coming in (1,200 scrap a minute) a share of it is set aside, and it comes
    runRed(w, 240, ai, (cmds) => {
      w.factions.red.stats.scrapHarvested += 2;
      watch(cmds);
    });
    expect(orders).toHaveLength(1);
    expect(orders[0]!.paid).toBe(Math.round(UNITS.goliath.cost * (1 + GOLIATH.costStep)));
  }, 30000);
});

describe("a Goliath in the field", () => {
  /** Red's Goliath by its HQ, Boom's (an expander's) plan, a minute and a half to go about it. */
  function expander() {
    const w = createMapWorld("proving-grounds");
    const ai = createAiState("boom", "normal", 1);
    const hq = hqOf(w, "red")!;
    const c = buildingCenter(hq);
    const g = spawnUnit(w, "goliath", "red", c.x - 3, c.y + 5);
    for (let i = 0; i < 3; i++) spawnUnit(w, "harvester", "red", c.x + 2 + i, c.y + 4);
    spawnBuilding(w, "tech-lab", "red", hq.tx - 3, hq.ty); // (Rocket Squads at the Goliath)
    w.factions.red.scrap = 2500;
    return { w, ai, hq: c, g };
  }

  it("digs in at a distant field, puts up outposts in its ring, and its harvesters unload at it", () => {
    const { w, ai, hq, g } = expander();
    const { cmds, fx } = runRed(w, 150, ai);
    expect(isAnchored(g)).toBe(true);
    // out at a field no drop-off served, not the home field by the HQ
    expect(Math.hypot(g.x - hq.x, g.y - hq.y)).toBeGreaterThan(GOLIATH_AI.siteServed);
    expect(goliathSite(ai, g.id)?.kind).toBe("field");
    let field = Infinity;
    for (let i = 0; i < w.scrap.length; i++)
      if (w.scrap[i]! > 0) field = Math.min(field, Math.hypot((i % w.width) + 0.5 - g.x, Math.floor(i / w.width) + 0.5 - g.y));
    expect(field).toBeLessThan(5);
    // outposts: in its ring, out of base range
    const outposts = buildings(w, "red").filter((b) => b.outpost);
    expect(outposts.length).toBeGreaterThanOrEqual(1);
    for (const b of outposts) {
      const c = buildingCenter(b);
      expect(Math.hypot(c.x - g.x, c.y - g.y)).toBeLessThan(GOLIATH.buildRing + BUILDINGS[b.kind].size + 1);
    }
    // harvesters sent to its field unload at it
    const atIt = fx.filter((e) => e.type === "deposit" && e.faction === "red" && Math.hypot(e.x - g.x, e.y - g.y) < 0.5);
    expect(atIt.length).toBeGreaterThanOrEqual(1);
    // and it trains squads to stand by it
    expect(cmds.some((c) => c.type === "produce" && c.buildingId === g.id)).toBe(true);
  }, 30000);

  it("walks with an escort, some of it anti-air once enemy air has been seen", () => {
    // (Ashlands: its distant fields are a long walk from home)
    const w = createMapWorld("ashlands");
    const ai = createAiState("boom", "normal", 1);
    const hq = buildingCenter(hqOf(w, "red")!);
    const g = spawnUnit(w, "goliath", "red", hq.x - 3, hq.y + 5);
    for (let i = 0; i < 3; i++) spawnUnit(w, "stinger", "red", hq.x - 4 + i, hq.y + 7);
    spawnUnit(w, "flak-crawler", "red", hq.x - 4, hq.y + 8);
    ai.seenAir = 3;
    const escorted = new Set<number>();
    runRed(w, 40, ai, (cmds) => {
      for (const c of cmds) if (c.type === "attackMove" && Math.hypot(c.x - g.x, c.y - g.y) <= GOLIATH_AI.post + 1) c.unitIds.forEach((id) => escorted.add(id));
    });
    const kinds = [...escorted].map((id) => w.units.get(id)?.kind);
    expect(kinds).toContain("flak-crawler");
  });

  it("packs up and moves on once its field runs dry", () => {
    const { w, ai, g } = expander();
    runRed(w, 120, ai);
    expect(isAnchored(g)).toBe(true);
    const first = { x: g.x, y: g.y };
    // the field it works runs dry
    for (let i = 0; i < w.scrap.length; i++)
      if (Math.hypot((i % w.width) + 0.5 - g.x, Math.floor(i / w.width) + 0.5 - g.y) < 8) w.scrap[i] = 0;
    runRed(w, 90, ai);
    expect(Math.hypot(g.x - first.x, g.y - first.y)).toBeGreaterThan(4);
  }, 30000);
});

describe("Menders and a Goliath", () => {
  it("the commander sends two or three Menders to a Goliath with a weapon down, none to one under an EMP", () => {
    const w = createMapWorld("proving-grounds");
    const c = buildingCenter(hqOf(w, "red")!);
    const g = spawnUnit(w, "goliath", "red", 24.5, 18.5);
    g.hp = UNITS.goliath.hp * (GOLIATH.weapons.mortars.lostBelow - 0.05);
    const menders = [0, 1, 2, 3].map((i) => spawnUnit(w, "mender", "red", c.x - 2 + i, c.y + 4));
    const hurt = spawnUnit(w, "stinger", "red", c.x, c.y + 6);
    hurt.hp = UNITS.stinger.hp * 0.3;
    step(w, []); // (the mortars go offline)
    expect(g.goliath!.weapons.mortars.online).toBe(false);
    const ai = createAiState("boom", "normal", 1);
    const cmds = tickAi(w, "red", ai);
    const toIt = menders.filter((m) =>
      cmds.some((cmd) => (cmd.type === "attackMove" || cmd.type === "move") && cmd.unitIds.includes(m.id) && Math.hypot(cmd.x - g.x, cmd.y - g.y) < 2)
    );
    expect(toIt.length).toBeGreaterThanOrEqual(2);
    expect(toIt.length).toBeLessThanOrEqual(3);
    // under an EMP repair is blocked: the Menders see to the rest
    const army = units(w, "red").filter((u) => u.kind !== "harvester" && u.kind !== "goliath");
    w.powers.stunned.set(g.id, w.tick + 100);
    const frozen = planMenders("red", army, [], new Set(), c, { x: 5, y: 41 }, [g], w);
    expect(frozen.some((cmd) => (cmd.type === "attackMove" || cmd.type === "move") && Math.hypot(cmd.x - g.x, cmd.y - g.y) < 2)).toBe(false);
  });
});

describe("the two-Condor lift", () => {
  it("on the Archipelago, two Condors fly a Goliath to an island relay; no other planner touches a lift Condor", () => {
    const w = createMapWorld("archipelago", { objectives: true });
    const ai = createAiState("boom", "normal", 1);
    const hq = hqOf(w, "red")!;
    const c = buildingCenter(hq);
    spawnBuilding(w, "airpad", "red", hq.tx - 3, hq.ty + 4);
    const g = spawnUnit(w, "goliath", "red", c.x - 4, c.y + 6);
    for (let i = 0; i < 3; i++) spawnUnit(w, "condor", "red", c.x + 3 + i, c.y + 4);
    w.factions.red.scrap = 2000;
    const home = regionAt(w, Math.floor(c.x), Math.floor(c.y), "ground");
    const lifts: Extract<FxEvent, { type: "goliathLift" }>[] = [];
    for (let i = 0; i < 150 * TICK_RATE && !lifts.some((e) => e.state === "setDown"); i++) {
      const cmds = tickAi(w, "red", ai);
      // a move, unload, stop or board sent to a Condor on a lift would redirect, set down or call it off
      for (const cmd of cmds)
        if ("unitIds" in cmd && cmd.type !== "lift")
          for (const id of cmd.unitIds) {
            const u = w.units.get(id);
            expect(u?.order.type === "lift", `${cmd.type} to lift Condor ${id}`).toBe(false);
          }
      step(w, cmds);
      for (const e of w.fx) if (e.type === "goliathLift" && e.faction === "red") lifts.push(e);
    }
    expect(lifts.some((e) => e.state === "hooked")).toBe(true);
    const down = lifts.find((e) => e.state === "setDown");
    expect(down).toBeDefined();
    // on an island, off the home land
    const there = regionAt(w, Math.floor(g.x), Math.floor(g.y), "ground");
    expect(there).not.toBe(home);
    expect(there).toBeGreaterThan(0);
    // …where it digs in and trains the crew
    const { cmds } = runRed(w, 40, ai);
    expect(isAnchored(g)).toBe(true);
    expect(cmds.some((cmd) => cmd.type === "produce" && cmd.buildingId === g.id)).toBe(true);
  }, 60000);
});

describe("the calldown dodge", () => {
  it("never moves a dug-in Goliath (a move packs it up) or a Condor on a lift; a walking Goliath steps out", () => {
    const w = createMapWorld("proving-grounds");
    const ai = createAiState("boom", "normal", 1);
    const c = buildingCenter(hqOf(w, "red")!);
    const at = { x: c.x - 4, y: c.y + 6 };
    const dug = spawnUnit(w, "goliath", "red", at.x, at.y);
    step(w, [{ type: "anchor", faction: "red", unitIds: [dug.id] }]);
    expect(dug.goliath!.mode).toBe("anchoring");
    const walker = spawnUnit(w, "goliath", "red", at.x + 2.2, at.y - 0.5);
    const lifted = spawnUnit(w, "goliath", "red", at.x - 0.5, at.y + 2.4);
    const condors = [0, 1].map((i) => spawnUnit(w, "condor", "red", lifted.x - 1 + i * 2, lifted.y + 0.5));
    step(w, [{ type: "lift", faction: "red", unitIds: condors.map((u) => u.id), goliathId: lifted.id }]);
    for (let i = 0; i < 20 && lifted.goliath!.lift?.phase !== "carrying"; i++) step(w, []);
    expect(lifted.goliath!.lift?.phase).toBe("carrying");
    // blue sees it all, and shells the lot
    tickFog(w);
    w.fog.blue.vis.fill(2);
    w.powers.meter.blue = 100;
    const shell: Command = { type: "calldown", faction: "blue", power: "barrage", x: at.x, y: at.y + 0.8 };
    const moved = new Set<number>();
    const liftMoved: number[] = [];
    for (let i = 0; i < 2 * TICK_RATE; i++) {
      const cmds = tickAi(w, "red", ai);
      for (const cmd of cmds)
        if (cmd.type === "move")
          for (const id of cmd.unitIds) {
            moved.add(id);
            if (w.units.get(id)?.order.type === "lift") liftMoved.push(id);
          }
      step(w, i === 0 ? [...cmds, shell] : cmds);
    }
    expect(w.powers.active.length).toBe(1);
    expect(moved.has(walker.id)).toBe(true);
    expect(moved.has(dug.id)).toBe(false);
    expect(dug.goliath!.mode).not.toBe("packing");
    // (a Condor on a lift is never told to move; set down, it's free to step out like anyone)
    expect(liftMoved).toEqual([]);
    for (const u of condors) expect(u.order.type === "lift" ? moved.has(u.id) : false).toBe(false);
  });
});

describe("after the HQ falls", () => {
  it("fights on with its Goliath: digs in, takes the harvesters' scrap, trains squads and builds in its ring", () => {
    const w = createMapWorld("proving-grounds");
    const ai = createAiState("balanced", "normal", 1);
    const hq = hqOf(w, "red")!;
    const c = buildingCenter(hq);
    const g = spawnUnit(w, "goliath", "red", c.x - 4, c.y + 6);
    spawnBuilding(w, "tech-lab", "red", hq.tx - 4, hq.ty + 1);
    spawnUnit(w, "harvester", "red", c.x + 2, c.y + 5);
    w.factions.red.scrap = 2000;
    removeBuilding(w, hq);
    const { cmds, fx } = runRed(w, 90, ai);
    expect(w.winner).toBeNull();
    expect(cmds.length).toBeGreaterThan(10);
    expect(isAnchored(g)).toBe(true);
    expect(cmds.some((cmd) => cmd.type === "produce" && cmd.buildingId === g.id)).toBe(true);
    expect(fx.some((e) => e.type === "deposit" && e.faction === "red" && Math.hypot(e.x - g.x, e.y - g.y) < 0.5)).toBe(true);
    expect(buildings(w, "red").filter((b) => b.kind !== "tech-lab").length).toBeGreaterThanOrEqual(1);
    expect(hqOf(w, "red")).toBeNull();
  }, 30000);
});

describe("hunting enemy Goliaths", () => {
  it("strikes a visible enemy Goliath with units that can hurt it (no Sniper Teams), its Menders first", () => {
    const w = createMapWorld("proving-grounds");
    const ai = createAiState("balanced", "normal", 1);
    const c = buildingCenter(hqOf(w, "red")!);
    const foe = spawnUnit(w, "goliath", "blue", 22.5, 22.5);
    foe.hp = UNITS.goliath.hp * 0.6; // (mortars down)
    const medic = spawnUnit(w, "mender", "blue", 23.5, 23.5);
    // (a scout of ours overhead: the Goliath is always in sight, its Mender only where we look)
    const eye = spawnUnit(w, "scout", "red", 25.5, 21.5);
    eye.hp = 1e9;
    for (const u of [foe, medic, eye]) w.powers.stunned.set(u.id, 1e9);
    const strike = [
      ...[0, 1, 2, 3].map((i) => spawnUnit(w, "lancer", "red", c.x - 4 + i, c.y + 8)),
      ...[0, 1, 2].map((i) => spawnUnit(w, "rocket-squad", "red", c.x - 4 + i, c.y + 9)),
      ...[0, 1].map((i) => spawnUnit(w, "raptor", "red", c.x - 4 + i, c.y + 10))
    ];
    const sniper = spawnUnit(w, "sniper", "red", c.x - 5, c.y + 9);
    step(w, []);
    tickFog(w);
    const cmds = tickAi(w, "red", ai);
    const onFoe = cmds.filter((cmd) => cmd.type === "attack" && cmd.targetId === foe.id).flatMap((cmd) => ("unitIds" in cmd ? cmd.unitIds : []));
    const onMedic = cmds.filter((cmd) => cmd.type === "attack" && cmd.targetId === medic.id).flatMap((cmd) => ("unitIds" in cmd ? cmd.unitIds : []));
    expect(onFoe.length).toBeGreaterThanOrEqual(2);
    expect(onMedic.length).toBeGreaterThanOrEqual(1);
    expect([...onFoe, ...onMedic]).not.toContain(sniper.id);
    expect([...onFoe, ...onMedic].every((id) => strike.some((u) => u.id === id))).toBe(true);
  });

  it("an enemy Goliath counts as heavy armour: the counters come (Rocket Squads at the Bay)", () => {
    const w = createMapWorld("proving-grounds");
    const ai = createAiState("balanced", "normal", 1);
    const hq = hqOf(w, "red")!;
    spawnBuilding(w, "assembly-bay", "red", hq.tx - 3, hq.ty + 4);
    spawnBuilding(w, "tech-lab", "red", hq.tx + 1, hq.ty + 4);
    w.factions.red.scrap = 3000;
    const foe = spawnUnit(w, "goliath", "blue", 20.5, 20.5);
    w.powers.stunned.set(foe.id, 1e9);
    const { cmds } = runRed(w, 20, ai);
    expect(ai.seenHeavy).toBeGreaterThanOrEqual(GOLIATH_AI.heavyWeight * 0.9);
    expect(cmds.some((cmd) => cmd.type === "produce" && cmd.unit === "rocket-squad")).toBe(true);
  });

  it("a wave goes for an enemy Gantry with a Goliath on the cradle before anything else", () => {
    const w = createMapWorld("proving-grounds");
    const ai = createAiState("balanced", "normal", 1);
    const red = buildingCenter(hqOf(w, "red")!);
    const blue = hqOf(w, "blue")!;
    const gantry = spawnBuilding(w, "gantry", "blue", blue.tx + 5, blue.ty - 4);
    gantry.queue.push({ kind: "goliath", remaining: UNITS.goliath.buildTime * TICK_RATE * 0.5 });
    const far = { x: w.width - red.x, y: w.height - red.y };
    const len = Math.hypot(far.x - red.x, far.y - red.y);
    const stage = { x: red.x + ((far.x - red.x) / len) * 9, y: red.y + ((far.y - red.y) / len) * 9 };
    for (let i = 0; i < 12; i++) spawnUnit(w, "stinger", "red", stage.x - 1 + (i % 4) * 0.7, stage.y - 1 + Math.floor(i / 4) * 0.7);
    step(w, []);
    const cmds = tickAi(w, "red", ai);
    expect(ai.mode).toBe("assault");
    expect(cmds.some((cmd) => cmd.type === "attack" && cmd.targetId === gantry.id)).toBe(true);
  });
});

describe("mutators", () => {
  /** AI vs AI under `mutators` until someone wins (or `mins` run out). */
  function play(map: string, blue: StrategyName, red: StrategyName, mins: number, mutators: ("nomads" | "robotlove")[]) {
    const w = createMapWorld(map, { mutators });
    const ai = { blue: createAiState(blue, "normal", 3), red: createAiState(red, "normal", 4) };
    const peak = { blue: 0, red: 0 };
    const harvestersBuilt = perSide(() => 0);
    for (let i = 0; i < mins * 60 * TICK_RATE && !w.winner; i++) {
      const cmds = [...tickAi(w, "blue", ai.blue), ...tickAi(w, "red", ai.red)];
      for (const c of cmds) if (c.type === "produce" && c.unit === "harvester") harvestersBuilt[c.faction]++;
      step(w, cmds);
      if (w.tick % (10 * TICK_RATE) === 0)
        for (const f of ["blue", "red"] as const)
          peak[f] = Math.max(peak[f], units(w, f).filter((u) => u.kind !== "harvester" && u.kind !== "goliath").reduce((v, u) => v + UNITS[u.kind].cost, 0));
    }
    return { w, peak, harvestersBuilt };
  }

  for (const [map, blue, red] of [["riverlands", "balanced", "ironclad"], ["ashlands", "boom", "rush"]] as const)
    it(`Nomads on ${map}: both sides build an economy and an army round their Goliaths, and the match ends`, () => {
      const { w, peak, harvestersBuilt } = play(map, blue, red, 25, ["nomads"]);
      for (const f of ["blue", "red"] as const) {
        expect(harvestersBuilt[f], f).toBeGreaterThanOrEqual(2);
        expect(peak[f], f).toBeGreaterThan(1500);
      }
      expect(w.winner).not.toBeNull();
    }, 120000);

  it("Nomads: the AI builds Harvesters at its Goliath and its base in the ring, and keeps a Goliath dug in", () => {
    const w = createMapWorld("riverlands", { mutators: ["nomads"] });
    const ai = createAiState("balanced", "normal", 1);
    const g = goliathsOf(w, "red")[0]!;
    let unanchored = 0;
    const { cmds } = runRed(w, 150, ai, () => {
      if (!goliathsOf(w, "red").some(isAnchored)) unanchored++;
    });
    expect(cmds.some((c) => c.type === "produce" && c.unit === "harvester" && c.buildingId === g.id)).toBe(true);
    const kinds = buildings(w, "red").map((b) => b.kind);
    expect(kinds).toContain("fab-plant");
    expect(kinds).toContain("airpad");
    expect(buildings(w, "red").every((b) => b.outpost)).toBe(true);
    expect(unanchored).toBeLessThan(30 * TICK_RATE);
  }, 30000);

  it("Robot Love: a commander that isn't losing walks its Goliath away from an enemy one", () => {
    const w = createMapWorld("proving-grounds", { mutators: ["robotlove"] });
    const ai = createAiState("boom", "normal", 1);
    const c = buildingCenter(hqOf(w, "red")!);
    const g = spawnUnit(w, "goliath", "red", c.x - 6, c.y + 10);
    for (let i = 0; i < 6; i++) spawnUnit(w, "stinger", "red", c.x - 3 + i, c.y + 4);
    const suitor = spawnUnit(w, "goliath", "blue", g.x - 7, g.y + 3);
    w.powers.stunned.set(suitor.id, 1e9);
    runRed(w, 15, ai);
    expect(Math.hypot(g.x - suitor.x, g.y - suitor.y)).toBeGreaterThan(GOLIATH.love.range + 2);
    expect(w.winner).toBeNull();
  });

  it("Robot Love: a commander plainly losing goes to meet the enemy's Goliath (a draw beats a loss)", () => {
    const w = createMapWorld("proving-grounds", { mutators: ["robotlove"] });
    const ai = createAiState("boom", "normal", 1);
    const c = buildingCenter(hqOf(w, "red")!);
    const g = spawnUnit(w, "goliath", "red", c.x - 4, c.y + 6);
    g.hp = UNITS.goliath.hp * 0.5;
    // a big enemy army at the gates (frozen), and their Goliath a little way off
    for (let i = 0; i < 12; i++) w.powers.stunned.set(spawnUnit(w, "mastodon", "blue", c.x - 6 + (i % 4), c.y + 1 + Math.floor(i / 4)).id, 1e9);
    const suitor = spawnUnit(w, "goliath", "blue", g.x - 12, g.y + 8);
    w.powers.stunned.set(suitor.id, 1e9);
    tickFog(w);
    const { cmds } = runRed(w, 4, ai);
    expect(cmds.some((cmd) => cmd.type === "move" && cmd.unitIds.includes(g.id) && Math.hypot(cmd.x - suitor.x, cmd.y - suitor.y) < 2)).toBe(true);
  });
});

describe("determinism", () => {
  it("the Goliath plans are plain data: the same match twice gives the same phases", () => {
    const run = () => {
      const w = createMapWorld("proving-grounds");
      const ai = createAiState("boom", "normal", 5);
      const c = buildingCenter(hqOf(w, "red")!);
      const g = spawnUnit(w, "goliath", "red", c.x - 3, c.y + 5);
      runRed(w, 60, ai);
      return `${g.x.toFixed(6)} ${g.y.toFixed(6)} ${[...goliathPhases(ai).values()].join(",")} ${w.factions.red.scrap.toFixed(4)}`;
    };
    expect(run()).toBe(run());
  });
});

export type { Unit };

describe("final review regressions", () => {
  /** Red Boom on the Archipelago with an Airpad, a Goliath by its HQ and `condors` Condors, 2,000 scrap. */
  function islands(condors: number, mutators: ("robotlove")[] = []) {
    const w = createMapWorld("archipelago", { objectives: true, mutators });
    const ai = createAiState("boom", "normal", 1);
    const hq = hqOf(w, "red")!;
    const c = buildingCenter(hq);
    hqOf(w, "blue")!.hp = 1e9;
    spawnBuilding(w, "airpad", "red", hq.tx - 3, hq.ty + 4);
    const g = spawnUnit(w, "goliath", "red", c.x - 4, c.y + 6);
    const cs = Array.from({ length: condors }, (_, i) => spawnUnit(w, "condor", "red", c.x + 3 + i, c.y + 4));
    w.factions.red.scrap = 2000;
    return { w, ai, g, cs, c };
  }

  it("a lift whose Condors the sim hooks on the other way round isn't called off for the wrong Condor's HP", () => {
    const { w, ai, g, cs } = islands(3);
    let issued = false;
    const states: string[] = [];
    for (let i = 0; i < 200 * TICK_RATE && !states.includes("setDown"); i++) {
      // one Condor at full HP and two hurt ones, until the AI picks two
      if (!issued) [cs[0]!.hp, cs[1]!.hp, cs[2]!.hp] = [UNITS.condor.hp, UNITS.condor.hp * 0.55, UNITS.condor.hp * 0.55];
      const cmds = tickAi(w, "red", ai);
      for (const cmd of cmds)
        if (cmd.type === "lift") {
          issued = true;
          // the first-named Condor by the right hook point, the other off to the side: the sim swaps them
          const [a, b] = cmd.unitIds.map((id) => w.units.get(id)!);
          const r = { x: Math.cos(g.facing), y: Math.sin(g.facing) };
          a!.x = g.x + r.x * 2;
          a!.y = g.y + r.y * 2;
          b!.x = g.x - r.y * 4;
          b!.y = g.y + r.x * 4;
        }
      step(w, cmds);
      for (const e of w.fx) if (e.type === "goliathLift" && e.faction === "red") states.push(e.state);
    }
    expect(issued).toBe(true);
    expect(states[0]).toBe("hooked");
    // flown all the way to its site and set down there, not dropped back where it started
    expect(states).toContain("setDown");
    expect(goliathSite(ai, g.id)?.lift).toBe(true);
    expect(Math.hypot(g.x - goliathSite(ai, g.id)!.x, g.y - goliathSite(ai, g.id)!.y)).toBeLessThan(2);
  }, 60000);

  it("Robot Love: a lift never flies over an enemy Goliath, even one with its laser down", () => {
    const { w, ai, g } = islands(3, ["robotlove"]);
    for (let i = 0; i < w.scrap.length; i++) w.scrap[i] = Math.min(w.scrap[i]!, 20); // (no field worth a walk)
    const relay = { x: 57.5, y: 54.5 };
    const suitor = spawnUnit(w, "goliath", "blue", (g.x + relay.x) / 2, (g.y + relay.y) / 2);
    suitor.hp = UNITS.goliath.hp * 0.45;
    w.powers.stunned.set(suitor.id, 1e9);
    step(w, []);
    tickFog(w);
    for (let i = 0; i < 120 * TICK_RATE && !w.winner; i++) step(w, tickAi(w, "red", ai));
    expect(w.winner).toBeNull();
  }, 60000);

  it("a Goliath dug in at an island relay that starts losing stays dug in (it can't walk home)", () => {
    const { w, ai, g, c } = islands(3);
    const fields = Float64Array.from(w.scrap);
    for (let i = 0; i < w.scrap.length; i++) w.scrap[i] = Math.min(w.scrap[i]!, 20);
    const home = regionAt(w, Math.floor(c.x), Math.floor(c.y), "ground");
    let at = -1;
    for (let i = 0; i < 300 * TICK_RATE && (at < 0 || w.tick - at < 60 * TICK_RATE); i++) {
      step(w, tickAi(w, "red", ai));
      if (at < 0 && isAnchored(g) && regionAt(w, Math.floor(g.x), Math.floor(g.y), "ground") !== home) {
        at = w.tick;
        g.hp = UNITS.goliath.hp * 0.5;
        for (let k = 0; k < w.scrap.length; k++) w.scrap[k] = fields[k]!;
        // an enemy force lands on the island (frozen, sturdy)
        for (let k = 0; k < 18; k++) {
          const e = spawnUnit(w, "rocket-squad", "blue", g.x + 4 + (k % 2), g.y - 3 + Math.floor(k / 2));
          e.hp = 1e6;
          w.powers.stunned.set(e.id, 1e9);
        }
      }
    }
    expect(at).toBeGreaterThan(0);
    expect(g.goliath!.mode).toBe("anchored");
  }, 60000);

  it("Robot Love: a Condor held for a lift is let go when love calls the lift off", () => {
    const { w, ai, g, cs } = islands(1, ["robotlove"]);
    const condor = cs[0]!;
    let suitor: Unit | null = null;
    let after = 0;
    for (let i = 0; i < 400 * TICK_RATE && !w.winner && after < 30 * TICK_RATE; i++) {
      for (const u of [...w.units.values()]) if (u.kind === "condor" && u.faction === "red" && u.id !== condor.id) w.units.delete(u.id);
      step(w, tickAi(w, "red", ai));
      if (suitor) after++;
      else if (goliathPhases(ai).get(g.id) === "lift" && liftCondors(w, "red", ai).has(condor.id)) {
        suitor = spawnUnit(w, "goliath", "blue", g.x - 8.5, g.y + 1);
        w.powers.stunned.set(suitor.id, 1e9);
      }
    }
    expect(suitor).not.toBeNull();
    expect(goliathPhases(ai).get(g.id)).not.toBe("lift");
    expect(liftCondors(w, "red", ai).has(condor.id)).toBe(false);
  }, 60000);

  it("Nomads + Robot Love: with its base not under attack, the AI doesn't uproot its only Goliath to court", () => {
    const w = createMapWorld("riverlands", { mutators: ["nomads", "robotlove"] });
    const ai = createAiState("balanced", "normal", 1);
    const red = goliathsOf(w, "red")[0]!;
    const blue = goliathsOf(w, "blue")[0]!;
    // blue fields three Goliaths at home, far from red's base: red is "losing", but nothing threatens it
    for (const [dx, dy] of [[0, 0], [6, -6], [6, -1]] as const) {
      const u = dx === 0 ? blue : spawnUnit(w, "goliath", "blue", blue.x + dx, blue.y + dy);
      w.powers.stunned.set(u.id, 1e9);
    }
    let packed = false;
    for (let i = 0; i < 30 * TICK_RATE && !w.winner; i++) {
      const cmds = tickAi(w, "red", ai);
      if (cmds.some((c) => c.type === "packUp" && c.unitIds.includes(red.id))) packed = true;
      step(w, cmds);
    }
    expect(packed).toBe(false);
    expect(red.goliath!.mode).toBe("anchored");
    expect(w.winner).toBeNull();
  }, 60000);
});

describe("a free-for-all (ai/ffa.ts)", () => {
  /**
   * Nomads on `map` at `minutes`, the fields mined out: red (Skyforce) has its
   * base Goliath dug in, three more walking a few tiles out toward the middle
   * and an army of Stingers; its rival `foe` (red's focus on Compass Rose) has
   * its one Goliath dug in at home, and its starting squad.
   */
  function goliathWar(map: string, minutes: number, foe: Faction) {
    const w = createMapWorld(map, { mutators: ["nomads"] });
    w.scrap.fill(0);
    w.tick = minutes * 60 * TICK_RATE;
    const ai = createAiState("skyforce", "normal", 1);
    if (map === "compass-rose") {
      ai.focus = foe;
      ai.focusUntil = Infinity;
    }
    const base = goliathsOf(w, "red")[0]!;
    const k = 1 / Math.hypot(w.width / 2 - base.x, w.height / 2 - base.y);
    const [dx, dy] = [(w.width / 2 - base.x) * k, (w.height / 2 - base.y) * k];
    const walkers = [-3, 0, 3].map((o) => spawnUnit(w, "goliath", "red", base.x + dx * 7 - dy * o, base.y + dy * 7 + dx * o));
    for (let i = 0; i < 12; i++) spawnUnit(w, "stinger", "red", base.x + dx * 10 - dy * (i % 4 - 1.5), base.y + dy * 10 + dx * (i % 4 - 1.5) + Math.floor(i / 4) * dy);
    return { w, ai, walkers, target: goliathsOf(w, foe)[0]! };
  }
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y) < 1;

  it("from 12:00 the walking Goliaths march on the focus's base Goliath once they outgun it, and the focus holds while they do", () => {
    const { w, ai, walkers, target } = goliathWar("compass-rose", 13, "green");
    const before = walkers.map((g) => Math.hypot(g.x - target.x, g.y - target.y));
    const { cmds } = runRed(w, 40, ai);
    expect(ai.push).toBe(target.id);
    for (const g of walkers) expect(cmds.some((c) => c.type === "attackMove" && c.unitIds.includes(g.id) && near(c, target)), `#${g.id}`).toBe(true);
    walkers.forEach((g, i) => expect(before[i]! - Math.hypot(g.x - target.x, g.y - target.y)).toBeGreaterThan(15));
    // its time up, the focus stays on green while the march is on
    ai.focusUntil = 0;
    runRed(w, 10, ai);
    expect(ai.focus).toBe("green");
    expect(ai.push).toBe(target.id);
  }, 60000);

  it("no push before 12:00, nor while outgunned, nor with FFA_TACTICS.push off, nor in a duel", () => {
    const pushes = (setup: ReturnType<typeof goliathWar>) => {
      const { cmds } = runRed(setup.w, 40, setup.ai);
      return setup.ai.push !== undefined || cmds.some((c) => c.type === "attackMove" && setup.walkers.some((g) => c.unitIds.includes(g.id)) && near(c, setup.target));
    };
    expect(pushes(goliathWar("compass-rose", 11, "green"))).toBe(false);
    // four more Goliaths at green's base (always in sight): 5 × 1600 of firepower against 1800 + 3 × 1600
    const outgunned = goliathWar("compass-rose", 13, "green");
    for (let i = 0; i < 4; i++) spawnUnit(outgunned.w, "goliath", "green", outgunned.target.x + 3 + (i % 2) * 3, outgunned.target.y + 3 + Math.floor(i / 2) * 3);
    expect(pushes(outgunned)).toBe(false);
    FFA_TACTICS.push = false;
    try {
      expect(pushes(goliathWar("compass-rose", 13, "green"))).toBe(false);
    } finally {
      FFA_TACTICS.push = true;
    }
    expect(pushes(goliathWar("riverlands", 13, "blue"))).toBe(false);
  }, 60000);

  it("a base Goliath none of ours can walk to is passed over for the next one, and with none left there's no push", () => {
    /** `foe`'s base Goliath walled in by rock (two tiles thick, five out), and maybe a second one of its walking 14 tiles out toward the middle. */
    const walledIn = (second: boolean) => {
      const setup = goliathWar("compass-rose", 13, "green");
      const { w, target } = setup;
      const [tx, ty] = [Math.floor(target.x), Math.floor(target.y)];
      for (let oy = -6; oy <= 6; oy++)
        for (let ox = -6; ox <= 6; ox++)
          if (Math.max(Math.abs(ox), Math.abs(oy)) >= 5 && tx + ox >= 0 && ty + oy >= 0 && tx + ox < w.width && ty + oy < w.height)
            setTerrain(w, tx + ox, ty + oy, Terrain.Rock);
      const k = 14 / Math.hypot(w.width / 2 - target.x, w.height / 2 - target.y);
      const other = second ? spawnUnit(w, "goliath", "green", target.x + (w.width / 2 - target.x) * k, target.y + (w.height / 2 - target.y) * k) : null;
      return { ...setup, other };
    };
    const lone = walledIn(false);
    const { cmds } = runRed(lone.w, 40, lone.ai);
    expect(lone.ai.push).toBeUndefined();
    expect(cmds.some((c) => c.type === "attackMove" && lone.walkers.some((g) => c.unitIds.includes(g.id)) && near(c, lone.target))).toBe(false);
    const two = walledIn(true);
    runRed(two.w, 40, two.ai);
    expect(two.ai.push).toBe(two.other!.id);
  }, 60000);

  it("a mined-out map: no more Harvesters or garrison squads (a duel's commander still trains both)", () => {
    for (const map of ["compass-rose", "riverlands"]) {
      const w = createMapWorld(map, { mutators: ["nomads"] });
      w.scrap.fill(0);
      w.factions.red.scrap = 3000;
      const ai = createAiState("balanced", "normal", 1);
      const { cmds } = runRed(w, 30, ai);
      const trained = cmds.filter((c) => c.type === "produce" && ["harvester", "trooper", "rocket-squad"].includes(c.unit));
      if (map === "compass-rose") {
        expect(ai.dry).toBe(true);
        expect(trained).toEqual([]);
      } else expect(trained.length, map).toBeGreaterThan(0);
    }
  }, 60000);

  it("with the calldown aim on, from 12:00 the Sky Hammer is aimed by the damage it would do: not at a whole Goliath, at a hurt one (a duel's aim unchanged)", () => {
    /** Red's Hammer this pass with `foe`'s Goliath (at `hp`) in sight and its ground explored, or undefined. */
    const hammer = (map: string, foe: Faction, hp: number) => {
      const w = createMapWorld(map, { mutators: ["nomads"] });
      w.tick = 13 * 60 * TICK_RATE;
      const g = goliathsOf(w, foe)[0]!;
      g.hp = hp;
      spawnUnit(w, "scout", "red", g.x + 2, g.y + 2).hp = 1e9;
      tickFog(w);
      const c = tickAi(w, "red", createAiState("balanced", "normal", 1)).find((c) => c.type === "calldown" && c.power === "hammer");
      return c?.type === "calldown" ? Math.hypot(c.x - g.x, c.y - g.y) : undefined;
    };
    FFA_TACTICS.calldownAim = true; // (off in play)
    try {
      // 260 of a whole Goliath's 3000 (a Mender heals it in half a minute): not worth it
      expect(hammer("compass-rose", "green", UNITS.goliath.hp)).toBeUndefined();
      // one it would finish: on it
      expect(hammer("compass-rose", "green", 200)).toBeLessThan(2);
      expect(hammer("riverlands", "blue", UNITS.goliath.hp)).toBeLessThan(2);
    } finally {
      FFA_TACTICS.calldownAim = false;
    }
  }, 60000);
});
