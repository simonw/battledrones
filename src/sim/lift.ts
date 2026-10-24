import { GOLIATH, TERRAIN, TICK_RATE, UNITS } from "./balance";
import { strikeDamage } from "./combat";
import { isTransport } from "./infantry";
import { isStunned } from "./powers";
import { applySpawnRank } from "./rules";
import { wreckRestingSpot } from "./salvage";
import type { Command, Unit, World } from "./types";
import { buildingCenter, hqOf, inBounds, passable, removeBuilding, sideFrame, spawnUnit, terrainAt } from "./world";
import { sidesOf } from "./sides";
import { atan2, cos, hypot, sin } from "./fmath";

/**
 * The two-Condor lift (GOLIATH.md). Two empty Condors hook onto a walking
 * Goliath (a `lift` command: select them, tap it) and carry it: `move` flies
 * the lift (at GOLIATH.lift.speedMult of a Condor's speed), `unload` sets it
 * down (long-press a destination, or ⇣ where it is), `stop` hovers.
 *
 * The Goliath keeps the lift on its state (GoliathState.lift); each Condor
 * holds a `lift` order naming it, and tickMovement leaves them all alone:
 * tickLift moves them. Off the ground the Goliath is an air target
 * (world.ts domainOf) and only its machine guns fire (goliath.ts
 * weaponReady). Shot down (either Condor lost: dropLifts, from cleanupDeaths)
 * it falls: over land it lands heavily damaged (GOLIATH.lift.dropDamage),
 * over water, sea, lava or rock it is destroyed — like squads in a downed
 * Condor. On the Archipelago, a Goliath set down on an island anchors and
 * trains there like anywhere else.
 */

// ----------------------------------------------------------- helpers ---

/** The Goliath Condor `c` is lifting (hooking on or carrying), or null. */
export function liftedBy(w: World, c: Unit): Unit | null {
  if (c.order.type !== "lift") return null;
  const g = w.units.get(c.order.goliathId);
  return g?.goliath?.lift?.carriers.includes(c.id) ? g : null;
}

/** Is Condor `c` free to hook onto a Goliath (own, empty, not on a lift already)? */
export const canCarry = (c: Unit): boolean =>
  isTransport(c.kind) && (c.passengers?.length ?? 0) === 0 && c.order.type !== "lift" && c.hp > 0;

/**
 * Why `condors` can't lift Goliath `g` (null: they can). Two empty Condors
 * of its side, a walking Goliath not already on a lift.
 */
export function liftBlocker(condors: readonly Unit[], g: Unit): string | null {
  if (!g.goliath) return "Not a Goliath";
  const free = condors.filter((c) => c.faction === g.faction && canCarry(c));
  if (free.length < 2) return "Needs two empty Condors";
  if (g.goliath.lift) return "Already on a lift";
  if (g.goliath.mode !== "walking") return "Pack up first";
  return null;
}

/** Where carrier `i` (0: its left, 1: its right) hangs on a Goliath at (x, y) facing `facing`. */
function hookPoint(x: number, y: number, facing: number, i: number): { x: number; y: number } {
  const s = (i === 0 ? -1 : 1) * GOLIATH.lift.span;
  // the Goliath's right hand: (cos f, sin f) for a facing clockwise from North
  return { x: x + cos(facing) * s, y: y + sin(facing) * s };
}

/** Step `u` straight toward (x, y) at `speed` tiles/tick; true once there. */
function flyToward(u: Unit, x: number, y: number, speed: number): boolean {
  const d = hypot(x - u.x, y - u.y);
  if (d <= speed) {
    u.x = x;
    u.y = y;
    return true;
  }
  u.x += ((x - u.x) / d) * speed;
  u.y += ((y - u.y) / d) * speed;
  return false;
}

/** Turn `u` to face (x, y) (clockwise from North), when it isn't already there. */
function face(u: Unit, x: number, y: number): void {
  if (hypot(x - u.x, y - u.y) > 1e-6) u.facing = atan2(x - u.x, -(y - u.y));
}

