import { BUILDINGS, ECONOMY, GOLIATH, TERRAIN, TICK_RATE, UNITS } from "./balance";
import { anchoredGoliaths, goliathTrainer, goliathsOf, hasGoliath, inGoliathRing, isAnchored, overlapsGoliath, trainableAt, unitCost } from "./goliath";
import { moveUnitToward } from "./movement";
import { blocksObjective } from "./objectives";
import { isStunned } from "./powers";
import {
  Terrain,
  type Building,
  type BuildingKind,
  type Command,
  type Faction,
  type QueueItem,
  type Unit,
  type UnitKind,
  type World
} from "./types";
import {
  buildingCenter,
  buildingAtTile,
  distToBuilding,
  domainOf,
  hasBuilding,
  inBounds,
  isResource,
  moveClassOf,
  nearestDropSite,
  passable,
  removeBuilding,
  sideFrame,
  spawnBuilding,
  spawnUnit,
  terrainAt,
  tileIndex,
  invalidatePathsThrough,
  onHomeLand,
  type DropSite
} from "./world";
import { applySpawnRank, bannedBy, incomeOf, rulesOf } from "./rules";
import { atan2, hypot } from "./fmath";
import { QUARTER, turnTile, turnVec } from "./sides";

// ---------------------------------------------------------- tech rules ----

/** Why this building can't be started right now (null = it can). */
export function buildingBlocker(w: World, faction: Faction, kind: BuildingKind): string | null {
  const stats = BUILDINGS[kind];
  if (kind === "hq") return "Unique";
  const banned = bannedBy(w, kind, faction);
  if (banned) return banned;
  // a Gantry builds nothing but Goliaths: banned with them
  if (kind === "gantry") {
    const noGoliaths = bannedBy(w, "goliath", faction);
    if (noGoliaths) return noGoliaths;
  }
  if (stats.unique && (hasBuilding(w, faction, kind) || w.factions[faction].pending?.kind === kind)) return "One per side";
  if (stats.requires && !stats.requires.some((k) => hasBuilding(w, faction, k)))
    return `Needs ${stats.requires.map((k) => BUILDINGS[k].name).join(" or ")}`;
  const missing = (stats.requiresAll ?? []).filter((k) => !hasBuilding(w, faction, k));
  if (missing.length > 0) return `Needs ${andList(missing.map((k) => BUILDINGS[k].name))}`;
  return null;
}

/** "A", "A and B", "A, B and C". */
const andList = (xs: string[]): string => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** Why this unit can't be queued right now (null = it can). An anchored Goliath stands in for an Assembly Bay. */
export function unitBlocker(w: World, faction: Faction, kind: UnitKind): string | null {
  const stats = UNITS[kind];
  const banned = bannedBy(w, kind, faction);
  if (banned) return banned;
  if (!hasBuilding(w, faction, stats.builtAt) && !(trainableAt(w, kind) && anchoredGoliaths(w, faction).length > 0))
    // (with a Goliath on the move and no HQ, which can never be built: say how to get the button back)
    return trainableAt(w, kind) && hasGoliath(w, faction) && stats.builtAt === "hq"
      ? "Anchor a Goliath"
      : `Needs ${BUILDINGS[stats.builtAt].name}`;
  if (stats.requires && !hasBuilding(w, faction, stats.requires))
    return `Needs ${BUILDINGS[stats.requires].name}`;
  return null;
}

// ------------------------------------------------------------- commands ----

export function startBuilding(w: World, faction: Faction, kind: BuildingKind): void {
  const f = w.factions[faction];
  const stats = BUILDINGS[kind];
  if (f.pending || buildingBlocker(w, faction, kind)) return;
  if (f.scrap < stats.cost) return;
  f.scrap -= stats.cost;
  f.pending = { kind, remaining: stats.buildTime * TICK_RATE, ready: false };
}

export function cancelBuilding(w: World, faction: Faction): void {
  const f = w.factions[faction];
  if (!f.pending) return;
  f.scrap += BUILDINGS[f.pending.kind].cost;
  f.pending = null;
}

