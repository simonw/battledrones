import { BUILDINGS, DAMAGE_VS, POWERS, TICK_RATE, UNITS } from "../balance";
import { isVisible, knownBuildings } from "../fog";
import { canWalk } from "../goliath";
import { calldownBlocker, isStunned, powerStatus } from "../powers";
import type { BuildingKind, Calldown, Command, Faction, PowerKind, Unit, World } from "../types";
import { dist, domainOf, hqOf, moveClassOf, passable, regionAt } from "../world";
import type { AiMode, AiState, Difficulty } from "./commander";
import { ffaTactic } from "./ffa";
import { pastLateSiege, type PushTarget } from "./goliath";
import { seenEnemies } from "./intel";
import { cos, hypot, sin } from "../fmath";
import { QUARTER, turnVec } from "../sides";

/**
 * The commander's use of calldowns (powers.ts), and its reflex for getting
 * out from under the enemy's. Telegraphs are public, so the AI reads the
 * same `World.powers.active` list the player sees as reticles; it fires
 * through the same validated `calldown` command.
 */

/** Seconds before the AI notices a reticle and scatters (its reaction time). */
const REACTION: Record<Difficulty, number> = { easy: 1.1, normal: 0.6, hard: 0.4 };
/** How far (tiles) a unit runs from a reticle's centre direction. */
const DODGE_DIST = 4;
/** Visible ground clump worth barraging (scrap within the shell spread): rarer, bigger hits leave charge for EMPs and pods. */
const BARRAGE_MIN = 800;
const BARRAGE_SPREAD = 2.2;
/** Clump worth a Sky Hammer before the AI settles for buildings. */
const HAMMER_CLUMP = 700;
const HOME_RADIUS = 11;
/** Offensive EMPs only spend charge above this (keeps a Drop Pod's worth for defence). */
const OFFENCE_RESERVE = 80;
/**
 * A free-for-all's Goliath push (ai/goliath.ts planPush): once its lead
 * Goliath is this close (tiles) to the target, the Sky Hammer and the
 * Barrage go there…
 */
const PUSH_STRIKE = 8;
/** …at the target, or what stands within this many tiles of it (its Menders, its escort). */
const PUSH_AIM = 4;

interface Memo {
  /** Enemy calldowns already reacted to. */
  seen: Set<number>;
  /** Unit id → tick until which it is busy dodging (keep other orders off it). */
  dodging: Map<number, number>;
}

/** Per-commander reflex memory, kept beside (not inside) AiState. */
const memos = new WeakMap<AiState, Memo>();
function memo(s: AiState): Memo {
  let m = memos.get(s);
  if (!m) {
    m = { seen: new Set(), dodging: new Map() };
    memos.set(s, m);
  }
  return m;
}

/** Last tick a calldown does damage (the final Barrage shell). */
const endTick = (c: Calldown) => (c.shells.length > 0 ? c.shells[c.shells.length - 1]!.tick : c.landTick);

/**
 * Per-tick dodge reflex (runs before the decision-interval gate): after a
 * difficulty-dependent reaction delay, every unit inside an enemy reticle
 * gets a move order ~4 tiles out from its centre, if there's still time.
 */
export function dodgeCalldowns(w: World, faction: Faction, s: AiState): Command[] {
  const active = w.powers.active;
  const m = memo(s);
  if (m.dodging.size > 0) for (const [id, until] of m.dodging) if (until <= w.tick) m.dodging.delete(id);
  if (active.length === 0) return [];
  const delay = Math.round(REACTION[s.difficulty] * TICK_RATE);
  const cmds: Command[] = [];
  const hq = hqOf(w, faction);
  for (const c of active) {
    if (c.faction === faction || m.seen.has(c.id) || w.tick - c.startTick < delay) continue;
    m.seen.add(c.id);
    const left = endTick(c) - w.tick;
    if (left < 3) continue; // too late to get anywhere
    const reach = c.radius + 0.7;
    for (const u of w.units.values()) {
      if (u.faction !== faction) continue;
      // (not a Goliath that can't walk off — a move packs a dug-in one up — nor a lift: a move to
      // one of its Condors would fly the Goliath off course)
      if (!canWalk(u) || u.order.type === "lift") continue;
      const d = hypot(u.x - c.x, u.y - c.y);
      if (d > reach) continue;
      // radially out; from dead centre, back toward home
      let dx = u.x - c.x;
      let dy = u.y - c.y;
      if (d < 0.3) {
        dx = (hq ? hq.tx + 1.5 : w.width / 2) - c.x;
        dy = (hq ? hq.ty + 1.5 : w.height / 2) - c.y;
      }
      const len = hypot(dx, dy) || 1;
      const { x, y } = dodgeSpot(w, u, dx / len, dy / len);
      cmds.push({ type: "move", faction, unitIds: [u.id], x, y });
      m.dodging.set(u.id, endTick(c) + 5);
    }
  }
  if (m.seen.size > 64) for (const id of [...m.seen].slice(0, 32)) m.seen.delete(id);
  return cmds;
}

