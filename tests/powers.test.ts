import { describe, expect, it } from "vitest";
import { createAiState, tickAi } from "../src/sim/ai/commander";
import { dodgeCalldowns } from "../src/sim/ai/powers";
import { BUILDINGS, POWERS, TICK_RATE, UNITS } from "../src/sim/balance";
import { tickFog } from "../src/sim/fog";
import { createMapWorld } from "../src/sim/maps";
import { pickAiOpener } from "../src/sim/openers";
import { calldownBlocker, isStunned, powerStatus, telegraphTicks } from "../src/sim/powers";
import { step } from "../src/sim/sim";
import { Terrain, type Command, type Faction, type FxEvent, type PowerKind, type World } from "../src/sim/types";
import { createWorld, setTerrain, spawnBuilding, spawnUnit } from "../src/sim/world";
import { FACTIONS, perSide } from "../src/sim/sides";

/** A small open field with both HQs, fog computed, meters full. */
function arena(size = 40): World {
  const w = createWorld(size, size);
  spawnBuilding(w, "hq", "blue", 2, 2);
  spawnBuilding(w, "hq", "red", size - 5, size - 5);
  w.powers.meter.blue = w.powers.meter.red = 100;
  return w;
}

/** Let `f` see the whole map (calldowns need explored / visible ground). */
function reveal(w: World, f: Faction): void {
  tickFog(w);
  w.fog[f].vis.fill(2);
}

const call = (faction: Faction, power: PowerKind, x: number, y: number): Command => ({ type: "calldown", faction, power, x, y });

/** Step n ticks (the first with `cmds`), collecting every fx event. */
function run(w: World, n: number, cmds: Command[] = []): FxEvent[] {
  const out: FxEvent[] = [];
  for (let i = 0; i < n; i++) {
    step(w, i === 0 ? cmds : []);
    out.push(...w.fx);
    if (w.fog.blue.vis[0] !== 2) w.fog.blue.vis.fill(2); // keep the test field revealed
  }
  return out;
}

/** Freeze a unit as a target dummy: no shooting back, no wandering. */
const dummy = (w: World, kind: Parameters<typeof spawnUnit>[1], f: Faction, x: number, y: number) => {
  const u = spawnUnit(w, kind, f, x, y);
  u.cooldown = 1e9;
  return u;
};

describe("command meter", () => {
  it("fills slowly on its own, faster from losses than from kills, and caps at 100", () => {
    const w = arena();
    w.powers.meter.blue = w.powers.meter.red = 0;
    run(w, 10 * TICK_RATE);
    expect(w.powers.meter.blue).toBeCloseTo(POWERS.passive * 10, 5);
    // red loses a Mastodon to blue
    const t = dummy(w, "mastodon", "red", 20, 20);
    t.hp = 0;
    const before = { ...w.powers.meter };
    run(w, 1);
    const tick = POWERS.passive / TICK_RATE;
    expect(w.powers.meter.red - before.red).toBeCloseTo(UNITS.mastodon.cost * POWERS.perScrapLost + tick, 5);
    expect(w.powers.meter.blue - before.blue).toBeCloseTo(UNITS.mastodon.cost * POWERS.perScrapKilled + tick, 5);
    expect(POWERS.perScrapLost).toBeGreaterThan(POWERS.perScrapKilled * 2); // comeback-weighted
    w.powers.meter.blue = 99.99;
    run(w, 20);
    expect(w.powers.meter.blue).toBe(POWERS.meterMax);
  });
});