export function canPlaceBuilding(
  w: World,
  faction: Faction,
  kind: BuildingKind,
  tx: number,
  ty: number
): boolean {
  const size = BUILDINGS[kind].size;
  // in an anchored Goliath's build ring (an outpost, anything but an HQ): even out on an island
  const ring = kind !== "hq" && inGoliathRing(w, faction, tx, ty, size);
  for (let dy = 0; dy < size; dy++)
    for (let dx = 0; dx < size; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (!inBounds(w, x, y)) return false;
      if (!TERRAIN[terrainAt(w, x, y)].buildable) return false;
      if (buildingAtTile(w, x, y)) return false;
      if (!ring && !onHomeLand(w, faction, x, y)) return false; // never out on an island (or across the sea)
    }
  // no ground unit parked inside the footprint, and no Goliath's body over it
  for (const u of w.units.values())
    if (
      domainOf(u) === "ground" &&
      u.x >= tx && u.x < tx + size &&
      u.y >= ty && u.y < ty + size
    )
      return false;
  if (overlapsGoliath(w, tx, ty, size)) return false;
  if (blocksObjective(w, tx, ty, size)) return false; // Uplink platforms and crates stay open ground
  // within build radius of a friendly building (outposts don't count), or in a Goliath's ring
  return ring || inBaseRange(w, faction, tx + size / 2, ty + size / 2);
}

/**
 * Is a footprint centred at (cx, cy) within build radius of `faction`'s base:
 * any of its buildings except outposts (which never count as base)?
 */
export function inBaseRange(w: World, faction: Faction, cx: number, cy: number): boolean {
  for (const b of w.buildings.values())
    if (b.faction === faction && !b.outpost && distToBuilding(b, cx, cy) <= ECONOMY.buildRadius) return true;
  return false;
}

export function placeBuilding(w: World, faction: Faction, tx: number, ty: number): void {
  const f = w.factions[faction];
  if (!f.pending || !f.pending.ready) return;
  if (!canPlaceBuilding(w, faction, f.pending.kind, tx, ty)) return;
  const size = BUILDINGS[f.pending.kind].size;
  // out of base range, so in a Goliath's build ring: an outpost (decided now, for good)
  const outpost = !inBaseRange(w, faction, tx + size / 2, ty + size / 2);
  const b = spawnBuilding(w, f.pending.kind, faction, tx, ty);
  if (outpost) b.outpost = true;
  f.pending = null;
  w.fx.push({ type: "built", faction, id: b.id });
  // paths that ran across the new footprint must re-plan
  invalidatePathsThrough(w, b);
}

export function sellBuilding(w: World, faction: Faction, buildingId: number): void {
  const b = w.buildings.get(buildingId);
  if (!b || b.faction !== faction || b.kind === "hq") return;
  const stats = BUILDINGS[b.kind];
  // refund scales with remaining health, plus anything still in its queue
  const refund = stats.cost * ECONOMY.sellRefund * (b.hp / stats.hp);
  const queued = b.queue.reduce((s, q) => s + paidFor(q), 0);
  w.factions[faction].scrap += Math.floor(refund + queued);
  w.fx.push({ type: "sold", id: b.id });
  removeBuilding(w, b);
}

/** What a queued unit cost (and a cancel refunds): its price when queued. */
export const paidFor = (q: QueueItem): number => q.paid ?? UNITS[q.kind].cost;

/** Most units a producer queues at once (a Gantry: one Goliath on the cradle). */
const queueCap = (kind: UnitKind): number => (kind === "goliath" ? GOLIATH.queueMax : ECONOMY.maxQueue);

/**
 * Why an anchored Goliath can't train `kind` now (null = it can): robot
 * infantry (and under Nomads, Harvesters) only, while anchored, under the
 * usual tech and bans — but no Assembly Bay needed (the Goliath is the barracks).
 */
export function trainBlocker(w: World, g: Unit, kind: UnitKind): string | null {
  if (!g.goliath || !trainableAt(w, kind)) return "Can't train that";
  const banned = bannedBy(w, kind, g.faction);
  if (banned) return banned;
  const req = UNITS[kind].requires;
  if (req && !hasBuilding(w, g.faction, req)) return `Needs ${BUILDINGS[req].name}`;
  if (!isAnchored(g)) return "Anchor to train";
  return null;
}