/** Let the Condors of a lift go (the lift is over): they hover where they are. */
function release(w: World, g: Unit): void {
  const lift = g.goliath?.lift;
  if (!lift) return;
  for (const id of lift.carriers) {
    const c = w.units.get(id);
    if (c && c.order.type === "lift" && c.order.goliathId === g.id) {
      c.order = { type: "idle" };
      c.path = null;
    }
  }
  g.goliath!.lift = null;
}

/**
 * Where a Goliath set down near (x, y) by `g`'s side touches down: (x, y)
 * itself if a walker can stand there, else the centre of the nearest such
 * tile within GOLIATH.lift.setDownSearch (scanned in the side's own frame,
 * so red's choice mirrors blue's). Null when there is none.
 */
export function setDownPoint(w: World, g: Unit, x: number, y: number): { x: number; y: number } | null {
  const ok = (tx: number, ty: number) => passable(w, tx, ty, "ground");
  // (the tile under the point in the side's frame: on a tile edge, red's is blue's mirror)
  const fr = sideFrame(w, g.faction);
  const p = fr.toFrame({ x, y });
  if (ok(...fr.tile(Math.floor(p.x), Math.floor(p.y), 1))) return { x, y };
  const R = Math.ceil(GOLIATH.lift.setDownSearch);
  let best: { x: number; y: number } | null = null;
  let bestD = Infinity;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const fx = Math.floor(p.x) + dx;
      const fy = Math.floor(p.y) + dy;
      const [tx, ty] = fr.tile(fx, fy, 1);
      if (!ok(tx, ty)) continue;
      const d = hypot(fx + 0.5 - p.x, fy + 0.5 - p.y);
      if (d > GOLIATH.lift.setDownSearch || d >= bestD - 1e-9) continue;
      bestD = d;
      best = fr.toWorld({ x: fx + 0.5, y: fy + 0.5 });
    }
  return best;
}

// ----------------------------------------------------------- commands ---

/** Apply a `lift` command: the two nearest free Condors of those named fly in to hook onto the Goliath. */
export function applyLiftCommand(w: World, c: Extract<Command, { type: "lift" }>): void {
  const g = w.units.get(c.goliathId);
  if (!g || g.faction !== c.faction || !g.goliath) return;
  const condors: Unit[] = [];
  for (const id of c.unitIds) {
    const u = w.units.get(id);
    if (u && u.faction === c.faction && canCarry(u) && !condors.includes(u)) condors.push(u);
  }
  if (liftBlocker(condors, g)) return;
  // the two nearest (ties: the earlier-built)
  condors.sort((a, b) => hypot(a.x - g.x, a.y - g.y) - hypot(b.x - g.x, b.y - g.y) || a.id - b.id);
  const [a, b] = condors as [Unit, Unit];
  // each takes the side it is nearer (fewer crossings)
  const l = hookPoint(g.x, g.y, g.facing, 0);
  const r = hookPoint(g.x, g.y, g.facing, 1);
  const straight = hypot(a.x - l.x, a.y - l.y) + hypot(b.x - r.x, b.y - r.y);
  const crossed = hypot(a.x - r.x, a.y - r.y) + hypot(b.x - l.x, b.y - l.y);
  const carriers: [number, number] = crossed < straight - 1e-9 ? [b.id, a.id] : [a.id, b.id];
  for (const u of [a, b]) {
    u.order = { type: "lift", goliathId: g.id };
    u.path = null;
    u.pathGoal = null;
    u.autoTargetId = null;
  }
  g.order = { type: "idle" };
  g.path = null;
  g.pathGoal = null;
  g.goliath.lift = { carriers, phase: "hooking", dest: null, setDown: false };
}

/** The orders a lift takes: they fly it, set it down or hover it, and call off one still hooking on. */
export type LiftOrder = Extract<Command, { type: "move" | "attackMove" | "unload" | "stop" }>;

const isLiftOrder = (c: Command): c is LiftOrder => c.type === "move" || c.type === "attackMove" || c.type === "unload" || c.type === "stop";