describe("calldown validation", () => {
  it("needs charge, an off-cooldown power and explored ground — for every side alike", () => {
    const w = arena();
    tickFog(w);
    w.powers.meter.blue = POWERS.barrage.cost - 1;
    expect(calldownBlocker(w, "blue", "barrage", 5, 5)).toMatch(/charge/);
    run(w, 1, [call("blue", "barrage", 5, 5)]);
    expect(w.powers.active).toHaveLength(0);
    expect(w.powers.meter.blue).toBeLessThan(POWERS.barrage.cost); // nothing spent

    w.powers.meter.blue = 100;
    // the far corner is unexplored
    expect(calldownBlocker(w, "blue", "barrage", 35, 35)).toMatch(/unexplored/);
    run(w, 1, [call("blue", "barrage", 35, 35)]);
    expect(w.powers.active).toHaveLength(0);

    // a legal call spends the charge and starts the cooldown
    expect(calldownBlocker(w, "blue", "barrage", 6, 6)).toBeNull();
    const fx = run(w, 1, [call("blue", "barrage", 6, 6)]);
    expect(w.powers.active).toHaveLength(1);
    expect(w.powers.meter.blue).toBeCloseTo(100 - POWERS.barrage.cost, 0);
    expect(fx.some((e) => e.type === "calldown" && e.power === "barrage" && e.faction === "blue")).toBe(true);
    expect(calldownBlocker(w, "blue", "barrage", 6, 6)).toMatch(/recharging/);
    expect(powerStatus(w, "blue", "barrage").cooldown).toBeGreaterThan(POWERS.barrage.cooldown * TICK_RATE - 3);
    // the other powers have their own cooldowns
    expect(calldownBlocker(w, "blue", "emp", 6, 6)).toBeNull();
  });

  it("Drop Pods need eyes on open ground", () => {
    const w = arena();
    tickFog(w);
    // explored (remembered) but not visible right now
    w.fog.blue.vis[20 * w.width + 20] = 1;
    expect(calldownBlocker(w, "blue", "droppod", 20.5, 20.5)).toMatch(/eyes/);
    setTerrain(w, 6, 7, Terrain.Water);
    expect(calldownBlocker(w, "blue", "droppod", 6.5, 7.5)).toMatch(/open ground/);
    expect(calldownBlocker(w, "blue", "droppod", 7.5, 7.5)).toBeNull();
  });

  it("telegraphs are public: the reticle is in the shared state and fx, fog or not", () => {
    const w = arena();
    reveal(w, "red");
    const fx = run(w, 1, [call("red", "emp", 4, 8)]);
    // blue can't see red's side at all, yet gets the warning
    const ev = fx.find((e) => e.type === "calldown");
    expect(ev).toMatchObject({ faction: "red", power: "emp", x: 4, y: 8, radius: POWERS.emp.radius });
    expect(w.powers.active[0]).toMatchObject({ faction: "red", power: "emp" });
  });
});