export function produceUnit(w: World, faction: Faction, buildingId: number, kind: UnitKind): void {
  const f = w.factions[faction];
  const stats = UNITS[kind];
  if (!stats) return;
  const b = w.buildings.get(buildingId);
  if (!b) {
    // an anchored Goliath trains infantry
    const g = goliathTrainer(w, buildingId, faction);
    if (!g || trainBlocker(w, g, kind)) return;
    const q = g.goliath!.queue;
    if (q.length >= ECONOMY.maxQueue || f.scrap < stats.cost) return;
    f.scrap -= stats.cost;
    q.push({ kind, remaining: stats.buildTime * TICK_RATE });
    return;
  }
  if (b.faction !== faction || stats.builtAt !== b.kind) return;
  if (unitBlocker(w, faction, kind)) return;
  if (b.queue.length >= queueCap(kind)) return;
  const cost = unitCost(w, faction, kind);
  if (f.scrap < cost) return;
  f.scrap -= cost;
  b.queue.push({ kind, remaining: stats.buildTime * TICK_RATE, ...(cost !== stats.cost ? { paid: cost } : {}) });
}

/** Somewhere `kind` can be queued: a building, or an anchored Goliath (infantry). */
export interface Producer {
  id: number;
  queue: QueueItem[];
  /** The Goliath, when it is one (else null: a building). */
  goliath: Unit | null;
}

/**
 * Every producer of `kind` for `faction`, buildings first (in id order), then
 * anchored Goliaths for robot infantry. The HUD's queue counts, the shortest-
 * queue pick and "cancel one" all go through this.
 */
export function producersOf(w: World, faction: Faction, kind: UnitKind): Producer[] {
  const out: Producer[] = [];
  for (const b of w.buildings.values())
    if (b.faction === faction && b.kind === UNITS[kind].builtAt) out.push({ id: b.id, queue: b.queue, goliath: null });
  if (trainableAt(w, kind)) for (const g of anchoredGoliaths(w, faction)) out.push({ id: g.id, queue: g.goliath!.queue, goliath: g });
  return out;
}

/**
 * Every queue holding `kind` for `faction`: producersOf's, plus a Goliath's
 * that packed up with squads still queued (paused till it digs in again, and
 * paid for, so the HUD still counts them and can cancel one).
 */
export function queuesOf(w: World, faction: Faction, kind: UnitKind): Producer[] {
  const out = producersOf(w, faction, kind);
  if (trainableAt(w, kind))
    for (const g of goliathsOf(w, faction))
      if (!isAnchored(g) && g.goliath!.queue.some((q) => q.kind === kind)) out.push({ id: g.id, queue: g.goliath!.queue, goliath: g });
  return out;
}

/** Most units producer `p` queues of `kind` (a Gantry: GOLIATH.queueMax). */
export const producerCap = (kind: UnitKind): number => queueCap(kind);

/** A producer's queue: a building's, or an (own) Goliath's training queue. */
function queueOf(w: World, faction: Faction, id: number): QueueItem[] | null {
  const b = w.buildings.get(id);
  if (b) return b.faction === faction ? b.queue : null;
  return goliathTrainer(w, id, faction)?.goliath!.queue ?? null;
}

/** Cancel the most recently queued unit of this kind (refunded what it cost). */
export function cancelProduce(w: World, faction: Faction, buildingId: number, kind: UnitKind): void {
  const queue = queueOf(w, faction, buildingId);
  if (!queue) return;
  for (let i = queue.length - 1; i >= 0; i--)
    if (queue[i]!.kind === kind) {
      const [q] = queue.splice(i, 1);
      w.factions[faction].scrap += paidFor(q!);
      return;
    }
}

export function setRally(w: World, faction: Faction, buildingId: number, x: number, y: number): void {
  const b = w.buildings.get(buildingId);
  if (b) {
    if (b.faction === faction) b.rally = { x, y };
    return;
  }
  const g = goliathTrainer(w, buildingId, faction);
  if (g) g.goliath!.rally = { x, y };
}

// ---------------------------------------------------------------- ticks ----

export function tickConstruction(w: World): void {
  for (const f of Object.values(w.factions)) {
    if (!f.pending || f.pending.ready) continue;
    if ((f.pending.remaining -= rulesOf(w).buildSpeed) <= 0) f.pending.ready = true;
  }
}

