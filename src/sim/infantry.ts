import { INFANTRY, TICK_RATE, UNITS } from "./balance";
import { strikeDamage } from "./combat";
import { isVisible } from "./fog";
import { Terrain, type Faction, type Unit, type UnitKind, type World } from "./types";
import { distToBuilding, terrainAt } from "./world";
import { hypot } from "./fmath";

/**
 * Robot infantry (INFANTRY.md). A squad is ONE sim unit with one HP pool,
 * drawn as `UNITS[kind].squad` robots: a robot falls each time HP crosses a
 * 1/N step, and the squad's firepower scales with the robots still standing.
 */

/** Is this kind a robot infantry squad (Trooper, Rocket, Sniper)? */
export const isInfantry = (kind: UnitKind): boolean => (UNITS[kind].squad ?? 0) > 0;

/** Robots a squad of this kind is drawn as (1 for anything that isn't infantry). */
export const squadSize = (kind: UnitKind): number => UNITS[kind].squad ?? 1;

/**
 * Robots still standing: ceil(N × hp / maxHp), clamped to 0…N. A full squad
 * has N; it drops to N − 1 the moment HP falls below (N − 1)/N of max.
 */
export function squadAlive(u: Pick<Unit, "kind" | "hp">): number {
  const n = squadSize(u.kind);
  if (u.hp <= 0) return 0;
  return Math.max(1, Math.min(n, Math.ceil((n * u.hp) / UNITS[u.kind].hp - 1e-9)));
}

/** Firepower multiplier from losses: alive / N (1 for non-infantry). */
export function squadFirepower(u: Pick<Unit, "kind" | "hp">): number {
  const n = squadSize(u.kind);
  return n <= 1 ? 1 : squadAlive(u) / n;
}

/** Is this a transport (the Condor)? */
export const isTransport = (kind: UnitKind): boolean => (UNITS[kind].capacity ?? 0) > 0;

/**
 * Can `faction` see enemy unit `u` right now? Its tile must be in sight, and
 * a Sniper Team concealed in Woods (only seen by enemies within
 * INFANTRY.concealRadius, until INFANTRY.concealAfterShot s after it fires)
 * stays hidden. Use this — not a bare tile check — wherever a side decides
 * whether it sees an enemy UNIT: targeting, the AI's eyes, the renderer.
 */
export function unitSeenBy(w: World, faction: Faction, u: Unit): boolean {
  if (u.faction === faction || UNITS[u.kind].alwaysVisible) return true; // (a Goliath can't hide)
  if (!isVisible(w, faction, Math.floor(u.x), Math.floor(u.y))) return false;
  return !concealedFrom(w, faction, u);
}

/** Can this kind hide in Woods? (The Sniper Team: a camouflaged marksman pair.) */
const conceals = (kind: UnitKind): boolean => kind === "sniper";

/**
 * Is `u` a Sniper Team hidden from `faction` by Woods concealment? It is when
 * it stands in Woods, has not fired for more than INFANTRY.concealAfterShot
 * seconds, and none of `faction`'s units or buildings is within
 * INFANTRY.concealRadius tiles. Independent of fog: it hides the unit even
 * where the tile is in sight (Clear Skies included — the woods still hide it).
 * Never true for a side's own units.
 */
export function concealedFrom(w: World, faction: Faction, u: Unit): boolean {
  if (u.faction === faction || !conceals(u.kind)) return false;
  if (terrainAt(w, Math.floor(u.x), Math.floor(u.y)) !== Terrain.Forest) return false;
  if (w.tick - u.firedTick <= INFANTRY.concealAfterShot * TICK_RATE) return false; // the muzzle flash gives it away
  const r = INFANTRY.concealRadius;
  for (const o of w.units.values()) {
    if (o.faction !== faction) continue;
    const dx = o.x - u.x;
    const dy = o.y - u.y;
    if (dx * dx + dy * dy <= r * r) return false;
  }
  for (const b of w.buildings.values()) if (b.faction === faction && distToBuilding(b, u.x, u.y) <= r) return false;
  return true;
}

/** Can this kind crush infantry by driving over it? (The Mastodon.) */
export const crushes = (kind: UnitKind): boolean => kind === "mastodon";

/** Ticks between `crush` FxEvents for one victim while a Mastodon keeps rolling over it. */
const CRUSH_FX_EVERY = 5;

/**
 * Crushing (movement.ts calls this after movement, with the Mastodons that
 * actually drove this tick): each deals INFANTRY.crushDps per second to
 * every ENEMY squad whose centre is within its radius + INFANTRY.crushReach,
 * credited to the Mastodon (kills, XP, retaliation) with the usual `hit`
 * events, plus a `crush` FxEvent on first contact and every few ticks after.
 * A Mastodon standing still crushes nothing; friendly squads step aside
 * (separation) and are never hurt.
 */
export function tickCrush(w: World, moved: readonly Unit[]): void {
  const damage = INFANTRY.crushDps / TICK_RATE;
  for (const t of moved) {
    if (t.hp <= 0 || !crushes(t.kind)) continue;
    const reach = UNITS[t.kind].radius + INFANTRY.crushReach;
    const hits: { id: number; damage: number }[] = [];
    for (const v of w.units.values()) {
      if (v.faction === t.faction || v.hp <= 0 || !isInfantry(v.kind)) continue;
      const dx = v.x - t.x;
      const dy = v.y - t.y;
      if (dx > reach || dx < -reach || dy > reach || dy < -reach || hypot(dx, dy) > reach) continue;
      // first contact (not under this Mastodon last tick), then every few ticks
      const rolling = v.lastAttackerId === t.id && v.damagedTick >= w.tick - 1;
      if (!rolling || w.tick % CRUSH_FX_EVERY === 0)
        w.fx.push({ type: "crush", faction: v.faction, id: v.id, attackerId: t.id, x: v.x, y: v.y });
      hits.push({ id: v.id, damage });
    }
    if (hits.length > 0) strikeDamage(w, hits, t.id, t.faction);
  }
}
