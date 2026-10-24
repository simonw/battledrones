/**
 * What one side sees, as compact text with stable ids (AGENT-BATTLES.md
 * "What observe() shows"), in that side's own frame. Built only from:
 * the side's own units, buildings, queues, scrap and meter; enemy units it
 * can see now (seenEnemies: fog and Sniper concealment applied); enemy
 * buildings as last seen (knownBuildings); terrain it has explored; and
 * public information (Uplinks, supply crates, calldown telegraphs, the
 * clock). Never the enemy's scrap, queues or orders.
 *
 * `observeState` builds a structured observation (tests check it for fog
 * leaks); `renderObservation` turns it into the text an agent reads, and
 * nothing else goes into that text.
 */
import { BUILDINGS, DAMAGE_VS, ECONOMY, GOLIATH, OBJECTIVES, POWERS, TICK_RATE, UNITS } from "../sim/balance";
import { seenEnemies } from "../sim/ai/intel";
import { isExplored, isVisible, knownBuildings } from "../sim/fog";
import { mapById } from "../sim/maps";
import { CRATE_NAMES } from "../sim/objectives";
import { OPENERS, OPENER_IDS, allowedOpener } from "../sim/openers";
import { GOLIATH_WEAPONS, isLifted, weaponReady } from "../sim/goliath";
import { unitSeenBy } from "../sim/infantry";
import { POWER_KINDS, POWER_NAMES, isStunned, powerBlocker } from "../sim/powers";
import { goliathBase, rulesOf } from "../sim/rules";
import type { BuildingKind, Faction, Unit, UnitKind, World } from "../sim/types";
import { Terrain } from "../sim/types";
import { hqOf } from "../sim/world";
import { clock, enemyOf, frameOf, type Frame } from "./frame";

export interface OwnUnit {
  id: number;
  kind: UnitKind;
  x: number;
  y: number;
  hp: number;
  order: string;
  rank: number;
  extra: string[];
}

export interface OwnBuilding {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  hp: number;
  queue: { kind: UnitKind; secs: number }[];
  rally: [number, number] | null;
  stunned: boolean;
}

export interface SeenEnemy {
  id: number;
  kind: UnitKind;
  x: number;
  y: number;
  hp: number;
  rank: number;
  airborne?: boolean;
}

export interface KnownEnemyBuilding {
  id: number;
  kind: BuildingKind;
  x: number;
  y: number;
  /** Health, only while its footprint is in sight right now. */
  hp: number | null;
}

export interface Observation {
  side: Faction;
  tick: number;
  scrap: number;
  meter: number;
  pending: { kind: BuildingKind; pct: number; secs: number; ready: boolean } | null;
  buildings: OwnBuilding[];
  units: OwnUnit[];
  enemies: SeenEnemy[];
  enemyBuildings: KnownEnemyBuilding[];
  uplinks: { id: number; x: number; y: number; owner: "ours" | "theirs" | null; bar: number; contested: boolean; taking: "us" | "enemy" | null; infantryOnly: boolean; crewed: boolean }[];
  crates: { id: number; x: number; y: number; reward: string; landsIn: number; expiresIn: number }[];
  strikes: { id: number; ours: boolean; power: string; x: number; y: number; radius: number; landsIn: number }[];
  powers: { name: string; cost: number; status: string }[];
  wrecks: { x: number; y: number; value: number; hot: boolean }[];
  winner: Faction | "draw" | null;
}

const pct = (hp: number, max: number) => Math.max(1, Math.round((100 * hp) / max));
const secs = (ticks: number) => Math.max(0, Math.ceil(ticks / TICK_RATE));

/** Kind order for unit groups: the balance table's. */
const KIND_ORDER = Object.keys(UNITS) as UnitKind[];

function byPos<T extends { x: number; y: number; id: number }>(a: T, b: T): number {
  return a.y - b.y || a.x - b.x || a.id - b.id;
}

function orderText(w: World, fr: Frame, u: Unit): string {
  const o = u.order;
  const p = (x: number, y: number) => fr.tile(x, y).join(",");
  switch (o.type) {
    case "idle":
      return "idle";
    case "move":
      return `move ${p(o.x, o.y)}`;
    case "attackMove":
      return `attack-move ${p(o.x, o.y)}`;
    case "attack": {
      // (a target that slipped back into the fog isn't named: the side can't see it)
      const t = w.units.get(o.targetId);
      const seen = t ? unitSeenBy(w, u.faction, t) : w.fog[u.faction].known.has(o.targetId) || w.buildings.get(o.targetId)?.faction === u.faction;
      return seen ? `attack #${o.targetId}` : "attack (target out of sight)";
    }
    case "harvest": {
      const [fx, fy] = fr.tile(o.fieldX + 0.5, o.fieldY + 0.5);
      const phase = { toField: "to field", harvesting: "harvesting", toBase: "returning", unloading: "unloading" }[o.phase];
      return `harvest ${fx},${fy} ${phase}`;
    }
    case "board":
      return `boarding #${o.carrierId}`;
    case "unload":
      return `dropping at ${p(o.x, o.y)}`;
    case "lift":
      return `lifting #${o.goliathId}`;
  }
}