export function tickProduction(w: World): void {
  for (const b of w.buildings.values()) {
    const head = b.queue[0];
    if (!head) continue;
    if (isStunned(w, b.id)) continue; // EMP'd: production paused
    // a unit whose tech building was lost pauses (stays queued)
    if (UNITS[head.kind].requires && !hasBuilding(w, b.faction, UNITS[head.kind].requires!)) continue;
    const total = UNITS[head.kind].buildTime * TICK_RATE;
    const before = head.remaining;
    head.remaining -= rulesOf(w).buildSpeed;
    if (head.kind === "goliath") goliathBuildNews(w, b, total, before, head.remaining);
    if (head.remaining > 0) continue;
    b.queue.shift();
    const size = BUILDINGS[b.kind].size;
    // (an outpost rolls out round itself, even out on an island)
    const spot = findSpawnSpot(w, { tx: b.tx, ty: b.ty, size, faction: b.faction }, head.kind, !b.outpost);
    const u = spawnUnit(w, head.kind, b.faction, spot.x, spot.y);
    applySpawnRank(w, u);
    const c = buildingCenter(b);
    u.facing = u.aim = atan2(spot.x - c.x, -(spot.y - c.y));
    w.factions[b.faction].stats.unitsBuilt++;
    w.fx.push({ type: "built", faction: b.faction, id: u.id });
    if (u.goliath) w.fx.push({ type: "goliathRollout", faction: b.faction, id: u.id, buildingId: b.id, x: u.x, y: u.y });
    applyRally(w, u, b.rally);
  }
  // anchored Goliaths train infantry (paused while it walks, packs up or is EMP'd)
  for (const g of w.units.values()) {
    const head = g.goliath?.queue[0];
    if (!head || !isAnchored(g) || isStunned(w, g.id)) continue;
    if (UNITS[head.kind].requires && !hasBuilding(w, g.faction, UNITS[head.kind].requires!)) continue;
    if ((head.remaining -= rulesOf(w).buildSpeed) > 0) continue;
    g.goliath!.queue.shift();
    const size = GOLIATH.footprint;
    // around its feet, even out on an island (no special island rules for a Goliath)
    const spot = findSpawnSpot(w, { tx: g.x - size / 2, ty: g.y - size / 2, size, faction: g.faction }, head.kind, false);
    const u = spawnUnit(w, head.kind, g.faction, spot.x, spot.y);
    applySpawnRank(w, u);
    u.facing = u.aim = atan2(spot.x - g.x, -(spot.y - g.y));
    w.factions[g.faction].stats.unitsBuilt++;
    w.fx.push({ type: "built", faction: g.faction, id: u.id });
    applyRally(w, u, g.goliath!.rally);
  }
}

/** A Gantry's Goliath build ticked from `before` to `after` (of `total`) remaining: public news when it starts and nears the end. */
function goliathBuildNews(w: World, b: Building, total: number, before: number, after: number): void {
  const c = buildingCenter(b);
  const ev = (stage: "started" | "nearlyDone") =>
    w.fx.push({ type: "goliathBuild", faction: b.faction, buildingId: b.id, stage, x: c.x, y: c.y });
  if (before >= total) ev("started");
  const line = total * (1 - GOLIATH.nearlyDone);
  if (before > line && after <= line && after > 0) ev("nearlyDone");
}

/** A producer's footprint (a building's, or the ground an anchored Goliath stands on). */
interface Footprint {
  tx: number;
  ty: number;
  size: number;
  faction: Faction;
}

/**
 * Where a unit made at footprint `b` rolls out: the nearest free tile around
 * it, the back of the base first. `homeOnly`: on an island map, only land
 * joined to the side's HQ (a building's spawn); a Goliath trains anywhere.
 */