/**
 * Where a unit runs to, DODGE_DIST along (ux, uy). On an island map a squad
 * on a small island would run into the sea (and stop at the shore, still
 * under the shells): it turns, a little at a time, until the spot is on
 * ground it can reach, or settles for a shorter run.
 */
function dodgeSpot(w: World, u: Unit, ux: number, uy: number): { x: number; y: number } {
  const at = (a: number, d: number) => {
    const c = cos(a);
    const s = sin(a);
    return {
      x: Math.min(w.width - 0.5, Math.max(0.5, u.x + (ux * c - uy * s) * d)),
      y: Math.min(w.height - 0.5, Math.max(0.5, u.y + (ux * s + uy * c) * d))
    };
  };
  const mc = moveClassOf(u.kind);
  const home = mc === "air" ? 0 : regionAt(w, Math.floor(u.x), Math.floor(u.y), mc);
  if (!w.rules?.islands || !home) return at(0, DODGE_DIST);
  for (const d of [DODGE_DIST, 3, 2])
    for (const a of [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]) {
      const p = at(a, d);
      if (regionAt(w, Math.floor(p.x), Math.floor(p.y), mc) === home) return p;
    }
  return at(0, DODGE_DIST);
}

/** Units currently running from a reticle: the decision pass leaves them be. */
export function dodgingUnits(w: World, s: AiState): number[] {
  const m = memos.get(s);
  if (!m) return [];
  return [...m.dodging].filter(([, until]) => until > w.tick).map(([id]) => id);
}

export interface CalldownContext {
  mode: AiMode;
  hqC: { x: number; y: number };
  guardPoint: { x: number; y: number };
  enemyHqPos: { x: number; y: number };
  army: Unit[];
  /** Visible armed intruders near our base or harvesters. */
  threats: { id: number; x: number; y: number }[];
  /** A free-for-all's Goliath push under way (ai/goliath.ts planPush): its target, and where its lead Goliath is. */
  push?: { target: PushTarget; lead: { x: number; y: number } } | null;
}

interface Clump {
  x: number;
  y: number;
  value: number;
}

/**
 * Densest visible enemy clump: tries every visible unit (and the centroid
 * of its neighbours) as a centre and scores what lies within `radius`
 * (`weight`: what a unit `d` tiles from the centre is worth).
 */
function bestClump(
  units: Unit[],
  radius: number,
  weight: (u: Unit, d: number) => number
): Clump | null {
  let best: Clump | null = null;
  const score = (x: number, y: number) => {
    let v = 0;
    for (const o of units) {
      const d = hypot(o.x - x, o.y - y);
      if (d <= radius) v += weight(o, d);
    }
    return v;
  };
  for (const u of units) {
    let sx = 0;
    let sy = 0;
    let n = 0;
    for (const o of units)
      if (hypot(o.x - u.x, o.y - u.y) <= radius) {
        sx += o.x;
        sy += o.y;
        n++;
      }
    for (const [x, y] of [
      [u.x, u.y],
      [sx / n, sy / n]
    ] as [number, number][]) {
      const v = score(x, y);
      if (!best || v > best.value) best = { x, y, value: v };
    }
  }
  return best;
}

/** Nearest visible, open-ground tile to (x, y) — where a Drop Pod may land. */
function podSite(w: World, faction: Faction, x: number, y: number): { x: number; y: number } | null {
  const cx = Math.floor(x);
  const cy = Math.floor(y);
  const q = QUARTER[faction]; // scan in the side's own frame (mirror-fair ties)
  for (let r = 0; r <= 4; r++)
    for (let i = -r; i <= r; i++)
      for (let j = -r; j <= r; j++) {
        const [dx, dy] = turnVec(q, j, i);
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = cx + dx;
        const ty = cy + dy;
        if (!passable(w, tx, ty, "ground") || !isVisible(w, faction, tx, ty)) continue;
        // a little room around it, so the crew can step out
        let open = 0;
        for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) if (passable(w, tx + ox, ty + oy, "ground")) open++;
        if (open >= 6) return { x: tx + 0.5, y: ty + 0.5 };
      }
  return null;
}