export function observeState(w: World, side: Faction): Observation {
  const fr = frameOf(w, side);
  const f = w.factions[side];
  const own = (x: number, y: number) => fr.tile(x, y);

  const buildings: OwnBuilding[] = [];
  for (const b of w.buildings.values()) {
    if (b.faction !== side) continue;
    const [x, y] = fr.topLeft(b.kind, b.tx, b.ty);
    buildings.push({
      id: b.id, kind: b.kind, x, y, hp: pct(b.hp, BUILDINGS[b.kind].hp),
      queue: b.queue.map((q) => ({ kind: q.kind, secs: secs(q.remaining) })),
      rally: b.rally ? own(b.rally.x, b.rally.y) : null,
      stunned: isStunned(w, b.id)
    });
  }
  buildings.sort(byPos);

  const units: OwnUnit[] = [];
  for (const u of w.units.values()) {
    if (u.faction !== side) continue;
    const [x, y] = own(u.x, u.y);
    const extra: string[] = [];
    if (u.kind === "harvester" && u.cargo >= 1) extra.push(`cargo ${Math.round(u.cargo)}`);
    if (u.passengers?.length) extra.push(`carrying ${u.passengers.map((p) => `${p.kind} #${p.id}`).join(", ")}`);
    if (u.goliath) {
      const g = u.goliath;
      extra.push(`mode ${g.mode}${g.modeTicks ? ` (${secs(g.modeTicks)}s)` : ""}`);
      if (g.lift) {
        const l = g.lift;
        extra.push(`${l.phase === "carrying" ? "airborne" : "hooking"} with ${l.carriers.map((id) => `#${id}`).join(",")}${l.dest ? ` to ${own(l.dest.x, l.dest.y).join(",")}` : " hovering"}${l.setDown ? " (landing)" : ""}`);
      }
      extra.push(`weapons ready: ${GOLIATH_WEAPONS.filter((k) => weaponReady(u, k)).join(",") || "none"}`);
      if (g.queue.length) extra.push(`queue ${g.queue.map((q, i) => i === 0 ? `${q.kind}(${secs(q.remaining)}s)` : q.kind).join(",")}${g.mode !== "anchored" || g.lift ? " (paused until anchored)" : ""}`);
      if (g.rally) extra.push(`rally ${own(g.rally.x, g.rally.y).join(",")}`);
    }
    if (isStunned(w, u.id)) extra.push("EMP-stunned");
    units.push({ id: u.id, kind: u.kind, x, y, hp: pct(u.hp, UNITS[u.kind].hp), order: orderText(w, fr, u), rank: u.rank, extra });
  }
  units.sort((a, b) => KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) || byPos(a, b));

  const enemies: SeenEnemy[] = seenEnemies(w, side).map((u) => {
    const [x, y] = own(u.x, u.y);
    return { id: u.id, kind: u.kind, x, y, hp: pct(u.hp, UNITS[u.kind].hp), rank: u.rank, ...(u.goliath ? { airborne: isLifted(u) } : {}) };
  });
  enemies.sort(byPos);

  const enemyBuildings: KnownEnemyBuilding[] = knownBuildings(w, side).map((kb) => {
    const [x, y] = fr.topLeft(kb.kind, kb.tx, kb.ty);
    const size = BUILDINGS[kb.kind].size;
    let inSight = false;
    for (let dy = 0; dy < size && !inSight; dy++)
      for (let dx = 0; dx < size && !inSight; dx++) inSight = isVisible(w, side, kb.tx + dx, kb.ty + dy);
    const b = inSight ? w.buildings.get(kb.id) : undefined;
    return { id: kb.id, kind: kb.kind, x, y, hp: b ? pct(b.hp, BUILDINGS[b.kind].hp) : null };
  });
  enemyBuildings.sort(byPos);

  const s = side === "blue" ? 1 : -1;
  const uplinks = w.objectives.uplinks.map((l) => {
    const [x, y] = own(l.x, l.y);
    return {
      id: l.id, x, y,
      owner: l.owner === side ? ("ours" as const) : l.owner ? ("theirs" as const) : null,
      bar: Math.round(l.progress * s),
      contested: l.contested,
      taking: l.pushing === side ? ("us" as const) : l.pushing ? ("enemy" as const) : null,
      infantryOnly: !!l.infantryOnly,
      crewed: !!l.crewed
    };
  });
  uplinks.sort(byPos);

  const crates = w.objectives.crates.map((c) => {
    const [x, y] = own(c.x, c.y);
    return { id: c.id, x, y, reward: CRATE_NAMES[c.reward], landsIn: secs(c.landTick - w.tick), expiresIn: secs(c.expireTick - w.tick) };
  });
  crates.sort(byPos);

  const strikes = w.powers.active.map((c) => {
    const [x, y] = own(c.x, c.y);
    const last = c.shells.length ? c.shells[c.shells.length - 1]!.tick : c.landTick;
    return { id: c.id, ours: c.faction === side, power: POWER_NAMES[c.power], x, y, radius: c.radius, landsIn: secs(Math.min(c.landTick, last) - w.tick) };
  });

  const powers = POWER_KINDS.map((p) => {
    const why = powerBlocker(w, side, p);
    return { name: p, cost: p === "hammer" ? 0 : POWERS[p].cost, status: why ?? "ready" };
  });

  const wrecks = w.wrecks
    .filter((k) => isVisible(w, side, Math.floor(k.x), Math.floor(k.y)))
    .map((k) => {
      const [x, y] = own(k.x, k.y);
      return { id: k.id, x, y, value: Math.round(k.value), hot: k.hot > 0 };
    })
    .sort(byPos)
    .map(({ x, y, value, hot }) => ({ x, y, value, hot }));

  const pend = f.pending;
  return {
    side,
    tick: w.tick,
    scrap: Math.floor(f.scrap),
    meter: Math.floor(w.powers.meter[side]),
    pending: pend
      ? {
          kind: pend.kind,
          pct: Math.min(100, Math.round(100 * (1 - pend.remaining / (BUILDINGS[pend.kind].buildTime * TICK_RATE)))),
          secs: secs(pend.remaining),
          ready: pend.ready
        }
      : null,
    buildings, units, enemies, enemyBuildings, uplinks, crates, strikes, powers, wrecks,
    winner: w.winner
  };
}

/** What the arena adds around the state: the round, the news, last orders' results, the notes. */
export interface ObserveExtras {
  round: number;
  lastRound: number;
  roundSecs: number;
  /** Where the building under construction will go (own frame), if decided. */
  placeAt?: [number, number] | null;
  news?: string[];
  results?: string[];
  notes?: string;
  /** Rounds still being skipped by `wait`. */
  waiting?: number;
}

export function renderObservation(o: Observation, x: ObserveExtras): string {
  const L: string[] = [];
  const held = o.uplinks.filter((l) => l.owner === "ours").length;
  L.push(
    `ROUND ${x.round}/${x.lastRound}  T ${clock(o.tick)}  scrap ${o.scrap}  charge ${o.meter}/${POWERS.meterMax}` +
      (o.uplinks.length ? `  uplinks ${held}/${o.uplinks.length}` : "")
  );
  if (o.winner) L.push(o.winner === "draw" ? "THE BATTLE IS OVER: A DRAW." : o.winner === o.side ? "THE BATTLE IS OVER: YOU WON." : "THE BATTLE IS OVER: YOU LOST.");
  if (o.pending)
    L.push(
      o.pending.ready
        ? `CONSTRUCTION ${o.pending.kind} ready, placing it${x.placeAt ? ` at ${x.placeAt.join(",")}` : ""}`
        : `CONSTRUCTION ${o.pending.kind} ${o.pending.pct}% (ready in ${o.pending.secs}s)${x.placeAt ? `, goes at ${x.placeAt.join(",")}` : ""}`
    );
  else L.push("CONSTRUCTION idle: you can start a building");
  L.push("BUILDINGS");
  for (const b of o.buildings) {
    const bits = [`#${b.id} ${b.kind} ${b.x},${b.y} ${b.hp}%`];
    if (b.queue.length) bits.push(`queue ${b.queue.map((q, i) => (i === 0 ? `${q.kind}(${q.secs}s)` : q.kind)).join(",")}`);
    if (b.rally) bits.push(`rally ${b.rally.join(",")}`);
    if (b.stunned) bits.push("EMP-stunned");
    L.push("  " + bits.join(" "));
  }
  L.push("UNITS" + (o.units.length ? "" : " none"));
  const groups = new Map<UnitKind, OwnUnit[]>();
  for (const u of o.units) groups.set(u.kind, [...(groups.get(u.kind) ?? []), u]);
  for (const [kind, us] of groups)
    L.push(
      `  ${kind} ×${us.length}: ` +
        us.map((u) => [`#${u.id} ${u.x},${u.y} ${u.hp}% ${u.order}`, u.rank ? `★${u.rank}` : "", ...u.extra].filter(Boolean).join(" ")).join("; ")
    );
  L.push("ENEMY SEEN" + (o.enemies.length ? "" : " none"));
  for (const e of o.enemies) L.push(`  #${e.id} ${e.kind} ${e.x},${e.y} ${e.hp}%${e.rank ? ` ★${e.rank}` : ""}${e.airborne === undefined ? "" : e.airborne ? " airborne" : " grounded"}`);
  L.push("ENEMY BUILDINGS (as last seen)" + (o.enemyBuildings.length ? "" : " none"));
  for (const b of o.enemyBuildings) L.push(`  #${b.id} ${b.kind} ${b.x},${b.y}${b.hp !== null ? ` ${b.hp}% in sight` : ""}`);
  if (o.uplinks.length) {
    L.push("UPLINKS");
    for (const l of o.uplinks) {
      const bits = [`#${l.id} ${l.x},${l.y} ${l.owner ?? "neutral"}`];
      if (l.contested) bits.push("contested");
      else if (l.taking) bits.push(`(${l.taking === "us" ? "we are" : "enemy is"} taking it, bar ${l.bar > 0 ? "+" : ""}${l.bar})`);
      if (l.infantryOnly) bits.push(`island: infantry only${l.owner ? (l.crewed ? ", crewed" : ", uncrewed: not paying") : ""}`);
      L.push("  " + bits.join(" "));
    }
  }
  const powerLine = o.powers.map((p) => `${p.name}${p.cost ? `(${p.cost})` : ""} ${p.status === "ready" ? "READY" : p.status.replace(/^.*?(needs|recharging|comes online)/i, "$1")}`);
  L.push(`CALLDOWNS ${powerLine.join("; ")}`);
  if (o.strikes.length) {
    L.push("STRIKE WARNINGS");
    for (const s of o.strikes) L.push(`  ${s.ours ? "our" : "ENEMY"} ${s.power} at ${s.x},${s.y} radius ${s.radius}, lands in ${s.landsIn}s`);
  }
  if (o.crates.length) {
    L.push("SUPPLY CRATES (first non-harvester unit to touch one claims it)");
    for (const c of o.crates) L.push(`  #${c.id} ${c.reward} at ${c.x},${c.y} ${c.landsIn > 0 ? `lands in ${c.landsIn}s` : `landed, burns out in ${c.expiresIn}s`}`);
  }
  if (o.wrecks.length) {
    const shown = o.wrecks.slice(0, 12);
    L.push(`WRECKS in sight (drive a ground unit over one to salvage it): ${shown.map((k) => `${k.value} at ${k.x},${k.y}${k.hot ? " (hot)" : ""}`).join("; ")}${o.wrecks.length > shown.length ? "; …" : ""}`);
  }
  if (x.news?.length) {
    L.push(`SINCE YOUR LAST TURN`);
    for (const n of x.news) L.push("  " + n);
  }
  if (x.results?.length) {
    L.push("YOUR LAST ORDERS");
    for (const r of x.results) L.push("  " + r);
  }
  if (x.waiting) L.push(`(waiting: ${x.waiting} more round${x.waiting > 1 ? "s" : ""} skipped unless something urgent happens)`);
  L.push(`YOUR NOTES: ${x.notes?.trim() ? x.notes : "(none yet)"}`);
  return L.join("\n");
}

// ------------------------------------------------------------- ASCII maps ---

/** Terrain enum → character (tools/export-maps.ts, with open sea as "_"). */
export const TERRAIN_CHARS = ".#$~=:T*H,_";

export const TERRAIN_LEGEND =
  ". ground  # rock  $ scrap field  * crystal field (richer)  ~ water (lava on volcanic maps)  _ open sea  = road  H bridge  , shallows (ford)  : rough ground  T woods";

/** A column ruler for an ASCII map whose column c shows tile c × scale. */
function ruler(cols: number, scale: number, pad: number): string[] {
  let tens = "";
  for (let c = 0; c < cols; c++) {
    const x = c * scale;
    if (x % 10 === 0 && tens.length <= c) tens = tens.padEnd(c) + String(x);
  }
  const lines = [" ".repeat(pad) + tens];
  if (scale === 1) {
    let units = "";
    for (let c = 0; c < cols; c++) units += String(c % 10);
    lines.push(" ".repeat(pad) + units);
  }
  return lines;
}

/**
 * The whole map at the start, in `side`'s frame: terrain, both HQs (the
 * enemy's is the mirror of yours: public), and the Uplinks. Maps wider than
 * 64 tiles are drawn at half size (each character is 2×2 tiles: resources
 * win, then the commonest terrain).
 */
export function asciiMap(w: World, side: Faction): { text: string; scale: number } {
  const fr = frameOf(w, side);
  const scale = w.width > 64 ? 2 : 1;
  const cols = Math.ceil(w.width / scale);
  const rows = Math.ceil(w.height / scale);
  const mark = new Map<number, string>();
  const key = (c: number, r: number) => r * 4096 + c;
  for (const b of w.buildings.values()) {
    if (b.kind !== "hq") continue;
    const size = BUILDINGS.hq.size;
    const [fx, fy] = fr.topLeft("hq", b.tx, b.ty);
    for (let dy = 0; dy < size; dy++)
      for (let dx = 0; dx < size; dx++)
        mark.set(key(Math.floor((fx + dx) / scale), Math.floor((fy + dy) / scale)), b.faction === side ? "@" : "&");
  }
  for (const l of w.objectives.uplinks) {
    const [fx, fy] = fr.tile(l.x, l.y);
    mark.set(key(Math.floor(fx / scale), Math.floor(fy / scale)), "U");
  }
  const pad = String((rows - 1) * scale).length + 1;
  const out = ruler(cols, scale, pad);
  for (let r = 0; r < rows; r++) {
    let line = String(r * scale).padStart(pad - 1) + " ";
    for (let c = 0; c < cols; c++) {
      const m = mark.get(key(c, r));
      if (m) {
        line += m;
        continue;
      }
      const counts = new Map<number, number>();
      for (let dy = 0; dy < scale; dy++)
        for (let dx = 0; dx < scale; dx++) {
          const fx = c * scale + dx;
          const fy = r * scale + dy;
          if (fx >= w.width || fy >= w.height) continue;
          const [tx, ty] = fr.worldTile(fx, fy);
          const t = w.terrain[ty * w.width + tx]!;
          counts.set(t, (counts.get(t) ?? 0) + 1);
        }
      let best = Terrain.Ground as number;
      let bestN = -1;
      for (const [t, n] of counts) if (n > bestN) [best, bestN] = [t, n];
      if (counts.has(Terrain.Crystal)) best = Terrain.Crystal;
      else if (counts.has(Terrain.Scrap)) best = Terrain.Scrap;
      line += TERRAIN_CHARS[best] ?? "?";
    }
    out.push(line);
  }
  return { text: out.join("\n"), scale };
}

/**
 * A close-up of the tiles within `r` of (x, y) in `side`'s frame: explored
 * terrain ("?" where it has never looked), its own buildings and units, the
 * enemy buildings it remembers and the enemy units it can see now, listed
 * underneath with ids.
 */
export function look(w: World, side: Faction, x: number, y: number, r = 6): string {
  const fr = frameOf(w, side);
  r = Math.max(2, Math.min(12, Math.round(r) || 6));
  const cx = Math.max(0, Math.min(w.width - 1, Math.round(x)));
  const cy = Math.max(0, Math.min(w.height - 1, Math.round(y)));
  const x0 = Math.max(0, cx - r);
  const x1 = Math.min(w.width - 1, cx + r);
  const y0 = Math.max(0, cy - r);
  const y1 = Math.min(w.height - 1, cy + r);
  const grid: string[][] = [];
  for (let fy = y0; fy <= y1; fy++) {
    const row: string[] = [];
    for (let fx = x0; fx <= x1; fx++) {
      const [tx, ty] = fr.worldTile(fx, fy);
      row.push(isExplored(w, side, tx, ty) ? TERRAIN_CHARS[w.terrain[ty * w.width + tx]!] ?? "?" : "?");
    }
    grid.push(row);
  }
  const put = (fx: number, fy: number, ch: string) => {
    if (fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1) grid[fy - y0]![fx - x0] = ch;
  };
  const listed: string[] = [];
  const inPatch = (fx: number, fy: number) => fx >= x0 && fx <= x1 && fy >= y0 && fy <= y1;
  for (const l of w.objectives.uplinks) {
    const [fx, fy] = fr.tile(l.x, l.y);
    if (!inPatch(fx, fy)) continue;
    put(fx, fy, "U");
    listed.push(`U uplink #${l.id} ${fx},${fy} ${l.owner === side ? "ours" : l.owner ? "theirs" : "neutral"}`);
  }
  for (const c of w.objectives.crates) {
    const [fx, fy] = fr.tile(c.x, c.y);
    if (!inPatch(fx, fy)) continue;
    put(fx, fy, "c");
    listed.push(`c crate #${c.id} ${fx},${fy} ${CRATE_NAMES[c.reward]}`);
  }
  for (const b of w.buildings.values()) {
    if (b.faction !== side) continue;
    const size = BUILDINGS[b.kind].size;
    const [fx, fy] = fr.topLeft(b.kind, b.tx, b.ty);
    let any = false;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (inPatch(fx + dx, fy + dy)) (put(fx + dx, fy + dy, "B"), (any = true));
    if (any) listed.push(`B your ${b.kind} #${b.id} ${fx},${fy} (${size}x${size}) ${pct(b.hp, BUILDINGS[b.kind].hp)}%`);
  }
  for (const kb of knownBuildings(w, side)) {
    const size = BUILDINGS[kb.kind].size;
    const [fx, fy] = fr.topLeft(kb.kind, kb.tx, kb.ty);
    let any = false;
    for (let dy = 0; dy < size; dy++) for (let dx = 0; dx < size; dx++) if (inPatch(fx + dx, fy + dy)) (put(fx + dx, fy + dy, "E"), (any = true));
    if (any) listed.push(`E enemy ${kb.kind} #${kb.id} ${fx},${fy} (${size}x${size}, as last seen)`);
  }
  for (const u of w.units.values()) {
    if (u.faction !== side) continue;
    const [fx, fy] = fr.tile(u.x, u.y);
    if (!inPatch(fx, fy)) continue;
    put(fx, fy, UNITS[u.kind].domain === "air" ? "a" : "o");
    listed.push(`${UNITS[u.kind].domain === "air" ? "a" : "o"} your ${u.kind} #${u.id} ${fx},${fy} ${pct(u.hp, UNITS[u.kind].hp)}%`);
  }
  for (const u of seenEnemies(w, side)) {
    const [fx, fy] = fr.tile(u.x, u.y);
    if (!inPatch(fx, fy)) continue;
    put(fx, fy, UNITS[u.kind].domain === "air" ? "v" : "x");
    listed.push(`${UNITS[u.kind].domain === "air" ? "v" : "x"} enemy ${u.kind} #${u.id} ${fx},${fy} ${pct(u.hp, UNITS[u.kind].hp)}%`);
  }
  const pad = String(y1).length + 1;
  const out = [`LOOK around ${cx},${cy} (x ${x0}-${x1}, y ${y0}-${y1})`];
  let tens = "";
  let units = "";
  for (let fx = x0; fx <= x1; fx++) {
    if (fx % 10 === 0 && tens.length <= fx - x0) tens = tens.padEnd(fx - x0) + String(fx);
    units += String(fx % 10);
  }
  out.push(" ".repeat(pad) + tens, " ".repeat(pad) + units);
  grid.forEach((row, i) => out.push(String(y0 + i).padStart(pad - 1) + " " + row.join("")));
  out.push("Legend: B your building, E enemy building, o/a your ground/air unit, x/v enemy ground/air unit, U uplink, c crate, ? unexplored; terrain as in the briefing");
  out.push(...listed);
  return out.join("\n");
}

// ---------------------------------------------------------------- briefing ---

const yes = (v: unknown) => (v ? "yes" : "");

/** The unit and building tables, generated from balance.ts. */
export function unitTable(): string {
  const head = "unit | cost | hp | speed | sight | range | dps | hits | armor | damage | built at | needs | notes";
  const rows = (Object.keys(UNITS) as UnitKind[]).map((k) => {
    const u = UNITS[k];
    const notes = [
      u.hover ? "hover: crosses water" : "",
      u.squad ? `infantry squad of ${u.squad}` : "",
      u.capacity ? `carries ${u.capacity} squads` : "",
      u.heal ? `heals ${u.heal} hp/s` : "",
      u.splash ? `splash ${u.splash}` : "",
      u.minRange ? `min range ${u.minRange}` : "",
      u.airMult && u.airMult !== 1 ? `×${u.airMult} vs air` : "",
      u.role
    ].filter(Boolean).join("; ");
    return [k, u.cost, u.hp, u.speed, u.sight, k === "goliath" ? "see weapons" : u.range || "-", k === "goliath" ? "see weapons" : u.dps || "-", u.targets, u.armor, k === "goliath" ? "see weapons" : u.dps ? u.dmgType ?? "kinetic" : "-", u.builtAt, u.requires ?? "-", notes].join(" | ");
  });
  return [head, ...rows].join("\n");
}

export function buildingTable(): string {
  const head = "building | cost | hp | size | build time (s) | needs | weapon | notes";
  const rows = (Object.keys(BUILDINGS) as BuildingKind[]).map((k) => {
    const b = BUILDINGS[k];
    const weapon = b.dps ? `${b.dps} dps vs ${b.targets}, range ${b.range}` : "-";
    return [k, b.cost || "-", b.hp, `${b.size}x${b.size}`, b.buildTime || "-", b.requires?.join(" or ") ?? "-", weapon, `${yes(b.dropOff) ? "harvesters unload here; " : ""}${b.role}`].join(" | ");
  });
  return [head, ...rows].join("\n");
}

export function damageTable(): string {
  return [
    "damage type vs armor: light / medium / heavy / structure / infantry",
    ...Object.entries(DAMAGE_VS).map(([t, r]) => `  ${t}: ${r.light} / ${r.medium} / ${r.heavy} / ${r.structure} / ${r.infantry}`)
  ].join("\n");
}

export interface BriefingOptions {
  roundTicks: number;
  maxTicks: number;
}

/**
 * The briefing (called once; it never changes, so it sits in the cached part
 * of a model's prompt): the side, the rules in brief, the order reference,
 * the opener cards, the unit/building/damage tables and the map.
 */
export function briefing(w: World, side: Faction, opts: BriefingOptions): string {
  const fr = frameOf(w, side);
  const def = mapById(w.mapId);
  const hq = hqOf(w, side);
  const enemyHq = hqOf(w, enemyOf(side));
  const hqPosition = hq ? `Your HQ is in the lower left at ${fr.topLeft("hq", hq.tx, hq.ty).join(",")} (its top-left tile; the HQ is 3x3).` : "You have no HQ; your units' current positions are in the observation.";
  const enemyHqPosition = enemyHq ? `The enemy HQ is in the upper right at ${fr.topLeft("hq", enemyHq.tx, enemyHq.ty).join(",")}.` : "The enemy has no HQ.";
  const map = asciiMap(w, side);
  const rules = rulesOf(w);
  const noOpeners = allowedOpener(w, side, "industry") === null;
  const roundSecs = opts.roundTicks / TICK_RATE;
  const lastRound = Math.ceil(opts.maxTicks / opts.roundTicks);
  const L = [
    `BATTLE DRONES: briefing for the ${side.toUpperCase()} commander`,
    ``,
    `You command one side of a 1v1 real-time strategy battle on ${def.name} (${w.width}x${w.height} tiles, ${w.biome}).`,
    `Win by destroying the enemy HQ and all of its Goliaths. A side without an HQ loses when its last Goliath is destroyed. If neither side wins by ${clock(opts.maxTicks)} of game time (round ${lastRound}) the battle is a draw.`,
    rules.mutators.length ? `Mutators in play: ${rules.mutators.join(", ")}.` : "",
    ``,
    `COORDINATES. Everything you see and every order you give uses your own coordinates: x runs west to east (0 to ${w.width - 1}), y runs north to south (0 to ${w.height - 1}), one unit per tile. ${hqPosition} ${enemyHqPosition} The map is point-symmetric, so the enemy's start is yours turned 180 degrees about the centre. A building's position is its top-left tile; units are at the tile they stand on.`,
    ``,
    `TIME. The game runs at ${TICK_RATE} ticks a second and stops every ${roundSecs} s (a round). Each round both commanders see the same moment and give orders without seeing each other's; then both sides' orders apply at once and the next ${roundSecs} s play out. Units keep following their last orders between rounds: idle units shoot back at anything that shoots them, attack-moving units fight whatever they meet, harvesters keep mining on their own.`,
    ``,
    `FOG OF WAR. You see only what your units and buildings see. Enemy units are listed only while in sight (a Sniper Team hiding in woods stays hidden until something gets within 3 tiles or it fires). Enemy buildings are remembered where you last saw them. You never see the enemy's scrap, queues or orders.`,
    ``,
    `RULES IN BRIEF`,
    `- Economy: harvesters (${UNITS.harvester.cost}) mine scrap ($) and richer crystal (*) fields and haul it to your HQ, a depot, or an anchored Goliath (${ECONOMY.harvesterCapacity} per trip). ${hq ? `Your HQ also trickles ${rules.hqTrickle ?? ECONOMY.hqTrickle} scrap/s.` : "Without an HQ there is no HQ scrap trickle."} Each anchored Goliath trickles ${GOLIATH.trickle} scrap/s. Fields run dry; build a depot near a distant field.`,
    `- Construction: one building at a time. It costs its price when you start it and takes its build time; when it's ready the arena places it for you: at the "at" tile you gave or, without one, a sensible spot near your base. New buildings must be within ${ECONOMY.buildRadius} tiles of one of your non-outpost buildings, or within ${GOLIATH.buildRing} tiles of an anchored Goliath, on ground (.) or road (=). Buildings outside regular base range use a Goliath's ring and become outposts, which do not extend build range. Selling refunds ${ECONOMY.sellRefund * 100}% of the cost, scaled by health.`,
    `- Production: each building queues up to ${ECONOMY.maxQueue} units, paid when queued; new units roll out next to it, then go to its rally point if it has one (attack-moving there).`,
    `- Combat: units auto-fire at enemies in range. Damage depends on damage type vs armor (table below); woods give ground units cover. Units gain veterancy ranks (★1-★3, +${15}% damage each) from kills. Destroyed combat units leave wrecks worth 30% of their cost for the first ground unit (either side) that drives over them.`,
    w.objectives.uplinks.length
      ? `- Uplinks (U on the map): stand units in the 2.5-tile zone to capture one (vehicles count 1, aircraft 0.5, infantry squads 2; harvesters 0; about 7 s from neutral with 4 units; the bar freezes while both sides are inside). Each one you hold pays ${OBJECTIVES.uplink.income} scrap/s, charges your calldown meter and lights up the fog around it.${w.objectives.uplinks.some((l) => l.infantryOnly) ? " Island Uplinks count only infantry and pay only while your infantry stand in them: fly squads there by Condor." : ""}`
      : "",
    w.objectives.dropSites.length
      ? `- Supply drops: from 1:30, every 75 s a pair of crates (one each side of the map, same reward) is announced 10 s before it lands. The first non-harvester unit to touch one claims it: scrap, veteran ranks, a field repair, calldown charge or a free Lancer.`
      : "",
    `- Calldowns: a charge meter (0-${POWERS.meterMax}) fills slowly, from Uplinks and mostly from your own losses. Barrage (${POWERS.barrage.cost}: three heavy shells, radius ${POWERS.barrage.radius}), EMP (${POWERS.emp.cost}: stuns everything in radius ${POWERS.emp.radius} for ${POWERS.emp.stun} s), Drop Pod (${POWERS.droppod.cost}: 2 Stingers and a Flak Crawler, or 2 Lancers and a Flak with a Tech Lab, onto ground you can see), and the Sky Hammer (free, online at ${clock(POWERS.hammer.unlock * TICK_RATE)} then every ${POWERS.hammer.cooldown} s: a huge strike, radius ${POWERS.hammer.radius}). Each has a cooldown. Every calldown is telegraphed to both sides before it lands, so move out of enemy strike circles.`,
    `- Infantry (Trooper, Rocket and Sniper squads from the Assembly Bay) fight best in woods. A Condor (Airpad) carries 2 squads anywhere: "board" then "unload". Mastodons crush infantry they drive over.`,
    `- Aircraft fly over everything. Only units and buildings whose "hits" column says air or both can shoot them.`,
    `- Goliaths: giant mechs visible to both sides even through fog. Walking and anchored Goliaths fight with four weapons: mortars, eye laser, arm cannons, and machine guns. Damage disables the mortars below 75% HP, laser below 50%, and cannons below 25%; Mender repairs restore them above those thresholds plus ${GOLIATH.restoreMargin * 100}%, after a ${GOLIATH.reboot}s reboot. The next Goliath costs its list price plus ${GOLIATH.costStep * 100}% of that price for each one you own or have queued.`,
    `- Anchor / pack up: "anchor" takes ${GOLIATH.anchorTime}s on a clear ${GOLIATH.footprint}x${GOLIATH.footprint} ground footprint; an anchored Goliath cannot move, but receives harvested scrap, trains infantry${goliathBase(w) ? " and harvesters" : ""}, and provides a build ring. Use its id as "at" for produce/cancel and as the rally id. "pack_up" takes ${GOLIATH.packTime}s before it can walk or be lifted again; its training queue pauses until anchored again.`,
    `- Goliath transport: two empty Condors can "lift" a walking Goliath. Address "move", "attack_move", "stop", or "unload" to the Goliath or either carrier to control the whole lift. "unload" lands it at "at" (or its current position), using nearby walkable ground if necessary. While airborne it is an air target and only its machine guns fire. If a carrier dies it drops: ${GOLIATH.lift.dropDamage * 100}% max-HP damage on land, destroyed over impassable terrain or sea.`,
    ``,
    `TOOLS. observe() shows your state each round (the arena also hands it to you at the start of each round). look(x, y, r) shows a close-up map. orders([...]) gives orders; each comes back "ok" or with the reason it was refused. end_round(notes, radio) ends your turn: notes (up to 2000 characters) are your memory and come back to you next round; radio (up to 120 characters) is heard by spectators only, never by the enemy. wait(rounds) ends your turn and skips the next rounds-1 rounds unless something urgent happens (your HQ attacked, an enemy strike called, enemies near your base).`,
    ``,
    `ORDERS (a list of these objects). Unit lists hold unit ids ("#97", as the observation shows them) or selector strings; tiles are [x, y] and go in "to" or "at".`,
    `  {"move": ["#97", "#83"], "to": [30, 25]}     move units to a tile, ignoring enemies on the way`,
    `  {"attack_move": "army", "to": [30, 25]}      move, fighting everything met on the way`,
    `  {"attack": ["#97", "#83"], "target": "#23"}  attack an enemy unit in sight or a known enemy building`,
    `  {"stop": ["#97"]}                            stop and stand (still shooting back)`,
    `  {"harvest": ["#3", "#14"], "at": [14, 43]}   harvesters mine a field ("at" optional: the nearest)`,
    `  {"produce": "stinger", "count": 2}           queue units at an eligible producer ("at": "#10" to choose a building or Goliath)`,
    `  {"cancel": "stinger", "at": "#10"}           take the last stinger off producer #10's queue (refunded)`,
    `  {"build": "turret", "at": [9, 42]}           start a building; "at" (its top-left tile) optional`,
    `  {"cancel": "building"}                       cancel the building under construction (refunded)`,
    `  {"sell": "#72"}                              sell a building`,
    `  {"rally": "#10", "to": [12, 40]}             where building or Goliath #10's new units go`,
    `  {"calldown": "barrage", "at": [44, 9]}       barrage, emp, droppod or hammer`,
    `  {"board": ["#91", "#133"], "condor": "#103"} infantry squads climb into a Condor`,
    `  {"unload": ["#103"], "at": [11, 11]}         land a carried Goliath or drop a Condor's infantry ("at" optional)`,
    `  {"anchor": ["#97"]}                         anchor a grounded Goliath`,
    `  {"pack_up": ["#97"]}                        pack up an anchored Goliath`,
    `  {"lift": ["#103", "#104"], "goliath": "#97"} two empty Condors lift a walking Goliath`,
    `Selector strings: "army" (every combat unit), "all", "stinger" (all stingers), "idle army", "idle stinger", "army near 30,25" (within 6 tiles); they can be mixed with ids: ["#97", "wasp"]. A "to" may also be "enemy-hq" or an id like "#23" (that unit or building's position). Ids of units that have died stop working: use the ids in this round's observation.`,
    ``,
    noOpeners ? `OPENERS. Disabled by this match's mutators. In round 0 call end_round with your plan; unit orders begin in round 1.` : `OPENERS. Before the first round each side picks one opener card (both picks are revealed together). Choose with orders([{"opener": "blitz"}]) then end_round.`,
    ...(noOpeners ? [] : OPENER_IDS.map((id) => {
      const o = OPENERS[id];
      return `  ${id}: ${o.name}. ${o.tagline} A ${o.building}${o.units.length ? ` and ${o.units.length} ${o.units[0]}s` : ""}, ${o.harvesters} harvesters in all, ${o.scrap >= 0 ? "+" : ""}${o.scrap} scrap.`;
    })),
    rules.armada ? `GOLIATH ARMADA. Each side starts with four airborne Goliaths carried by eight Condors, ${ECONOMY.startingScrap} scrap, no HQ, no harvesters, and no infantry. Land and anchor Goliaths to train harvesters and infantry and construct outposts. Regular openers are disabled.` : goliathBase(w) ? `Your anchored Goliath replaces your HQ and can also train harvesters. Starting units and scrap are shown in the observation.` : `Everyone also starts with an HQ, ${ECONOMY.startingScrap} scrap and a Trooper Squad${def.startUnits?.length ? `, plus ${def.startUnits.join(", ")}` : ""}.`,
    ``,
    `UNITS`,
    unitTable(),
    ``,
    `GOLIATH WEAPONS (only machine guns fire while airborne)`,
    `weapon | range | min range | dps | hits | damage | multiplier vs air | disabled below HP`,
    ...GOLIATH_WEAPONS.map((k) => {
      const s = GOLIATH.weapons[k];
      return [s.name, s.range, s.minRange ?? 0, s.dps, s.targets, s.dmgType, s.targets === "ground" ? "-" : s.airMult ?? 1, s.lostBelow ? `${s.lostBelow * 100}%` : "never"].join(" | ");
    }),
    ``,
    `BUILDINGS`,
    buildingTable(),
    ``,
    damageTable(),
    ``,
    `MAP at the start, in your coordinates${map.scale > 1 ? ` (half size: each character is 2x2 tiles; the rulers give tile coordinates)` : ""}. @ your HQ, & enemy HQ, U uplink.`,
    TERRAIN_LEGEND,
    "Ground units can't cross rock, water or open sea; hover units (Lancer) cross water; aircraft fly anywhere.",
    map.text
  ];
  return L.filter((l, i) => l !== "" || L[i - 1] !== "").join("\n");
}