describe("barrage", () => {
  it("is telegraphed, then 3 seeded shells land over ~0.6 s and hit only enemies", () => {
    const w = arena();
    reveal(w, "blue");
    const foe = dummy(w, "stinger", "red", 20, 20);
    const friend = dummy(w, "stinger", "blue", 20.4, 20);
    const fx = run(w, 1, [call("blue", "barrage", 20, 20)]);
    const landTick = (fx.find((e) => e.type === "calldown") as Extract<FxEvent, { type: "calldown" }>).landTick;
    expect(landTick - (w.tick - 1)).toBe(telegraphTicks("barrage"));
    const shells = w.powers.active[0]!.shells;
    expect(shells.map((s) => s.tick)).toEqual([0, 1, 2].map((i) => landTick + i * POWERS.barrage.shellGap * TICK_RATE));
    for (const s of shells) expect(Math.hypot(s.x - 20, s.y - 20)).toBeLessThanOrEqual(POWERS.barrage.scatter + 1e-9);
    // nothing lands during the telegraph
    run(w, landTick - w.tick);
    expect(foe.hp).toBe(UNITS.stinger.hp);
    const impacts = run(w, 8).filter((e) => e.type === "calldownImpact");
    expect(impacts).toHaveLength(3);
    expect(w.units.has(foe.id)).toBe(false); // three shells kill a light tank in the open
    expect(friend.hp).toBe(UNITS.stinger.hp); // no friendly fire
    expect(w.powers.active).toHaveLength(0);
  });

  it("can be dodged: a unit that drives clear in time takes nothing", () => {
    const w = arena();
    reveal(w, "blue");
    const foe = spawnUnit(w, "stinger", "red", 20, 20);
    run(w, 1, [call("blue", "barrage", 20, 20)]);
    foe.order = { type: "move", x: 20, y: 27 };
    run(w, 40);
    expect(foe.hp).toBe(UNITS.stinger.hp);
  });

  it("credits kills to the firing side (its HQ is the killer)", () => {
    const w = arena();
    reveal(w, "blue");
    const foe = dummy(w, "mortar", "red", 20, 20);
    const fx = run(w, 40, [call("blue", "barrage", 20, 20)]);
    const death = fx.find((e) => e.type === "death" && e.id === foe.id) as Extract<FxEvent, { type: "death" }>;
    expect(death).toBeDefined();
    const blueHq = [...w.buildings.values()].find((b) => b.kind === "hq" && b.faction === "blue")!;
    expect(death.killerId).toBe(blueHq.id);
    expect(w.factions.blue.stats.unitsKilled).toBe(1);
  });

  it("in a free-for-all, a side with no HQ still makes its kills (stats, ⚡ and the death's `by`)", () => {
    const w = createWorld(40, 40);
    w.sides = [...FACTIONS];
    spawnUnit(w, "goliath", "blue", 4, 4); // (no HQ: the Armada's way; the Goliath keeps blue in the match)
    spawnBuilding(w, "hq", "red", 35, 35);
    spawnBuilding(w, "hq", "green", 2, 35);
    spawnBuilding(w, "hq", "purple", 35, 2);
    w.powers.meter.blue = 100;
    reveal(w, "blue");
    const foe = dummy(w, "mortar", "red", 20, 20);
    const fx = run(w, 40, [call("blue", "barrage", 20, 20)]);
    const death = fx.find((e) => e.type === "death" && e.id === foe.id) as Extract<FxEvent, { type: "death" }>;
    expect(death).toBeDefined();
    expect(death.killerId).toBeNull(); // (no unit of blue's takes the XP)
    expect(death.by).toBe("blue");
    expect(w.factions.blue.stats.unitsKilled).toBe(1);
  });

  it("scatter is seeded by the match: same seed same shells, another seed differs", () => {
    const shellsFor = (seed: number) => {
      const w = arena();
      w.seed = seed;
      reveal(w, "blue");
      run(w, 1, [call("blue", "barrage", 20, 20)]);
      return w.powers.active[0]!.shells;
    };
    expect(shellsFor(7)).toEqual(shellsFor(7));
    expect(shellsFor(7)).not.toEqual(shellsFor(8));
  });
});

describe("EMP", () => {
  it("freezes enemy units (no moving or firing) and buildings (no production) for ~4 s", () => {
    const w = arena();
    reveal(w, "blue");
    const runner = spawnUnit(w, "stinger", "red", 20, 20);
    runner.order = { type: "move", x: 20, y: 30 };
    const gunner = spawnUnit(w, "stinger", "red", 21, 20);
    const target = dummy(w, "harvester", "blue", 21, 22.5);
    const fab = spawnBuilding(w, "fab-plant", "red", 18, 18);
    fab.queue.push({ kind: "stinger", remaining: 50 });
    const outside = spawnUnit(w, "stinger", "red", 30, 30);
    outside.order = { type: "move", x: 30, y: 36 };
    run(w, 1, [call("blue", "emp", 20, 20)]);
    // the pulse lands after its short telegraph
    const fx = run(w, telegraphTicks("emp"));
    const stun = fx.find((e) => e.type === "stun") as Extract<FxEvent, { type: "stun" }>;
    expect(stun.ids).toEqual(expect.arrayContaining([runner.id, gunner.id, fab.id]));
    expect(stun.ids).not.toContain(outside.id);
    expect(stun.ids).not.toContain(target.id); // friendly units are untouched
    const at = { x: runner.x, y: runner.y };
    const harvHp = target.hp;
    const queued = fab.queue[0]!.remaining;
    run(w, POWERS.emp.stun * TICK_RATE - 2);
    expect(isStunned(w, runner.id)).toBe(true);
    expect({ x: runner.x, y: runner.y }).toEqual(at);
    expect(target.hp).toBe(harvHp); // the gunner held its fire
    expect(fab.queue[0]!.remaining).toBe(queued);
    expect(outside.y).toBeGreaterThan(30.5); // the one outside kept driving
    run(w, 5);
    expect(isStunned(w, runner.id)).toBe(false);
    run(w, 10);
    expect(runner.y).toBeGreaterThan(at.y);
    expect(fab.queue[0]?.remaining ?? 0).toBeLessThan(queued);
  });
});