const value = (us: Unit[]) => us.reduce((v, u) => v + UNITS[u.kind].cost, 0);
const PRODUCTION: BuildingKind[] = ["fab-plant", "airpad", "assembly-bay", "tech-lab", "gantry"];
/** A Sky Hammer's worth of a building it catches: production 1.5, a Gantry with a Goliath on the cradle (all that progress lost) 3. */
const hammerWorth = (w: World, kb: { id: number; kind: BuildingKind }): number =>
  kb.kind === "gantry" && w.buildings.get(kb.id)?.queue[0]?.kind === "goliath"
    ? 3
    : PRODUCTION.includes(kb.kind) ? 1.5 : kb.kind === "hq" ? 1.2 : 1;

/**
 * What `damage` is worth against unit `u`, in scrap: its price times the
 * share of its health it takes, all of it once it kills. (A free-for-all
 * from 12:00 aims the Sky Hammer and the Barrage by this, not by the price
 * of what's under the reticle: a full-health Goliath, 1600, always outbid a
 * clump, yet a Hammer takes 260 of its 3000 and one Mender heals that in
 * half a minute — so 139. A hurt one the blast would finish: its price.)
 */
const damageWorth = (u: Unit, damage: number): number => UNITS[u.kind].cost * Math.min(1, damage / Math.max(1, u.hp));
/** The Sky Hammer's damage to a unit `d` tiles from where it lands (any armour, ground or air). */
const hammerDamage = (d: number): number => POWERS.hammer.unitDamage * (1 - 0.5 * Math.min(1, d / POWERS.hammer.radius));
/** A Barrage's to a ground unit `d` tiles from its aim: every shell's splash through its armour (the scatter averaged out). */
const barrageDamage = (u: Unit, d: number): number => {
  const b = POWERS.barrage;
  return b.shells * b.damage * DAMAGE_VS.explosive[UNITS[u.kind].armor] * (1 - 0.5 * Math.min(1, d / b.splash));
};

/**
 * One decision pass's calldowns: at most one meter power, plus the Sky
 * Hammer when it is up. Defence first (EMP / Drop Pod against a superior
 * intrusion), then a Barrage on the best visible clump, then offence (EMP
 * the turrets in front of an assault, Drop Pod reinforcements to a wave).
 */
