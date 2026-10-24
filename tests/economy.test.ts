import { describe, expect, it } from "vitest";
import { BUILDINGS, ECONOMY, TICK_RATE, UNITS } from "../src/sim/balance";
import { createSkirmishWorld } from "../src/sim/map";
import { step } from "../src/sim/sim";
import { Terrain } from "../src/sim/types";
import { createWorld, hqOf, setTerrain, spawnBuilding, spawnUnit, terrainAt } from "../src/sim/world";

describe("skirmish map", () => {
  it("has an HQ and a starting harvester per faction, and stocked scrap fields", () => {
    const w = createSkirmishWorld();
    expect(hqOf(w, "blue")).not.toBeNull();
    expect(hqOf(w, "red")).not.toBeNull();
    const units = [...w.units.values()];
    expect(units.filter((u) => u.faction === "blue" && u.kind === "harvester")).toHaveLength(1);
    expect(units.filter((u) => u.faction === "red" && u.kind === "harvester")).toHaveLength(1);
    let scrapTiles = 0;
    for (let ty = 0; ty < w.height; ty++)
      for (let tx = 0; tx < w.width; tx++)
        if (terrainAt(w, tx, ty) === Terrain.Scrap) {
          scrapTiles++;
          expect(w.scrap[ty * w.width + tx]).toBe(ECONOMY.scrapPerTile);
        }
    expect(scrapTiles).toBeGreaterThan(10);
    expect(w.factions.blue.scrap).toBe(ECONOMY.startingScrap);
  });
});

describe("building construction (C&C sidebar flow)", () => {
  it("deducts cost, ticks down, becomes ready, and places on valid ground", () => {
    const w = createSkirmishWorld();
    step(w, [{ type: "startBuilding", faction: "blue", building: "fab-plant" }]);
    expect(w.factions.blue.scrap).toBe(ECONOMY.startingScrap - BUILDINGS["fab-plant"].cost);
    expect(w.factions.blue.pending?.kind).toBe("fab-plant");
    expect(w.factions.blue.pending?.ready).toBe(false);

    for (let i = 0; i < BUILDINGS["fab-plant"].buildTime * TICK_RATE; i++) step(w, []);
    expect(w.factions.blue.pending?.ready).toBe(true);

    // Near the blue HQ (HQ at 4,40 size 3), clear of the starting harvester.
    step(w, [{ type: "placeBuilding", faction: "blue", tx: 8, ty: 44 }]);
    expect(w.factions.blue.pending).toBeNull();
    const placed = [...w.buildings.values()].find((b) => b.kind === "fab-plant");
    expect(placed?.faction).toBe("blue");
  });

  it("rejects placement before ready, out of radius, on rock, or overlapping", () => {
    const w = createSkirmishWorld();
    step(w, [{ type: "startBuilding", faction: "blue", building: "turret" }]);
    const before = w.buildings.size;
    // not ready yet
    step(w, [{ type: "placeBuilding", faction: "blue", tx: 8, ty: 44 }]);
    expect(w.buildings.size).toBe(before);

    for (let i = 0; i < BUILDINGS.turret.buildTime * TICK_RATE; i++) step(w, []);
    // far from any friendly building
    step(w, [{ type: "placeBuilding", faction: "blue", tx: 30, ty: 10 }]);
    expect(w.buildings.size).toBe(before);
    // overlapping own HQ footprint
    step(w, [{ type: "placeBuilding", faction: "blue", tx: 5, ty: 41 }]);
    expect(w.buildings.size).toBe(before);
    // blocked by a ground unit standing in the footprint (starting harvester)
    step(w, [{ type: "placeBuilding", faction: "blue", tx: 8, ty: 41 }]);
    expect(w.buildings.size).toBe(before);
    // pending survives failed placements, then places fine
    step(w, [{ type: "placeBuilding", faction: "blue", tx: 8, ty: 44 }]);
    expect(w.buildings.size).toBe(before + 1);
  });

  it("refuses a second concurrent construction and refunds on cancel", () => {
    const w = createSkirmishWorld();
    step(w, [{ type: "startBuilding", faction: "blue", building: "turret" }]);
    const afterFirst = w.factions.blue.scrap;
    step(w, [{ type: "startBuilding", faction: "blue", building: "fab-plant" }]);
    expect(w.factions.blue.scrap).toBe(afterFirst); // rejected, no charge
    step(w, [{ type: "cancelBuilding", faction: "blue" }]);
    expect(w.factions.blue.scrap).toBe(ECONOMY.startingScrap);
    expect(w.factions.blue.pending).toBeNull();
  });

  it("rejects construction it cannot afford", () => {
    const w = createSkirmishWorld();
    w.factions.blue.scrap = 100;
    step(w, [{ type: "startBuilding", faction: "blue", building: "airpad" }]);
    expect(w.factions.blue.pending).toBeNull();
    expect(w.factions.blue.scrap).toBe(100);
  });
});

