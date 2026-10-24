import { describe, expect, it } from "vitest";
import { COMBAT, TICK_RATE, UNITS } from "../src/sim/balance";
import { findTarget } from "../src/sim/combat";
import { step } from "../src/sim/sim";
import { createWorld, spawnBuilding, spawnUnit } from "../src/sim/world";

const runTicks = (w: ReturnType<typeof createWorld>, n: number) => {
  for (let i = 0; i < n; i++) step(w, []);
};

describe("domain targeting rules", () => {
  it("a stinger engages ground but ignores air", () => {
    const w = createWorld(24, 24);
    const stinger = spawnUnit(w, "stinger", "blue", 5.5, 5.5);
    const wasp = spawnUnit(w, "wasp", "red", 6.5, 5.5);
    void stinger;
    const waspHp = wasp.hp;
    runTicks(w, 10);
    expect(wasp.hp).toBe(waspHp); // stinger can't touch air
  });

  it("a flak crawler shreds air but cannot hit ground", () => {
    const w = createWorld(24, 24);
    spawnUnit(w, "flak-crawler", "blue", 5.5, 5.5);
    const wasp = spawnUnit(w, "wasp", "red", 7.5, 5.5);
    const stinger = spawnUnit(w, "stinger", "red", 6.5, 5.5);
    // wasp will fight back; give the crawler company to make it decisive
    const stingerHp = stinger.hp;
    runTicks(w, 30);
    expect(wasp.hp).toBeLessThan(UNITS.wasp.hp);
    expect(stinger.hp).toBe(stingerHp);
  });

  it("the counter-triangle resolves: flak beats wasp, wasp beats stinger", () => {
    // flak vs wasp
    let w = createWorld(24, 24);
    spawnUnit(w, "flak-crawler", "blue", 5.5, 5.5);
    let wasp = spawnUnit(w, "wasp", "red", 6.5, 5.5);
    step(w, [{ type: "attack", faction: "red", unitIds: [wasp.id], targetId: [...w.units.values()][0]!.id }]);
    runTicks(w, 30 * TICK_RATE);
    expect(w.units.has(wasp.id)).toBe(false); // wasp died (can't even shoot back... it can, flak is ground)
    // wasp vs stinger: wasp wins because stinger can't return fire
    w = createWorld(24, 24);
    const stinger = spawnUnit(w, "stinger", "blue", 5.5, 5.5);
    wasp = spawnUnit(w, "wasp", "red", 6.5, 5.5);
    step(w, [{ type: "attack", faction: "red", unitIds: [wasp.id], targetId: stinger.id }]);
    runTicks(w, 30 * TICK_RATE);
    expect(w.units.has(stinger.id)).toBe(false);
    expect(w.units.has(wasp.id)).toBe(true);
  });
});

describe("orders and auto-engagement", () => {
  it("an explicit attack order chases the target across the map", () => {
    const w = createWorld(32, 32);
    const stinger = spawnUnit(w, "stinger", "blue", 2.5, 2.5);
    const victim = spawnUnit(w, "harvester", "red", 20.5, 2.5);
    step(w, [{ type: "attack", faction: "blue", unitIds: [stinger.id], targetId: victim.id }]);
    runTicks(w, 20 * TICK_RATE);
    expect(w.units.has(victim.id)).toBe(false);
  });

  it("attack-move pauses to engage targets encountered on the way", () => {
    const w = createWorld(32, 32);
    const stinger = spawnUnit(w, "stinger", "blue", 2.5, 5.5);
    const bystander = spawnUnit(w, "harvester", "red", 10.5, 5.5);
    step(w, [{ type: "attackMove", faction: "blue", unitIds: [stinger.id], x: 25.5, y: 5.5 }]);
    runTicks(w, 20 * TICK_RATE);
    expect(w.units.has(bystander.id)).toBe(false); // killed in passing
    runTicks(w, 15 * TICK_RATE);
    expect(Math.hypot(stinger.x - 25.5, stinger.y - 5.5)).toBeLessThan(1); // then carried on
  });

  it("a plain move order does NOT stop to fight", () => {
    const w = createWorld(32, 32);
    const stinger = spawnUnit(w, "stinger", "blue", 2.5, 5.5);
    spawnUnit(w, "harvester", "red", 10.5, 8.5);
    step(w, [{ type: "move", faction: "blue", unitIds: [stinger.id], x: 25.5, y: 5.5 }]);
    runTicks(w, 16 * TICK_RATE);
    expect(Math.hypot(stinger.x - 25.5, stinger.y - 5.5)).toBeLessThan(1);
  });

  it("idle units defend themselves within acquire range without wandering", () => {
    const w = createWorld(24, 24);
    const guard = spawnUnit(w, "stinger", "blue", 5.5, 5.5);
    const intruder = spawnUnit(w, "harvester", "red", 8.5, 5.5);
    runTicks(w, 15 * TICK_RATE);
    expect(w.units.has(intruder.id)).toBe(false);
    expect(Math.hypot(guard.x - 5.5, guard.y - 5.5)).toBeLessThan(1.5); // held position
  });
});