/**
 * One tick's memory of the orders hooking Goliaths ignored (sim.ts step keeps
 * one while it applies the tick's commands, then drops it: nothing of it is
 * in the world, so world hashes and keyframes never see it).
 *
 * A Goliath whose lift is still hooking on ignores an order unless its
 * Condors are named in the same command (that calls the lift off). Sound
 * duels split a long unit list into several commands (SOUND-DUEL.md
 * "Canonicalize and split"), so a select-all can name the Goliath in an
 * earlier piece than its Condors. The Goliath remembers the order for the
 * rest of the tick and takes it when a later command calls its lift off, so
 * pieces applied in one tick do what the one command would have. (Pieces the
 * lockstep seals into different turns are applied a tick or more apart: there
 * the Goliath still waits, lockstep.ts.)
 */
export interface HeldLiftOrders {
  /** Goliath id → the newest order it ignored this tick, its lift still hooking on. */
  ignored: Map<number, LiftOrder>;
  /** Goliaths the command just routed called off that had ignored an order this tick, with that order: the caller applies them. */
  freed: [number, LiftOrder][];
}

/**
 * Commands that reach a lift (sim.ts, before the usual handling): `move` /
 * `attackMove` fly it, `unload` sets it down, `stop` hovers — addressed to
 * either Condor, or to the carried Goliath. Any of them called on a lift
 * still hooking on calls it off. Returns the ids it handled (the caller
 * skips them); `attack` and the rest leave a lift's members alone.
 *
 * With `held` (sim.ts step), a hooking Goliath that ignores such an order
 * remembers it in `held.ignored`, and when a later command calls that lift
 * off, the order moves to `held.freed` for the caller to apply.
 */
export function routeLiftCommand(w: World, c: Command, held?: HeldLiftOrders): Set<number> {
  const handled = new Set<number>();
  if (!("unitIds" in c) || c.type === "lift") return handled;
  for (const id of c.unitIds) {
    const u = w.units.get(id);
    if (!u || u.faction !== c.faction) continue;
    const g = u.goliath?.lift ? u : liftedBy(w, u);
    const lift = g?.goliath?.lift;
    if (!g || !lift) continue;
    handled.add(id);
    if (!isLiftOrder(c)) continue; // (unarmed carriers; a carried Goliath takes no other orders)
    if (lift.phase === "hooking") {
      if (u.goliath) continue; // the Goliath waits for its Condors
      release(w, g); // called off before it left the ground
      handled.delete(id); // (this Condor takes the order as usual)
      handled.delete(g.id); // (and so does the Goliath, if it was named before its Condors)
      const ignored = held?.ignored.get(g.id);
      if (held && ignored) {
        // (and the order it ignored earlier this tick, before this one: the newer order still wins)
        held.ignored.delete(g.id);
        held.freed.push([g.id, ignored]);
      }
      continue;
    }
    // (kept over the map: a lift never flies off its edge)
    const onMap = (x: number, y: number) => ({ x: Math.min(w.width - 0.5, Math.max(0.5, x)), y: Math.min(w.height - 0.5, Math.max(0.5, y)) });
    if (c.type === "stop") {
      lift.dest = null;
      lift.setDown = false;
    } else if (c.type === "unload") {
      const hasPoint = Number.isFinite(c.x) && Number.isFinite(c.y);
      lift.dest = hasPoint ? onMap(c.x!, c.y!) : { x: g.x, y: g.y };
      lift.setDown = true;
    } else if (Number.isFinite(c.x) && Number.isFinite(c.y)) {
      lift.dest = onMap(c.x, c.y);
      lift.setDown = false;
    }
  }
  // a named Goliath still on a hooking lift ignored this order (its Condors weren't named): it remembers it
  if (held && isLiftOrder(c))
    for (const id of handled) if (w.units.get(id)?.goliath?.lift?.phase === "hooking") held.ignored.set(id, c);
  return handled;
}

// --------------------------------------------------------------- tick ---