describe("drop pod", () => {
  it("lands 2 Stingers + a Flak after its descent; with a Tech Lab, 2 Lancers + Flak", () => {
    for (const tech of [false, true]) {
      const w = arena();
      if (tech) spawnBuilding(w, "tech-lab", "blue", 7, 2);
      reveal(w, "blue");
      const before = new Set(w.units.keys());
      run(w, 1, [call("blue", "droppod", 12.5, 12.5)]);
      run(w, telegraphTicks("droppod") - 1);
      expect([...w.units.keys()].filter((id) => !before.has(id))).toHaveLength(0);
      const fx = run(w, 1);
      const landed = [...w.units.values()].filter((u) => !before.has(u.id));
      expect(landed.map((u) => u.kind).sort()).toEqual(
        (tech ? ["flak-crawler", "lancer", "lancer"] : ["flak-crawler", "stinger", "stinger"]).sort()
      );
      for (const u of landed) {
        expect(u.faction).toBe("blue");
        expect(Math.hypot(u.x - 12.5, u.y - 12.5)).toBeLessThan(2);
      }
      const imp = fx.find((e) => e.type === "calldownImpact") as Extract<FxEvent, { type: "calldownImpact" }>;
      expect(imp.unitIds.sort()).toEqual(landed.map((u) => u.id).sort());
    }
  });

  it("crew step out onto ground they can stand on", () => {
    const w = arena();
    // rock all around the landing tile except to its west
    for (let y = 10; y < 16; y++) for (let x = 12; x < 18; x++) if (x !== 12 || y !== 12) setTerrain(w, x, y, Terrain.Rock);
    reveal(w, "blue");
    run(w, 1 + telegraphTicks("droppod"), [call("blue", "droppod", 12.5, 12.5)]);
    const crew = [...w.units.values()].filter((u) => u.faction === "blue");
    expect(crew).toHaveLength(3);
    for (const u of crew) expect(w.terrain[Math.floor(u.y) * w.width + Math.floor(u.x)]).not.toBe(Terrain.Rock);
  });
});