export function planCalldowns(w: World, faction: Faction, s: AiState, ctx: CalldownContext): Command[] {
  const cmds: Command[] = [];
  const fire = (power: PowerKind, x: number, y: number): boolean => {
    if (calldownBlocker(w, faction, power, x, y)) return false;
    cmds.push({ type: "calldown", faction, power, x, y });
    return true;
  };
  const ready = (p: PowerKind) => powerStatus(w, faction, p).ready;
  const visibleEnemies = seenEnemies(w, faction); // (a Sniper Team hidden in the woods isn't aimed at)
  const armed = visibleEnemies.filter((u) => UNITS[u.kind].dps > 0 || UNITS[u.kind].heal);
  // (a free-for-all from 12:00: aimed by the damage they'd do, and at a push's target once its
  // Goliaths are there — ai/ffa.ts calldown aim)
  const aim = ffaTactic(w, "calldownAim") && pastLateSiege(w);
  const push = aim && ctx.push ? ctx.push : null;
  const strike = push && dist(push.lead.x, push.lead.y, push.target.x, push.target.y) <= PUSH_STRIKE ? push.target : null;
  /** What stands by the push's target (it, its Menders, its escort). */
  const atStrike = (us: Unit[]) => (strike ? us.filter((u) => dist(u.x, u.y, strike.x, strike.y) <= PUSH_AIM) : []);

  // --- Sky Hammer: a rich clump, else production, else the HQ -------------
  // (a push's target: there, whatever it's worth — an HQ, or the best of what stands by its Goliath)
  if (ready("hammer")) {
    const hammerWeight = (u: Unit, d: number) =>
      (aim ? damageWorth(u, hammerDamage(d)) : UNITS[u.kind].cost) * (isStunned(w, u.id) ? 1.3 : 1);
    const t =
      strike?.building
        ? strike
        : bestClump(atStrike(visibleEnemies), POWERS.hammer.radius * 0.8, hammerWeight) ?? hammerTarget(w, faction, visibleEnemies, hammerWeight);
    if (t) fire("hammer", t.x, t.y);
  }

  // --- defence: a superior force at the base or the mining line ----------
  const homeThreat = armed.filter(
    (u) => dist(u.x, u.y, ctx.hqC.x, ctx.hqC.y) <= HOME_RADIUS || dist(u.x, u.y, ctx.guardPoint.x, ctx.guardPoint.y) <= 6
  );
  const threatValue = value(homeThreat);
  if (threatValue >= 450) {
    const guard = value(
      ctx.army.filter(
        (u) => dist(u.x, u.y, ctx.hqC.x, ctx.hqC.y) <= HOME_RADIUS || dist(u.x, u.y, ctx.guardPoint.x, ctx.guardPoint.y) <= 6
      )
    );
    if (threatValue > guard * 1.25) {
      // reinforcements that stay beat a 4 s freeze: Drop Pod first, else EMP
      if (ready("droppod")) {
        // between the HQ and the intruders, inside our own vision
        const cx = homeThreat.reduce((a, u) => a + u.x, 0) / homeThreat.length;
        const cy = homeThreat.reduce((a, u) => a + u.y, 0) / homeThreat.length;
        const d = Math.max(1, dist(cx, cy, ctx.hqC.x, ctx.hqC.y));
        const k = Math.min(1, Math.max(0, (d - 3) / d));
        const site = podSite(w, faction, ctx.hqC.x + (cx - ctx.hqC.x) * k, ctx.hqC.y + (cy - ctx.hqC.y) * k);
        if (site && fire("droppod", site.x, site.y)) return cmds;
      }
      const clump = bestClump(homeThreat, POWERS.emp.radius - 0.4, (u) => UNITS[u.kind].cost);
      if (clump && clump.value >= 350 && ready("emp") && fire("emp", clump.x, clump.y)) return cmds;
    }
  }

  // --- Barrage: the best visible ground clump (Easy never shells) ---------
  if (s.difficulty !== "easy" && ready("barrage")) {
    const ground = visibleEnemies.filter((u) => domainOf(u) === "ground"); // (a Goliath on a lift is in the air)
    const barrageWeight = (u: Unit, d: number) =>
      (aim ? damageWorth(u, barrageDamage(u, d)) : UNITS[u.kind].cost) * (isStunned(w, u.id) ? 1.5 : 1);
    // (a push's target first, if a clump there is worth the shells)
    const there = bestClump(atStrike(ground), BARRAGE_SPREAD, barrageWeight);
    const clump = there && there.value >= BARRAGE_MIN ? there : bestClump(ground, BARRAGE_SPREAD, barrageWeight);
    if (clump && clump.value >= BARRAGE_MIN && fire("barrage", clump.x, clump.y)) return cmds;
  }

  // --- an enemy Goliath being mended: an EMP blocks its repair and freezes its Menders
  // (only from surplus charge, and with our units there to make the most of it)
  if (ready("emp") && w.powers.meter[faction] >= OFFENCE_RESERVE) {
    for (const e of visibleEnemies) {
      if (!e.goliath || isStunned(w, e.id)) continue;
      const menders = visibleEnemies.filter((o) => UNITS[o.kind].heal && hypot(o.x - e.x, o.y - e.y) <= 3).length;
      if (menders < 2 || value(ctx.army.filter((u) => dist(u.x, u.y, e.x, e.y) <= 9)) < 550) continue;
      if (fire("emp", e.x, e.y)) return cmds;
    }
  }

  // --- offence: knock out the defences in front of a wave -----------------
  // (only from surplus charge: offence must not starve the defensive powers)
  if (ctx.mode === "assault" && ready("emp") && w.powers.meter[faction] >= OFFENCE_RESERVE) {
    const defences = knownBuildings(w, faction).filter((kb) => kb.kind === "turret" || kb.kind === "sam-site");
    let best: { x: number; y: number; v: number } | null = null;
    for (const kb of defences) {
      const st = BUILDINGS[kb.kind];
      const x = kb.tx + st.size / 2;
      const y = kb.ty + st.size / 2;
      const near = value(ctx.army.filter((u) => dist(u.x, u.y, x, y) <= st.range + 2.5));
      if (near < 550) continue;
      // centre on the defence, nudged toward a neighbouring one if it's in reach
      const v = near + defences.filter((o) => dist(o.tx, o.ty, kb.tx, kb.ty) <= POWERS.emp.radius).length * 200;
      if (!best || v > best.v) best = { x, y, v };
    }
    if (best && fire("emp", best.x, best.y)) return cmds;
    // or freeze the army our wave is fighting
    const fighting = armed.filter((u) => ctx.army.some((a) => dist(a.x, a.y, u.x, u.y) <= 6));
    const clump = bestClump(fighting, POWERS.emp.radius - 0.4, (u) => UNITS[u.kind].cost);
    if (clump && clump.value >= 900 && fire("emp", clump.x, clump.y)) return cmds;
  }

  // --- Drop Pod reinforcements for a wave in a fight away from home -------
  if (ctx.mode === "assault" && ready("droppod")) {
    const front = ctx.army.filter(
      (u) =>
        UNITS[u.kind].domain === "ground" &&
        dist(u.x, u.y, ctx.hqC.x, ctx.hqC.y) > HOME_RADIUS &&
        armed.some((e) => dist(e.x, e.y, u.x, u.y) <= 6)
    );
    const cx = front.reduce((a, u) => a + u.x, 0) / Math.max(1, front.length);
    const cy = front.reduce((a, u) => a + u.y, 0) / Math.max(1, front.length);
    // only a fight that hangs in the balance: free units for a stomp just feed the snowball
    const opposed = value(armed.filter((e) => dist(e.x, e.y, cx, cy) <= 8));
    if (value(front) >= 600 && opposed >= value(front) * 0.9) {
      // a couple of tiles behind the front, toward home
      const d = Math.max(1, dist(cx, cy, ctx.hqC.x, ctx.hqC.y));
      const site = podSite(w, faction, cx + ((ctx.hqC.x - cx) / d) * 2, cy + ((ctx.hqC.y - cy) / d) * 2);
      if (site) fire("droppod", site.x, site.y);
    }
  }
  return cmds;
}