describe("turrets", () => {
  it("hits both domains and emits shot fx", () => {
    const w = createWorld(24, 24);
    spawnBuilding(w, "turret", "blue", 5, 5);
    const wasp = spawnUnit(w, "wasp", "red", 7.5, 5.5);
    const stinger = spawnUnit(w, "stinger", "red", 4.5, 7.5);
    let sawShot = false;
    for (let i = 0; i < 20 * TICK_RATE; i++) {
      step(w, []);
      if (w.fx.some((f) => f.type === "shot")) sawShot = true;
    }
    expect(sawShot).toBe(true);
    expect(w.units.has(wasp.id) && w.units.has(stinger.id)).toBe(false);
  });
});

describe("attacking buildings", () => {
  it("units can raze a building and the HQ kill ends the match", () => {
    const w = createWorld(24, 24);
    spawnBuilding(w, "hq", "blue", 2, 2);
    const redHq = spawnBuilding(w, "hq", "red", 18, 18);
    const army = Array.from({ length: 4 }, (_, i) =>
      spawnUnit(w, "stinger", "blue", 14.5 + i, 16.5)
    );
    step(w, [
      { type: "attack", faction: "blue", unitIds: army.map((u) => u.id), targetId: redHq.id }
    ]);
    runTicks(w, 120 * TICK_RATE);
    expect(w.buildings.has(redHq.id)).toBe(false);
    expect(w.winner).toBe("blue");
  });

  it("a dead unit stops being targetable and leaves explosion fx", () => {
    const w = createWorld(24, 24);
    spawnUnit(w, "stinger", "blue", 5.5, 5.5);
    const victim = spawnUnit(w, "harvester", "red", 6.5, 5.5);
    let sawExplosion = false;
    for (let i = 0; i < 20 * TICK_RATE && !sawExplosion; i++) {
      step(w, []);
      if (w.fx.some((f) => f.type === "explosion")) sawExplosion = true;
    }
    expect(sawExplosion).toBe(true);
    expect(w.units.has(victim.id)).toBe(false);
  });
});

describe("Menders are shot first", () => {
  it("auto-targeting picks an enemy Mender over a nearer armed unit", () => {
    const w = createWorld(24, 24);
    const flak = spawnUnit(w, "flak-crawler", "blue", 5.5, 5.5);
    const wasp = spawnUnit(w, "wasp", "red", 7.5, 5.5);
    // a little farther off than the wasp, but within the healer bonus
    const mender = spawnUnit(w, "mender", "red", 5.5, 5.5 + 2 + COMBAT.healerPriority - 0.5);
    expect(findTarget(w, "blue", "air", flak.x, flak.y, 10)?.id).toBe(mender.id);
    mender.y = 5.5 + 2 + COMBAT.healerPriority + 0.5; // beyond it: the nearest threat comes first
    expect(findTarget(w, "blue", "air", flak.x, flak.y, 10)?.id).toBe(wasp.id);
  });

  it("drops the target it was shooting for a Mender that comes into range", () => {
    const w = createWorld(24, 24);
    const flak = spawnUnit(w, "flak-crawler", "blue", 5.5, 5.5);
    const wasp = spawnUnit(w, "wasp", "red", 6.5, 5.5);
    w.powers.stunned.set(wasp.id, 1e9); // (sits still)
    runTicks(w, 2);
    expect(flak.autoTargetId).toBe(wasp.id);
    // a Mender flies in to patch the wasp up, from the far side of it
    const mender = spawnUnit(w, "mender", "red", 5.5 + UNITS["flak-crawler"].range - 0.2, 5.5);
    w.powers.stunned.set(mender.id, 1e9);
    runTicks(w, 2);
    expect(flak.autoTargetId).toBe(mender.id);
    // and back to the wasp once the Mender is down
    w.units.delete(mender.id);
    runTicks(w, 2);
    expect(flak.autoTargetId).toBe(wasp.id);
  });

  it("an explicit attack order isn't overridden", () => {
    const w = createWorld(24, 24);
    const flak = spawnUnit(w, "flak-crawler", "blue", 5.5, 5.5);
    const wasp = spawnUnit(w, "wasp", "red", 6.5, 5.5);
    spawnUnit(w, "mender", "red", 5.5, 6.5);
    step(w, [{ type: "attack", faction: "blue", unitIds: [flak.id], targetId: wasp.id }]);
    runTicks(w, 3);
    expect(flak.order).toMatchObject({ type: "attack", targetId: wasp.id });
  });
});

describe("Menders", () => {
  it("never mend what is already destroyed this tick: a building at 0 hp falls, Mender or not", () => {
    const w = createWorld(24, 24);
    const depot = spawnBuilding(w, "depot", "blue", 10, 10);
    spawnBuilding(w, "hq", "blue", 1, 1);
    spawnBuilding(w, "hq", "red", 20, 20);
    spawnUnit(w, "mender", "blue", 12.5, 9.2);
    depot.hp = 300; // a hurt one it does mend…
    step(w, []);
    expect(depot.hp).toBeGreaterThan(300);
    depot.hp = 0; // …but not one destroyed (as if shot down earlier in the tick): it would have stood at 1 hp
    step(w, []);
    expect(w.buildings.has(depot.id)).toBe(false);
  });
});