describe("Sky Hammer", () => {
  it("unlocks for both sides at 6:00, then recharges on its own timer", () => {
    const w = arena();
    reveal(w, "blue");
    const unlock = POWERS.hammer.unlock * TICK_RATE;
    expect(calldownBlocker(w, "blue", "hammer", 20, 20)).toMatch(/online/);
    w.tick = unlock - 2;
    let fx = run(w, 3);
    expect(fx.filter((e) => e.type === "powerOnline" && e.power === "hammer").map((e) => (e as { faction: string }).faction).sort()).toEqual(["blue", "red"]);
    expect(powerStatus(w, "blue", "hammer").ready).toBe(true);
    expect(powerStatus(w, "red", "hammer").ready).toBe(true);
    // it runs on its own timer, not the meter
    w.powers.meter.blue = 0;
    fx = run(w, 1, [call("blue", "hammer", 20, 20)]);
    expect(fx.some((e) => e.type === "calldown" && e.power === "hammer")).toBe(true);
    expect(powerStatus(w, "blue", "hammer").cooldown).toBeGreaterThan(POWERS.hammer.cooldown * TICK_RATE - 3);
    expect(powerStatus(w, "red", "hammer").ready).toBe(true);
  });

  it("units take 260 × (1 − 0.5·d/r), buildings a flat 700 (an HQ loses ~22%)", () => {
    const w = arena();
    reveal(w, "blue");
    w.tick = POWERS.hammer.unlock * TICK_RATE;
    const hq = [...w.buildings.values()].find((b) => b.kind === "hq" && b.faction === "red")!;
    const R = POWERS.hammer.radius;
    const at = { x: 30, y: 30 };
    const centre = dummy(w, "mastodon", "red", at.x, at.y);
    const edge = dummy(w, "mastodon", "red", at.x - R + 0.05, at.y);
    const air = dummy(w, "raptor", "red", at.x, at.y + 1);
    // (spaced so separation steering doesn't nudge anyone between ticks)
    const far = dummy(w, "mastodon", "red", at.x - R - 0.3, at.y + 1.5);
    const mine = dummy(w, "mastodon", "blue", at.x, at.y - 1.6);
    run(w, 1, [call("blue", "hammer", at.x, at.y)]);
    run(w, telegraphTicks("hammer") - 1);
    expect(centre.hp).toBe(UNITS.mastodon.hp);
    run(w, 1);
    expect(UNITS.mastodon.hp - centre.hp).toBeCloseTo(POWERS.hammer.unitDamage, 5);
    expect(UNITS.mastodon.hp - edge.hp).toBeCloseTo(POWERS.hammer.unitDamage * (1 - 0.5 * ((R - 0.05) / R)), 5);
    expect(air.hp).toBeLessThan(UNITS.raptor.hp); // orbital: hits aircraft too
    expect(far.hp).toBe(UNITS.mastodon.hp);
    expect(mine.hp).toBe(UNITS.mastodon.hp);
    // a second strike just off the red HQ's edge: buildings take the flat hit
    w.powers.readyAt.blue.hammer = 0;
    run(w, 1 + telegraphTicks("hammer"), [call("blue", "hammer", hq.tx + 1.5, hq.ty - 1)]);
    expect(BUILDINGS.hq.hp - hq.hp).toBe(POWERS.hammer.buildingDamage);
    expect(POWERS.hammer.buildingDamage / BUILDINGS.hq.hp).toBeGreaterThan(0.2);
    expect(POWERS.hammer.buildingDamage / BUILDINGS.hq.hp).toBeLessThan(0.25);
  });
});

describe("determinism", () => {
  it("the same seed and commands replay to the same world", () => {
    const play = () => {
      const w = arena();
      w.seed = 42;
      reveal(w, "blue");
      for (let i = 0; i < 6; i++) dummy(w, i % 2 ? "stinger" : "mastodon", "red", 18 + i * 0.7, 20 + (i % 3) * 0.6);
      run(w, 1, [call("blue", "barrage", 19.5, 20.5)]);
      run(w, 12, [call("blue", "emp", 19, 20)]);
      run(w, 40);
      return [...w.units.values()].map((u) => [u.id, u.hp.toFixed(6), u.x.toFixed(6)]).join(";");
    };
    expect(play()).toBe(play());
  });
});