function findSpawnSpot(w: World, b: Footprint, kind: UnitKind, homeOnly = true): { x: number; y: number } {
  const size = b.size;
  const mc = moveClassOf(kind);
  // Prefer the back of the base (blue: the south side, where the bay doors
  // face on the art), then ring out. Searched in the side's own frame — red
  // plays the map rotated 180°, so its "south" is north and its scan order
  // runs backwards — or red's units would roll out toward the enemy and
  // blue's away from it (part of the old Ashlands red-side bias).
  const flip = b.faction === "red";
  // (a Goliath is too big to step out right at the cradle's edge)
  for (let r = UNITS[kind].radius > 0.6 ? 2 : 1; r <= 4; r++) {
    const ring: { x: number; y: number; pref: number }[] = [];
    for (let i = -r; i <= size + r - 1; i++)
      for (let j = -r; j <= size + r - 1; j++) {
        const dy = flip ? size - 1 - i : i;
        const dx = flip ? size - 1 - j : j;
        if (Math.max(dx < 0 ? -dx : dx - size + 1, dy < 0 ? -dy : dy - size + 1) !== r) continue;
        const tx = Math.floor(b.tx) + dx;
        const ty = Math.floor(b.ty) + dy;
        if (!inBounds(w, tx, ty)) continue;
        if (mc !== "air" && (!passable(w, tx, ty, mc) || (homeOnly && !onHomeLand(w, b.faction, tx, ty)))) continue;
        const back = flip ? dy - (size - 1) : -dy; // own-frame "south" first
        ring.push({ x: tx + 0.5, y: ty + 0.5, pref: back + Math.abs(dx - (size - 1) / 2) * 0.5 });
      }
    ring.sort((p, q) => p.pref - q.pref);
    if (ring[0]) return { x: ring[0].x, y: ring[0].y };
  }
  // (boxed in: by the bay doors, but never off the map)
  return { x: b.tx + size / 2, y: Math.min(w.height - 0.5, Math.max(0.5, flip ? b.ty + size + 1 : b.ty - 1)) };
}

function applyRally(w: World, u: Unit, rally: { x: number; y: number } | null): void {
  if (!rally) {
    // fresh harvesters go straight to work on the nearest field
    if (u.kind === "harvester") {
      const f = nearestReachableResource(w, u.x, u.y, u.faction);
      if (f) u.order = { type: "harvest", fieldX: f.x, fieldY: f.y, phase: "toField" };
    }
    return;
  }
  const { x, y } = rally;
  if (u.kind === "harvester" && isResource(w, tileIndex(w, Math.floor(x), Math.floor(y)))) {
    u.order = { type: "harvest", fieldX: Math.floor(x), fieldY: Math.floor(y), phase: "toField" };
  } else {
    u.order = { type: "attackMove", x, y };
  }
}

// -------------------------------------------------------------- harvest ----

/**
 * Find the closest scrap/crystal tile with anything remaining, or null.
 * Ties go by scan order, run in `faction`'s own frame (see sideFrame).
 */
export function nearestScrapTile(w: World, x: number, y: number, faction?: Faction): { x: number; y: number } | null {
  const fr = sideFrame(w, faction);
  const p = fr.toFrame({ x, y });
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let fy = 0; fy < w.height; fy++)
    for (let fx = 0; fx < w.width; fx++) {
      const [tx, ty] = fr.tile(fx, fy, 1);
      if (!isResource(w, tileIndex(w, tx, ty))) continue;
      const d = hypot(fx + 0.5 - p.x, fy + 0.5 - p.y);
      if (d < bestD) {
        bestD = d;
        best = { x: tx, y: ty };
      }
    }
  return best;
}

/**
 * Nearest resource tile a ground unit at (x, y) can actually drive to,
 * by breadth-first search over passable tiles (8-way, no corner cutting).
 * Straight-line distance is fooled by rivers and rock-locked tiles.
 * `accept` (optional) skips fields it turns down (the AI keeps to its own
 * side of an island map's bridges).
 */
export function nearestReachableResource(
  w: World,
  x: number,
  y: number,
  faction?: Faction,
  accept?: (tx: number, ty: number) => boolean
): { x: number; y: number } | null {
  const W = w.width;
  // neighbour order in the side's own frame: red's BFS is blue's, turned 180° (green's and purple's a quarter turn)
  const q = faction ? QUARTER[faction] : 0;
  const start = tileIndex(w, Math.floor(x), Math.floor(y));
  if (start < 0 || start >= W * w.height) return null;
  const seen = new Uint8Array(W * w.height);
  const queue = new Int32Array(W * w.height);
  let head = 0;
  let tail = 0;
  queue[tail++] = start;
  seen[start] = 1;
  while (head < tail) {
    const cur = queue[head++]!;
    if (isResource(w, cur) && (!accept || accept(cur % W, Math.floor(cur / W)))) return { x: cur % W, y: Math.floor(cur / W) };
    const cx = cur % W;
    const cy = Math.floor(cur / W);
    for (let i = -1; i <= 1; i++)
      for (let j = -1; j <= 1; j++) {
        const [dx, dy] = turnVec(q, j, i);
        if (dx === 0 && dy === 0) continue;
        const nx = cx + dx;
        const ny = cy + dy;
        if (!passable(w, nx, ny, "ground")) continue;
        if (dx !== 0 && dy !== 0 && (!passable(w, cx + dx, cy, "ground") || !passable(w, cx, cy + dy, "ground")))
          continue;
        const ni = ny * W + nx;
        if (seen[ni]) continue;
        seen[ni] = 1;
        queue[tail++] = ni;
      }
  }
  return null;
}