describe("unit production", () => {
  it("queues at a building, deducts cost, spawns next to it after build time", () => {
    const w = createSkirmishWorld();
    const hq = hqOf(w, "blue")!;
    const unitsBefore = w.units.size;
    step(w, [{ type: "produce", faction: "blue", buildingId: hq.id, unit: "harvester" }]);
    expect(w.factions.blue.scrap).toBe(ECONOMY.startingScrap - UNITS.harvester.cost);
    expect(hq.queue).toHaveLength(1);

    for (let i = 0; i < UNITS.harvester.buildTime * TICK_RATE + 1; i++) step(w, []);
    expect(hq.queue).toHaveLength(0);
    expect(w.units.size).toBe(unitsBefore + 1);
    const spawned = [...w.units.values()].at(-1)!;
    expect(spawned.kind).toBe("harvester");
    // spawned adjacent to the HQ footprint
    expect(Math.abs(spawned.x - 5.5)).toBeLessThan(6);
    expect(Math.abs(spawned.y - 41.5)).toBeLessThan(6);
  });

  it("rejects producing a unit at the wrong building type", () => {
    const w = createSkirmishWorld();
    const hq = hqOf(w, "blue")!;
    step(w, [{ type: "produce", faction: "blue", buildingId: hq.id, unit: "wasp" }]);
    expect(hq.queue).toHaveLength(0);
    expect(w.factions.blue.scrap).toBe(ECONOMY.startingScrap);
  });

  it("builds the queue strictly in order", () => {
    const w = createSkirmishWorld();
    w.factions.blue.scrap = 1000;
    const hq = hqOf(w, "blue")!;
    step(w, [
      { type: "produce", faction: "blue", buildingId: hq.id, unit: "harvester" },
      { type: "produce", faction: "blue", buildingId: hq.id, unit: "harvester" }
    ]);
    expect(hq.queue).toHaveLength(2);
    for (let i = 0; i < UNITS.harvester.buildTime * TICK_RATE + 1; i++) step(w, []);
    expect(hq.queue).toHaveLength(1); // only the head ticks down
  });
});

describe("win condition", () => {
  it("declares the winner when an HQ dies", () => {
    const w = createWorld(16, 16);
    spawnBuilding(w, "hq", "blue", 2, 2);
    const redHq = spawnBuilding(w, "hq", "red", 10, 10);
    redHq.hp = 1;
    step(w, []);
    expect(w.winner).toBeNull(); // nothing damaged it
    redHq.hp = 0;
    step(w, []);
    expect(w.winner).toBe("blue");
  });
});

describe("harvesting", () => {
  it("hauls all of a tile: a scrap tile's 1500 reach the bank, and the tile is empty", () => {
    const w = createWorld(24, 12);
    spawnBuilding(w, "hq", "blue", 2, 4);
    setTerrain(w, 9, 5, Terrain.Scrap);
    const h = spawnUnit(w, "harvester", "blue", 8.5, 5.5);
    h.order = { type: "harvest", fieldX: 9, fieldY: 5, phase: "toField" };
    const i = 5 * w.width + 9;
    // (2.1 a tick: kept as a whole number, a tile gave up 3 for every 2.1 hauled, 70% of it)
    for (let t = 0; t < 6000 && (w.scrap[i]! > 0 || h.cargo > 0); t++) step(w, []);
    expect(w.scrap[i]).toBe(0);
    expect(w.factions.blue.stats.scrapHarvested).toBeCloseTo(ECONOMY.scrapPerTile, 6);
  });
});