describe("AI and calldowns", () => {
  it("scatters from an enemy reticle after its reaction delay (slower on Easy)", () => {
    const delays: Record<string, number> = {};
    for (const diff of ["easy", "normal", "hard"] as const) {
      const w = arena();
      reveal(w, "blue");
      const s = createAiState("balanced", diff);
      const squad = [0, 1, 2].map((i) => spawnUnit(w, "stinger", "red", 20 + i * 0.6, 20));
      run(w, 1, [call("blue", "barrage", 20.5, 20)]);
      let t = 0;
      let cmds: Command[] = [];
      while (cmds.length === 0 && t < 30) {
        cmds = dodgeCalldowns(w, "red", s);
        if (cmds.length === 0) run(w, 1);
        t++;
      }
      delays[diff] = t;
      const moved = new Set(cmds.flatMap((c) => (c.type === "move" ? c.unitIds : [])));
      for (const u of squad) expect(moved.has(u.id)).toBe(true);
      // every escape point is ~4 tiles further out from the reticle
      for (const c of cmds) {
        if (c.type !== "move") continue;
        const u = w.units.get(c.unitIds[0]!)!;
        expect(Math.hypot(c.x - 20.5, c.y - 20)).toBeGreaterThan(Math.hypot(u.x - 20.5, u.y - 20) + 3);
      }
      // and it reacts once, not every tick
      run(w, 1);
      expect(dodgeCalldowns(w, "red", s)).toHaveLength(0);
    }
    expect(delays.easy).toBeGreaterThan(delays.normal!);
    expect(delays.normal).toBeGreaterThan(delays.hard!);
  });

  it("the dodge actually saves units in a live AI tick loop", () => {
    const w = arena();
    reveal(w, "blue");
    const s = createAiState("balanced", "hard");
    const squad = [0, 1, 2].map((i) => spawnUnit(w, "stinger", "red", 20 + i * 0.5, 20));
    w.powers.meter.blue = 100;
    for (let i = 0; i < 40; i++) step(w, [...(i === 0 ? [call("blue", "barrage", 20.5, 20)] : []), ...tickAi(w, "red", s)]);
    expect(squad.filter((u) => w.units.has(u.id)).length).toBe(3);
  });

  it("uses calldowns in a full AI-vs-AI match, legally, and Easy never shells", () => {
    const fired: Record<Faction, Record<string, number>> = perSide(() => ({}));
    // (a match long enough for both sides to need them: with seed 1001 the Easy Rush wins by 5:30 without one)
    const seed = 1002;
    const w = createMapWorld("riverlands", {
      seed,
      openers: { blue: pickAiOpener("rush", seed, "blue"), red: pickAiOpener("balanced", seed, "red") }
    });
    const blue = createAiState("rush", "easy", 1);
    const red = createAiState("balanced", "normal", 2);
    let issued = 0;
    for (let i = 0; i < 14 * 60 * TICK_RATE && !w.winner; i++) {
      const cmds = [...tickAi(w, "blue", blue), ...tickAi(w, "red", red)];
      for (const c of cmds)
        if (c.type === "calldown") {
          issued++;
          // the AI only ever asks for calls the rules allow
          expect(calldownBlocker(w, c.faction, c.power, c.x, c.y)).toBeNull();
        }
      step(w, cmds);
      for (const e of w.fx) if (e.type === "calldown") fired[e.faction][e.power] = (fired[e.faction][e.power] ?? 0) + 1;
    }
    const total = (f: Faction) => Object.values(fired[f]).reduce((a, b) => a + b, 0);
    expect(total("red")).toBeGreaterThanOrEqual(2);
    expect(total("blue")).toBeGreaterThanOrEqual(1);
    expect(fired.blue.barrage ?? 0).toBe(0);
    expect(total("blue") + total("red")).toBe(issued);
  }, 60000);
});

describe("calldowns under match rules", () => {
  it("Drop Pod crews swap banned kinds for allowed stand-ins, or disable the pod", async () => {
    const { createMapWorld } = await import("../src/sim/maps");
    const { podCrew, powerBlocker } = await import("../src/sim/powers");
    const air = createMapWorld("frostbite", { mutators: ["airwar"] });
    for (const k of podCrew(air, "blue")) expect(["wasp", "raptor"]).toContain(k);
    expect(podCrew(air, "blue").length).toBe(3);
    const classic = createMapWorld("frostbite");
    expect(podCrew(classic, "blue")).toEqual(["stinger", "stinger", "flak-crawler"]);
    air.powers.meter.blue = 100;
    expect(powerBlocker(air, "blue", "droppod")).toBeNull();
  });
});