/**
 * Per tick, after transport and before movement: Condors fly to their hook
 * points and lift the Goliath once both are on; carried, it flies straight
 * for its destination and is set down there, or hovers. An EMP on any of
 * the three holds the whole lift still. Condors whose Goliath is gone are
 * released.
 */
export function tickLift(w: World): void {
  const condorStep = UNITS.condor.speed / TICK_RATE;
  const liftStep = condorStep * GOLIATH.lift.speedMult;
  for (const c of w.units.values())
    if (c.order.type === "lift" && !liftedBy(w, c)) {
      c.order = { type: "idle" };
      c.path = null;
    }
  for (const g of w.units.values()) {
    const lift = g.goliath?.lift;
    if (!lift) continue;
    const cs = lift.carriers.map((id) => w.units.get(id));
    if (cs.some((c) => !c || c.hp <= 0 || c.order.type !== "lift" || c.order.goliathId !== g.id)) {
      if (lift.phase === "hooking") release(w, g); // (one dropped out before take-off: called off)
      continue; // (carrying: dropLifts deals with a lost Condor)
    }
    const carriers = cs as Unit[];
    if (isStunned(w, g.id) || carriers.some((c) => isStunned(w, c.id))) continue;
    if (lift.phase === "hooking") {
      let on = 0;
      carriers.forEach((c, i) => {
        const p = hookPoint(g.x, g.y, g.facing, i);
        if (hypot(p.x - c.x, p.y - c.y) <= GOLIATH.lift.hookRange) on++;
        else {
          face(c, p.x, p.y);
          if (flyToward(c, p.x, p.y, condorStep)) on++;
        }
      });
      if (on < 2) continue;
      lift.phase = "carrying";
      for (const c of carriers) c.facing = g.facing;
      w.fx.push({ type: "goliathLift", faction: g.faction, id: g.id, carrierIds: [...lift.carriers], state: "hooked", x: g.x, y: g.y });
    } else if (lift.dest) {
      const d = lift.dest;
      face(g, d.x, d.y);
      if (flyToward(g, d.x, d.y, liftStep)) {
        if (lift.setDown) {
          const at = setDownPoint(w, g, d.x, d.y);
          if (at && hypot(at.x - g.x, at.y - g.y) > 1e-6) {
            lift.dest = at; // (over water or a building: drift to the nearest ground first)
          } else if (at) {
            setDown(w, g);
            continue;
          } else lift.dest = null; // nowhere to set it down: hover
        } else lift.dest = null;
      }
    }
    // the Condors hang on either side of it
    carriers.forEach((c, i) => {
      const p = hookPoint(g.x, g.y, g.facing, i);
      c.x = Math.max(0.05, Math.min(w.width - 0.05, p.x));
      c.y = Math.max(0.05, Math.min(w.height - 0.05, p.y));
      c.facing = g.facing;
    });
  }
}

/** Put a carried Goliath down where it hovers (on ground it can stand on): it walks again, the Condors go free. */
function setDown(w: World, g: Unit): void {
  const ids = [...g.goliath!.lift!.carriers];
  release(w, g);
  g.order = { type: "idle" };
  g.path = null;
  g.pathGoal = null;
  w.fx.push({ type: "goliathLift", faction: g.faction, id: g.id, carrierIds: ids, state: "setDown", x: g.x, y: g.y });
}

/**
 * Called first thing in cleanupDeaths: a lift whose Condor is down (or gone)
 * ends. Still hooking on, it is simply called off. Carried, the Goliath
 * falls: onto ground a walker could stand on (or within reach of some, past
 * a building) it lands with GOLIATH.lift.dropDamage of its max HP in damage;
 * into water, sea, lava or onto rock it is destroyed. Either way the damage
 * is credited to whoever downed the Condor.
 */