/** Passive income so no side can be left permanently broke: every HQ's, and every anchored Goliath's (half an Uplink's). */
export function tickTrickle(w: World): void {
  if ((w.tick + 1) % TICK_RATE !== 0) return; // once per full second
  for (const b of w.buildings.values())
    if (b.kind === "hq") {
      w.factions[b.faction].scrap += (rulesOf(w).hqTrickle ?? ECONOMY.hqTrickle) * incomeOf(w, b.faction);
    }
  for (const u of w.units.values()) if (isAnchored(u)) w.factions[u.faction].scrap += GOLIATH.trickle * incomeOf(w, u.faction);
}

/** Distance from a point to a drop site's footprint (0 inside). */
function distToSite(s: DropSite, x: number, y: number): number {
  const dx = Math.max(s.tx - x, 0, x - (s.tx + s.size));
  const dy = Math.max(s.ty - y, 0, y - (s.ty + s.size));
  return hypot(dx, dy);
}

/** Ticks a harvester keeps running for home after being shot. */
const FLEE_TICKS = 4 * TICK_RATE;

/** Where a harvester parks to unload at a drop site: just outside the footprint, nearest side. */
function dockPoint(w: World, b: DropSite, x: number, y: number): { x: number; y: number } {
  const q = QUARTER[b.faction];
  if (q === 1 || q === 3) {
    // a quarter-turned side: worked out in its own frame (as blue's), then turned back
    const fr = sideFrame(w, b.faction);
    const [tx, ty] = turnTile(4 - q, w.width, w.height, b.tx, b.ty, b.size);
    const p = fr.toFrame({ x, y });
    return fr.toWorld(dockPoint(w, { ...b, faction: "blue", tx, ty }, p.x, p.y));
  }
  const size = b.size;
  const cx = Math.max(b.tx + 0.5, Math.min(b.tx + size - 0.5, x));
  const cy = Math.max(b.ty + 0.5, Math.min(b.ty + size - 0.5, y));
  // push the clamped point out of the footprint toward the harvester (ties
  // break toward the side's own east/south, so red docks as blue's mirror)
  const c = { x: b.tx + size / 2, y: b.ty + size / 2 };
  const red = b.faction === "red";
  const dx = cx - c.x;
  const dy = cy - c.y;
  const east = dx > 0 || (dx === 0 && !red);
  const south = dy > 0 || (dy === 0 && !red);
  if (Math.abs(dx) >= Math.abs(dy)) return { x: east ? b.tx + size + 0.5 : b.tx - 0.5, y: cy };
  return { x: cx, y: south ? b.ty + size + 0.5 : b.ty - 0.5 };
}