/** Sky Hammer aim: a visible clump worth ≥ 700 (`weight`, bestClump), else the best production hit, else the HQ. */
function hammerTarget(
  w: World,
  faction: Faction,
  visibleEnemies: Unit[],
  weight: (u: Unit, d: number) => number
): { x: number; y: number } | null {
  const R = POWERS.hammer.radius;
  const clump = bestClump(visibleEnemies, R * 0.8, weight);
  if (clump && clump.value >= HAMMER_CLUMP) return clump;
  const known = knownBuildings(w, faction);
  const centre = (kb: (typeof known)[number]) => ({
    x: kb.tx + BUILDINGS[kb.kind].size / 2,
    y: kb.ty + BUILDINGS[kb.kind].size / 2
  });
  // aim at a production building, shading toward neighbours the blast also catches
  let best: { x: number; y: number; v: number } | null = null;
  for (const kb of known) {
    if (!PRODUCTION.includes(kb.kind)) continue;
    const c = centre(kb);
    for (const o of [kb, ...known]) {
      const oc = centre(o);
      const x = (c.x + oc.x) / 2;
      const y = (c.y + oc.y) / 2;
      let v = 0;
      for (const k of known) {
        const size = BUILDINGS[k.kind].size;
        const dx = Math.max(k.tx - x, 0, x - (k.tx + size));
        const dy = Math.max(k.ty - y, 0, y - (k.ty + size));
        if (hypot(dx, dy) > R - 0.2) continue;
        v += hammerWorth(w, k);
      }
      // must still catch the production building we aimed for
      const size = BUILDINGS[kb.kind].size;
      const ddx = Math.max(kb.tx - x, 0, x - (kb.tx + size));
      const ddy = Math.max(kb.ty - y, 0, y - (kb.ty + size));
      if (hypot(ddx, ddy) > R - 0.2) continue;
      if (!best || v > best.v) best = { x, y, v };
    }
  }
  if (best) return best;
  const hq = known.find((kb) => kb.kind === "hq");
  return hq ? centre(hq) : null;
}