export function dropLifts(w: World): void {
  for (const g of w.units.values()) {
    const lift = g.goliath?.lift;
    if (!lift) continue;
    const cs = lift.carriers.map((id) => w.units.get(id));
    const down = cs.find((c) => !c || c.hp <= 0);
    if (down === undefined && cs.every((c) => c!.order.type === "lift")) continue;
    const ids = [...lift.carriers];
    const phase = lift.phase;
    release(w, g);
    if (phase === "hooking") continue;
    const killer = down?.lastAttackerId ?? g.lastAttackerId ?? 0;
    const killerSide = down?.lastAttackerSide ?? g.lastAttackerSide ?? null;
    // the tile under it in its side's frame (as canBailOut takes it for squads: mirror-fair on a tile edge)
    const fr = sideFrame(w, g.faction);
    const fp = fr.toFrame(g);
    const [tx, ty] = fr.tile(Math.floor(fp.x), Math.floor(fp.y), 1);
    let lands = inBounds(w, tx, ty) && TERRAIN[terrainAt(w, tx, ty)].ground;
    if (lands && w.occupancy[ty * w.width + tx] !== 0) {
      // onto a building (or a dug-in Goliath): it slides off to the nearest open ground, if there is any close
      const spot = wreckRestingSpot(w, g.x, g.y, g.faction);
      if (spot) {
        g.x = spot.x;
        g.y = spot.y;
      } else lands = false;
    }
    const damage = lands ? UNITS.goliath.hp * GOLIATH.lift.dropDamage : g.hp;
    if (g.hp > 0) strikeDamage(w, [{ id: g.id, damage }], killer, killerSide); // (already shot down itself: its own killer keeps the credit)
    if (!lands) g.hp = Math.min(g.hp, 0); // (destroyed whatever its armour)
    g.order = { type: "idle" };
    g.path = null;
    g.pathGoal = null;
    w.fx.push({ type: "goliathLift", faction: g.faction, id: g.id, carrierIds: ids, state: "dropped", x: g.x, y: g.y, destroyed: !lands || g.hp <= 0 });
  }
}

// ------------------------------------------------------------ mutators ---

/** Goliath Armada: where each side's Goliaths start, as steps of GOLIATH.armada.gap from the HQ's centre (in the side's own frame). */
const ARMADA: readonly (readonly [number, number])[] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1]
];

/**
 * Goliath Armada (createMapWorld, skirmish): each side's start is cleared
 * (HQ, Harvester, Trooper Squad) and four Goliaths take its place in the air,
 * on the corners of a square round where the HQ stood, facing the map
 * centre, each already carried by two Condors. Placed in the side's own
 * frame, so every side's armada is blue's, turned. With no HQ, a side is
 * beaten when its last Goliath falls.
 */
export function armadaStart(w: World): void {
  const centre = { x: w.width / 2, y: w.height / 2 };
  const edge = GOLIATH.lift.span + 1; // (a Condor's hook point stays over the map)
  for (const f of sidesOf(w)) {
    const hq = hqOf(w, f);
    if (!hq) continue;
    const fr = sideFrame(w, f);
    const home = fr.toFrame(buildingCenter(hq));
    for (const b of [...w.buildings.values()]) if (b.faction === f) removeBuilding(w, b);
    for (const u of [...w.units.values()]) if (u.faction === f) w.units.delete(u.id);
    for (const [dx, dy] of ARMADA) {
      const at = fr.toWorld({
        x: Math.min(w.width - edge, Math.max(edge, home.x + dx * GOLIATH.armada.gap)),
        y: Math.min(w.height - edge, Math.max(edge, home.y + dy * GOLIATH.armada.gap))
      });
      const g = spawnUnit(w, "goliath", f, at.x, at.y);
      face(g, centre.x, centre.y);
      applySpawnRank(w, g); // (Veterans: rank 1, like every combat unit)
      const carriers = [0, 1].map((i) => {
        const p = hookPoint(g.x, g.y, g.facing, i);
        const c = spawnUnit(w, "condor", f, p.x, p.y);
        c.facing = g.facing;
        c.order = { type: "lift", goliathId: g.id };
        return c.id;
      });
      g.goliath!.lift = { carriers: carriers as [number, number], phase: "carrying", dest: null, setDown: false };
    }
  }
}