export function tickHarvest(w: World): void {
  for (const u of w.units.values()) {
    if (u.order.type !== "harvest") continue;
    if (isStunned(w, u.id)) continue; // EMP'd: frozen in place
    const o = u.order;
    const perTick = (rate: number) => rate / TICK_RATE;

    // under fire: abandon mining and run for a drop-off until the heat is off
    // (toBase/unloading already head home, so only interrupt field phases)
    if (
      w.tick - u.damagedTick < FLEE_TICKS &&
      (o.phase === "toField" || o.phase === "harvesting")
    ) {
      const home = nearestDropSite(w, u.faction, u.x, u.y, "ground");
      if (home) {
        const d = dockPoint(w, home, u.x, u.y);
        moveUnitToward(w, u, d.x, d.y);
        o.phase = "toField"; // resume mining from scratch once safe
        continue;
      }
    }

    if (o.phase === "toField") {
      // already standing on minable scrap? dig in right here — this also
      // resolves the jam where several harvesters contest one tile centre
      // and separation steering keeps all but one from ever "arriving"
      const curI = tileIndex(w, Math.floor(u.x), Math.floor(u.y));
      if (isResource(w, curI) && hypot(Math.floor(u.x) - o.fieldX, Math.floor(u.y) - o.fieldY) < 4) {
        o.fieldX = Math.floor(u.x);
        o.fieldY = Math.floor(u.y);
        o.phase = "harvesting";
        continue;
      }
      const i = tileIndex(w, o.fieldX, o.fieldY);
      if (!isResource(w, i)) {
        const next = nearestReachableResource(w, u.x, u.y, u.faction);
        if (!next) {
          u.order = { type: "idle" };
          continue;
        }
        o.fieldX = next.x;
        o.fieldY = next.y;
      }
      if (moveUnitToward(w, u, o.fieldX + 0.5, o.fieldY + 0.5)) {
        // unreachable fields make moveUnitToward "arrive" instantly — only
        // start digging if we're really there
        if (hypot(o.fieldX + 0.5 - u.x, o.fieldY + 0.5 - u.y) < 2.2) o.phase = "harvesting";
        else {
          // that field is cut off — settle for the nearest one we can reach
          const next = nearestReachableResource(w, u.x, u.y, u.faction);
          if (next && (next.x !== o.fieldX || next.y !== o.fieldY)) {
            o.fieldX = next.x;
            o.fieldY = next.y;
            u.path = null;
          } else u.order = { type: "idle" };
        }
      }
    } else if (o.phase === "harvesting") {
      const i = tileIndex(w, o.fieldX, o.fieldY);
      const available = w.scrap[i]!;
      if (available <= 0) {
        o.phase = "toField";
        continue;
      }
      const value = w.terrain[i] === Terrain.Crystal ? ECONOMY.crystalValue : 1;
      const room = (ECONOMY.harvesterCapacity - u.cargo) / value;
      const mined = Math.min(perTick(ECONOMY.harvestRate), available, room);
      u.cargo += mined * value;
      w.scrap[i] = Math.max(0, available - mined);
      if (u.cargo >= ECONOMY.harvesterCapacity - 1e-6) {
        u.cargo = ECONOMY.harvesterCapacity;
        o.phase = "toBase";
      }
    } else if (o.phase === "toBase") {
      // (an anchored Goliath counts; once it starts packing up it doesn't, and this reroutes)
      const home = nearestDropSite(w, u.faction, u.x, u.y, "ground");
      if (!home) {
        // a base on the move (a Goliath packing up, walking or on a lift) will dig in again: wait for it, loaded
        if (!hasGoliath(w, u.faction)) u.order = { type: "idle" };
        continue;
      }
      const d = dockPoint(w, home, u.x, u.y);
      if (moveUnitToward(w, u, d.x, d.y) || distToSite(home, u.x, u.y) < 1.2) {
        o.phase = "unloading";
        const c = { x: home.tx + home.size / 2, y: home.ty + home.size / 2 };
        const amount = u.cargo * incomeOf(w, u.faction);
        w.fx.push({ type: "deposit", faction: u.faction, id: u.id, x: c.x, y: c.y, amount });
      }
    } else {
      // unloading
      const transfer = Math.min(perTick(ECONOMY.unloadRate), u.cargo);
      u.cargo -= transfer;
      const f = w.factions[u.faction];
      const mult = incomeOf(w, u.faction);
      f.scrap += transfer * mult;
      f.stats.scrapHarvested += transfer * mult;
      if (u.cargo <= 1e-6) {
        u.cargo = 0;
        o.phase = "toField";
      }
    }
  }
}

export function applyEconomyCommand(w: World, c: Command): void {
  switch (c.type) {
    case "startBuilding":
      startBuilding(w, c.faction, c.building);
      break;
    case "cancelBuilding":
      cancelBuilding(w, c.faction);
      break;
    case "placeBuilding":
      placeBuilding(w, c.faction, c.tx, c.ty);
      break;
    case "sell":
      sellBuilding(w, c.faction, c.buildingId);
      break;
    case "produce":
      produceUnit(w, c.faction, c.buildingId, c.unit);
      break;
    case "cancelProduce":
      cancelProduce(w, c.faction, c.buildingId, c.unit);
      break;
    case "rally":
      setRally(w, c.faction, c.buildingId, c.x, c.y);
      break;
  }
}

export { buildingCenter };
