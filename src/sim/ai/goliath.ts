import { BUILDINGS, ECONOMY, GOLIATH, TERRAIN, TICK_RATE, UNITS } from "../balance";
import { engageable } from "../combat";
import { canPlaceBuilding } from "../economy";
import { isVisible, knownBuildings, type KnownBuilding } from "../fog";
import {
  anchorBlockedAt,
  anchorBlocker,
  canWalk,
  distToFootprint,
  goliathCost,
  goliathsOf,
  isAnchored,
  isLifted,
  readyFirepower,
  weaponsDown
} from "../goliath";
import { isInfantry } from "../infantry";
import { canCarry } from "../lift";
import { findPath } from "../movement";
import { blocksObjective, uplinkPay } from "../objectives";
import { bannedBy, goliathBase, rulesOf } from "../rules";
import { isLoaded } from "../transport";
import { Terrain, type Building, type BuildingKind, type Command, type Faction, type QueueItem, type Unit, type UnitKind, type World } from "../types";
import {
  canGetWithin,
  dist,
  domainOf,
  inBounds,
  isResource,
  moveClassOf,
  nearestDropSite,
  passable,
  regionAt,
  sideFrame,
  terrainAt,
  tileIndex
} from "../world";
import { airliftBusy } from "./airlift";
import type { AiMode, AiState, Difficulty, StrategyName } from "./commander";
import { dropCondorId, inMap, route } from "./condor";
import { FFA_TACTICS, ffaTactic } from "./ffa";
import { AA_COVER, USELESS, aaSources, aaStrengthAt, aaWeight, effectivenessVs, type Sighting } from "./intel";
import { cos, sin } from "../fmath";

/**
 * The commander's Goliaths (GOLIATH.md), and its answer to the enemy's.
 *
 * - THE GANTRY comes late and only when the side can afford it: from a
 *   personality's hour (Ironclad and Boom keenest, Rush and the air forces
 *   last, Easy never), with the income and an army to show for it, never
 *   while the base is under attack. The prerequisites it lacks are built
 *   first (commander.ts nextBuilding). Then a share of each pass's income is
 *   set aside for the next Goliath (never all of it: the army keeps being
 *   built), at the escalating price, one at a time and only a couple a match.
 * - SITES: a Goliath digs in at a rich field no drop-off serves (out of
 *   reach of the enemy's known guns), at an island relay on the island maps
 *   (two Condors fly it there: it trains the squads that crew the relay), or
 *   at a forward post toward the enemy when nothing pays better. Anchored,
 *   it is the drop-off for the harvesters sent to work its field, trains
 *   squads to stand by it and gets OUTPOSTS in its ring (a Depot that serves
 *   the field after it leaves, a Turret, a SAM site). It packs up and moves
 *   on when the field runs dry, and backs off when it is losing a fight.
 * - ESCORTS: idle army with some anti-air walks with it and stands guard at
 *   its site; Menders (ai/menders.ts) favour it when a weapon is down.
 * - LIFTS: where it can't walk (an island, or far round by ground), two
 *   Condors (none of them on a drop or an airlift trip) hook on once a route
 *   clear of anti-air is there, and fly it; anti-air turning up on the way
 *   sends it round by a flank or back where it came from, and a hurt Condor
 *   sets it down on the nearest land at once. The Condor planners never
 *   touch a Condor on a lift (liftCondors).
 * - SIEGE: Rush and Ironclad Goliaths fall in with a wave going by their
 *   post and walk a few tiles behind its lead — never alone into the
 *   enemy's base.
 * - THE PUSH (a free-for-all, ai/ffa.ts): from 12:00 the Goliaths walking
 *   with the waves march on the focus rival's base, the army gathered on
 *   the lead one, once together they outgun what holds it (planPush).
 * - HUNTS: enemy Goliaths are always in sight; idle units that can hurt one
 *   strike it when they outweigh what it can still fire (its Menders first,
 *   and sooner while a weapon is down), and anti-air goes for a Condor
 *   carrying one. An enemy Gantry building one is a wave's first target
 *   (commander.ts pickPriorityTarget).
 *
 * After the HQ falls (and under Nomads, which starts that way) a Goliath is
 * the base: it digs in, builds Harvesters (Nomads) and trains squads, takes
 * the harvesters' scrap, buildings go up in its ring, and it moves the base
 * on to a fresh field when its own runs dry or the ring is full. Under Robot
 * Love its Goliaths keep clear of the enemy's (a meeting is a draw), unless
 * it is plainly losing.
 */

export const GOLIATH_AI = {
  /** Seconds into a match from which each personality considers a Gantry (Infinity: never). */
  gantryFrom: { balanced: 300, rush: 480, airswarm: 420, boom: 240, skyforce: 450, ironclad: 210 } as Record<StrategyName, number>,
  /** That hour, scaled by difficulty (Easy never builds one: a first-week player meets no Goliath). */
  gantryPace: { easy: Infinity, normal: 1, hard: 0.85 } as Record<Difficulty, number>,
  /** …and this much sooner (share of it) once an enemy Gantry is known. */
  answerGantry: 0.75,
  /** Income (scrap a minute, harvest + salvage + objectives) a side needs before it starts a Gantry… */
  gantryIncome: 900,
  /**
   * …or this much scrap floating in the bank. (At 900, sides on the
   * Archipelago's lean income put up Gantries 58 times in 30 round-robin
   * matches for 25 Goliaths: a Gantry with no Goliath to follow is 600 thrown away.)
   */
  gantryBank: 2000,
  /** No Gantry or Goliath while the army is worth less than this (scrap): the army comes first. */
  armyFloor: 900,
  /** A Gantry that found no room (or was lost) is not started again for this long (s)… */
  gantryRetry: 90,
  /** …and after this many are lost, not at all. */
  gantries: 2,
  /**
   * Field scrap (crystal at its worth) that must be left on our side of the map
   * for a Gantry: a mobile base pays only with fields to work. (The Proving
   * Grounds hold ~13k a side by 4:00 and run dry by 9:00: Goliaths there only
   * dragged short matches into 25-minute stalls; the bigger maps hold 25–70k.)
   */
  gantryFields: 15000,
  /** Goliaths alive or on the cradle, at most. */
  max: { easy: 1, normal: 2, hard: 2 } as Record<Difficulty, number>,
  /**
   * …and one on the island maps, where the war is squads, Condors and air over
   * the islands and a slow walk by the bridges (with two, the Archipelago's
   * lean economy stalled: island matches ran the full 25 minutes undecided).
   */
  islandMax: 1,
  /** Seconds between ordering one Goliath and the next. */
  again: 150,
  /** Share of income set aside for the next Goliath while one is wanted (the rest keeps the army coming). */
  save: { balanced: 0.45, rush: 0.35, airswarm: 0.35, boom: 0.5, skyforce: 0.35, ironclad: 0.55 } as Record<StrategyName, number>,

  /** A field within this many tiles of one of our drop-offs is served already. */
  siteServed: 8,
  /** Scrap a field must hold (crystal at its worth) to be worth a Goliath's walk. */
  siteMin: 2200,
  /** Fields this close to the enemy HQ are theirs. */
  enemyHome: 16,
  /** Known enemy buildings this close to a field make it theirs. */
  enemyNear: 7,
  /** A site within a known enemy defence's range plus this is under its guns. */
  defenceGap: 3,
  /** Pack up and move on once the field in reach holds less than this. */
  leaveBelow: 500,
  /** Tiles from the field a site may lie. */
  siteReach: 4.5,
  /** Island relays: a site this far from the relay at least (off its platform and its capture ring)… */
  relayMin: 3.5,
  /** …and at most. */
  relayMax: 5.5,
  /** Island relays are worth this many seconds of their pay. */
  relayWorth: 600,
  /** A forward post (no field worth it) is worth this much, this share of the way to the enemy HQ. */
  frontValue: 1500,
  frontShare: 0.4,
  /** Personalities that dig in at a forward post when no field pays (the rest guard home). */
  front: { balanced: true, rush: true, airswarm: false, boom: false, skyforce: false, ironclad: true } as Record<StrategyName, boolean>,
  /** Personalities whose Goliaths walk with an assault. */
  siege: { balanced: false, rush: true, airswarm: false, boom: false, skyforce: false, ironclad: true } as Record<StrategyName, boolean>,
  /** With no HQ, the base Goliath moves on once the field within this many tiles runs dry… */
  baseField: 9,
  /** …to a field no farther than this (tiles): it is the base, and it is slow. */
  baseMove: 36,
  /** Robot Love: our Goliaths keep this far (tiles) from the enemy's (GOLIATH.love.range is a draw)… */
  loveGap: 9,
  /** …unless what we field is under this share of what we see of theirs, the base in trouble: a draw beats a loss. */
  loveLosing: 0.5,
  /** Seconds between a held site's re-checks (is a better one worth the pack-up?). */
  recheck: 20,
  /** A better site must score this many times the current one to move. */
  better: 2,
  /** Sites given up on (no way there, no room, taken) are left alone this long (s). */
  avoid: 120,

  /** Harvesters sent to work an anchored Goliath's field (more are built for it). */
  harvesters: { balanced: 2, rush: 2, airswarm: 2, boom: 3, skyforce: 2, ironclad: 2 } as Record<StrategyName, number>,
  /** Outposts a Goliath puts up in its ring at a field, in order (Depot only for a rich field). */
  outposts: {
    balanced: ["depot", "turret", "sam-site"],
    rush: ["turret", "depot"],
    airswarm: ["depot", "sam-site"],
    boom: ["depot", "turret", "sam-site"],
    skyforce: ["sam-site", "depot"],
    ironclad: ["turret", "depot", "sam-site"]
  } as Record<StrategyName, BuildingKind[]>,
  /** A field must still hold this much for an outpost Depot (it serves the field after the Goliath moves on). */
  depotMin: 3000,
  /** A SAM site only once this much enemy air has been seen (Flak-weighted ai/commander seenAir). */
  samAir: 2,
  /** Seconds between outposts… */
  outpostEvery: 20,
  /** …and past the first at a site, only on this much income (scrap a minute): a dry economy builds an army first. */
  outpostIncome: 600,
  /** Sites keep this far (tiles) from an enemy Goliath (beyond its mortars' reach, 8). */
  goliathGap: 11,
  /** Squads an anchored Goliath trains to stand by it (more at an island relay, more still with no HQ). */
  garrison: 2,
  relayGarrison: 3,
  lastGarrison: 4,

  /** Menders the Airpads add for our Goliaths, at most (one with any; three for each hurt one). */
  menders: 4,
  /** Escort value (share of its list price) of idle army that walks with it… */
  escort: 0.35,
  /** …recruited from within this many tiles… */
  escortReach: 24,
  /** …standing this far from it (off its footprint and the harvesters' dock). */
  post: 3.2,
  /** Walking below this share of its HP (or with its arm cannons down): back to Menders and home… */
  retreatHp: 0.35,
  /** …until it is back up to this share. */
  resumeHp: 0.7,
  /** Walking with a wave it falls back below this share (its laser gone: the walk home is under fire). */
  siegeRetreat: 0.5,
  /** With a wave it keeps this many tiles behind the wave's lead… */
  behind: 3,
  /** …and falls in with one whose lead passes within this many tiles of it. */
  join: 16,
  /** From this many minutes in, a Goliath with nothing better to hold (a forward post) joins any assault. */
  lateSiege: 12,
  /** Visible enemy firepower within `danger` tiles over this many times what holds the site (and it hurt): pack up and go. */
  loseEdge: 1.5,
  danger: 9,
  /** Walking with a wave: own army worth this much within 8 tiles, or it holds back… */
  company: 450,
  /** …once within this many tiles of the enemy HQ. */
  deep: 18,

  /**
   * A free-for-all's push (planPush), from `lateSiege`: our Goliaths walking with the waves
   * and the army march on the focus's base once they outgun what holds it (its firepower
   * in sight and its known armed buildings within `danger` tiles) this many times over…
   * (Four Normal AIs under the Armada, 11 seeds of two lineups: with it from 12:00 every game
   * was decided by 35:00, in 18–21 min on average, against 3 without it; from 0:00 it decided
   * them in the 3:00–9:00 brawl instead, mostly for Ironclad and Rush, whose spare Goliath
   * walks from the start.)
   */
  pushEdge: 1.5,
  /** …less this much each minute after `lateSiege` (a stalemate wears the edge thin)… */
  pushDecay: 0.025,
  /** …down to this… */
  pushFloor: 1.05,
  /** …and once on its way, it marches on while they outgun it this many times over (or by the edge, once that is lower: from 28:00). */
  pushHold: 1.1,
  /** The waves go, at the push's target, once the lead Goliath is this close to it (tiles). */
  pushNear: 12,

  /** A walk this many times the straight line (and `liftGain` tiles longer) is a lift if two Condors are free. */
  liftDetour: 1.8,
  liftGain: 20,
  /** Seconds a lift waits for its two Condors (or a clear sky) before the site is given up. */
  liftWait: 90,
  /** A Condor that loses this share of its HP on the way sets the Goliath down on the nearest land. */
  liftAbort: 0.25,
  /** Anti-air (Flak-weighted) on a lift's route above this calls it off: a downed Condor drops the Goliath. */
  liftAa: 0.2,
  /** A lift given up on isn't tried again for this long (s). */
  liftRetry: 150,
  /** Seconds the Condors have to hook on before the lift is called off. */
  liftHook: 30,

  /** An enemy Goliath counts as this many heavy units (Rocket Squads, Lancers, Hornets answer it). */
  heavyWeight: 3,
  /** A Goliath on an enemy Gantry pre-arms the counters as this many heavy units. */
  gantryWeight: 2,
  /** Strike an enemy Goliath with this many times what it can still do (its firepower and health, plus its escort)… */
  huntEdge: 1.3,
  /** …and at least this much… */
  huntMin: 700,
  /** …from units within this many tiles… */
  huntReach: 32,
  /** …this much less when a weapon of it is down (strike while it's weak)… */
  huntWeak: 0.8,
  /** …no more often than this (s) per Goliath; units that can hit them go for its Menders first, this many each. */
  huntEvery: 12,
  medicHunters: 2
};

type P = { x: number; y: number };
type Phase = "muster" | "march" | "lift" | "dig" | "hold" | "pack" | "siege" | "retreat" | "guard";

interface Site {
  kind: "field" | "relay" | "front";
  /** Where it digs in: a tile centre with open ground all round it. */
  at: P;
  /** The field it works (its centre), for a field site. */
  field: P | null;
  value: number;
  score: number;
  /** Over water (or the long way round by ground): two Condors fly it. */
  lift: boolean;
  relayId?: number;
}

interface Plan {
  phase: Phase;
  since: number;
  site: Site | null;
  /** Where it goes after packing up. */
  next: Phase;
  escorts: number[];
  harvesters: number[];
  /** Outposts started at the site it holds now (each kind once a stay). */
  outposts: BuildingKind[];
  /** Condors held for its lift, their HP at take-off, a flank waypoint. */
  carriers: number[];
  launchHp: number[];
  waypoint: P | null;
  lifting: boolean;
  liftTick: number;
  /** Where the lift took off (a called-off lift flies back there), and where a called-off one comes down. */
  origin: P | null;
  landing: P | null;
  /** No lift is tried again before this tick (one just failed for want of Condors or a clear sky). */
  noLift: number;
  tries: number;
  /** Tick of the last move order, and of the last re-check of a held site. */
  moved: number;
  checked: number;
}

interface Memo {
  plans: Map<number, Plan>;
  /** Scrap set aside for the next Goliath. */
  fund: number;
  /** Our income tally (harvest, salvage, objectives) at the last pass, and a minute of samples. */
  tally: number | null;
  income: { tick: number; total: number }[];
  /** The HQ's centre while it stood: home, and the frame for everything after it falls. */
  home: P | null;
  /** An outpost under construction, and for whom. */
  outpost: { kind: BuildingKind; goliathId: number } | null;
  lastOutpost: number;
  lastOrder: number;
  gantryFail: number;
  /** A Gantry of ours stood at the last look, and how many have been lost. */
  gantryUp: boolean;
  gantriesLost: number;
  /** Tick a building last found no room (no HQ: the rings are full). */
  noRoom: number;
  /** Strikes on enemy Goliaths: when, and who went. */
  hunts: Map<number, { tick: number; ids: number[] }>;
  /** Field clusters, re-read every few seconds. */
  clusters: { tick: number; list: Cluster[] } | null;
  /** Sites given up on, until a tick. */
  avoid: (P & { until: number })[];
}

const memos = new WeakMap<AiState, Memo>();
function memo(s: AiState): Memo {
  let m = memos.get(s);
  if (!m) {
    m = {
      plans: new Map(), fund: 0, tally: null, income: [], home: null, outpost: null, lastOutpost: -1e9,
      lastOrder: -1e9, gantryFail: -1e9, gantryUp: false, gantriesLost: 0, noRoom: -1e9, hunts: new Map(), clusters: null, avoid: []
    };
    memos.set(s, m);
  }
  return m;
}

const value = (us: readonly Unit[]) => us.reduce((v, u) => v + UNITS[u.kind].cost, 0);
const byId = (a: { id: number }, b: { id: number }) => a.id - b.id;
const hpShare = (u: Unit) => u.hp / UNITS[u.kind].hp;
const kbCentre = (kb: KnownBuilding): P => ({ x: kb.tx + BUILDINGS[kb.kind].size / 2, y: kb.ty + BUILDINGS[kb.kind].size / 2 });

/**
 * What an enemy unit is worth as a threat right now: its price, except a
 * Goliath, which is worth its list price times what it can still fire and
 * how much of it is left.
 */
export function threatValue(u: Unit): number {
  if (!u.goliath) return UNITS[u.kind].cost;
  return UNITS.goliath.cost * (0.5 * readyFirepower(u) + 0.5 * hpShare(u));
}

// --- home: the HQ, or where it stood ------------------------------------

/** Note the HQ's centre while it stands (tickAi, every pass). */
export function noteHome(s: AiState, at: P): void {
  memo(s).home = { x: at.x, y: at.y };
}

/**
 * Home for a side with no HQ: where it stood (the frame stays the same),
 * else — never had one (Nomads) — where its first Goliath stood when first
 * asked (where the HQ would have been), else the map centre.
 */
export function lostHome(w: World, faction: Faction, s: AiState): P {
  const m = memo(s);
  if (m.home) return m.home;
  const g = goliathsOf(w, faction).sort(byId)[0];
  if (!g) return { x: w.width / 2, y: w.height / 2 };
  m.home = { x: g.x, y: g.y };
  return m.home;
}

// --- income and the Goliath fund ----------------------------------------

/** Our scrap income so far (harvest, salvage, Uplinks and crates: what a player sees in their own stats). */
function incomeTally(w: World, faction: Faction): number {
  const st = w.factions[faction].stats;
  const o = w.objectives.stats[faction];
  return st.scrapHarvested + st.scrapSalvaged + (o ? o.uplinkScrap + o.crateScrap : 0);
}

/** Scrap a minute over the last minute (from the samples goliathFund keeps). */
function incomeRate(m: Memo): number {
  const first = m.income[0];
  const last = m.income[m.income.length - 1];
  if (!first || !last || last.tick <= first.tick) return 0;
  return ((last.total - first.total) / (last.tick - first.tick)) * TICK_RATE * 60;
}

export interface FundContext {
  /** A Gantry stands (or is going up). */
  gantry: boolean;
  armyValue: number;
  threatened: boolean;
}

/**
 * One pass of the Goliath savings (call once per decision pass, before
 * production): a GOLIATH_AI.save share of the income since the last pass
 * goes into the fund while a Goliath is wanted (a Gantry, room for one more,
 * an army, no attack on the base). Returns the scrap to hold back from the
 * army this pass (never more than the bank).
 */
export function goliathFund(w: World, faction: Faction, s: AiState, ctx: FundContext): number {
  const m = memo(s);
  const total = incomeTally(w, faction);
  const gained = m.tally === null ? 0 : Math.max(0, total - m.tally);
  m.tally = total;
  m.income.push({ tick: w.tick, total });
  while (m.income.length > 2 && w.tick - m.income[0]!.tick > 60 * TICK_RATE) m.income.shift();
  const f = w.factions[faction];
  // nothing to save for (no Gantry, or room for no more), or the army comes first (the base
  // under attack, or too little army): nothing held back
  if (!ctx.gantry || !roomForGoliath(w, faction, s) || ctx.threatened || ctx.armyValue < GOLIATH_AI.armyFloor) {
    m.fund = Math.min(m.fund, f.scrap);
    return 0;
  }
  m.fund = Math.min(goliathCost(w, faction), m.fund + gained * GOLIATH_AI.save[s.strategy.name], f.scrap);
  return m.fund;
}

/** Room for another Goliath (alive and on the cradle under GOLIATH_AI.max)? */
function roomForGoliath(w: World, faction: Faction, s: AiState): boolean {
  let n = goliathsOf(w, faction).length;
  for (const b of w.buildings.values()) if (b.faction === faction) for (const q of b.queue) if (q.kind === "goliath") n++;
  return n < (w.rules?.islands ? GOLIATH_AI.islandMax : GOLIATH_AI.max[s.difficulty]);
}

/**
 * Should the Gantry start a Goliath now? Room for one more, a pause since the
 * last, an army, no attack on the base, and the scrap (`spendable`, the
 * fund included) for its escalating price.
 */
export function wantGoliath(w: World, faction: Faction, s: AiState, ctx: FundContext & { spendable: number }): boolean {
  const m = memo(s);
  if (w.survival || ctx.threatened || ctx.armyValue < GOLIATH_AI.armyFloor) return false;
  if (!roomForGoliath(w, faction, s) || w.tick - m.lastOrder < GOLIATH_AI.again * TICK_RATE) return false;
  // (another while one walks: only on an income that pays for it, not out of the last of the bank)
  if (goliathsOf(w, faction).length > 0 && incomeRate(m) < GOLIATH_AI.gantryIncome) return false;
  return ctx.spendable >= goliathCost(w, faction);
}

/** A Goliath was queued: the fund is spent. */
export function noteGoliathOrdered(w: World, s: AiState): void {
  const m = memo(s);
  m.fund = 0;
  m.lastOrder = w.tick;
}

/**
 * Is it time for a Gantry? Not on Easy, in Last Stand or an Op, nor under
 * rules that ban the Goliath; one per side; from the personality's hour
 * (sooner once the enemy has one); with the income (or the bank) and an
 * army to show for it; never with the base under attack. The prerequisites
 * it lacks are the commander's to build first.
 */
export function wantGantry(
  w: World,
  faction: Faction,
  s: AiState,
  ctx: { armyValue: number; threatened: boolean; home: P; enemyHome: P }
): boolean {
  if (w.survival || w.ops) return false;
  if (bannedBy(w, "gantry", faction) || bannedBy(w, "goliath", faction)) return false;
  const f = w.factions[faction];
  const m = memo(s);
  // one standing, or going up: nothing to do (one lost: not again at once, and not a third time)
  if ([...w.buildings.values()].some((b) => b.faction === faction && b.kind === "gantry")) {
    m.gantryUp = true;
    return false;
  }
  if (m.gantryUp) {
    m.gantryUp = false;
    m.gantriesLost++;
    m.gantryFail = w.tick;
  }
  if (f.pending?.kind === "gantry" || m.gantriesLost >= GOLIATH_AI.gantries) return false;
  if (w.tick - m.gantryFail < GOLIATH_AI.gantryRetry * TICK_RATE) return false;
  let from = GOLIATH_AI.gantryFrom[s.strategy.name] * GOLIATH_AI.gantryPace[s.difficulty];
  if (!Number.isFinite(from)) return false;
  if (knownBuildings(w, faction).some((kb) => kb.kind === "gantry")) from *= GOLIATH_AI.answerGantry;
  if (w.tick < from * TICK_RATE) return false;
  if (ctx.threatened || ctx.armyValue < GOLIATH_AI.armyFloor || !roomForGoliath(w, faction, s)) return false;
  // a mobile base pays only with fields left to work: not on a map already mined out
  // (the island maps' relays are what a Goliath goes for there)
  if (!w.rules?.islands && fieldsOurSide(w, faction, m, ctx.home, ctx.enemyHome) < GOLIATH_AI.gantryFields) return false;
  return incomeRate(m) >= GOLIATH_AI.gantryIncome || f.scrap >= GOLIATH_AI.gantryBank;
}

/** Scrap left (crystal at its worth) in the fields nearer our home than theirs. */
function fieldsOurSide(w: World, faction: Faction, m: Memo, home: P, enemyHome: P): number {
  let v = 0;
  for (const cl of fieldClusters(w, faction, m))
    if (dist(cl.c.x, cl.c.y, home.x, home.y) <= dist(cl.c.x, cl.c.y, enemyHome.x, enemyHome.y)) v += cl.value;
  return v;
}

/** A building found no room (no HQ: every ring is full): the base Goliath may move on (planGoliaths). */
export function noteNoRoom(w: World, s: AiState): void {
  memo(s).noRoom = w.tick;
}

/** The Gantry found no room: don't start another for a while. */
export function noteGantryFailed(w: World, s: AiState): void {
  memo(s).gantryFail = w.tick;
}

// --- fields --------------------------------------------------------------

interface Cluster {
  /** Tile indices, in the side's frame order. */
  tiles: number[];
  /** Scrap left (crystal at its worth). */
  value: number;
  /** Centre (world), and the same in the side's own frame (for ties). */
  c: P;
  key: P;
}

/**
 * The map's resource fields as clusters (tiles a gap of one tile apart join
 * up), found and summed in the side's own frame so red's are blue's mirror
 * image to the last bit.
 */
function fieldClusters(w: World, faction: Faction, m: Memo): Cluster[] {
  if (m.clusters && w.tick - m.clusters.tick < 5 * TICK_RATE) return m.clusters.list;
  const fr = sideFrame(w, faction);
  const W = w.width;
  const H = w.height;
  const seen = new Uint8Array(W * H);
  const idx = (fx: number, fy: number) => {
    const [tx, ty] = fr.tile(fx, fy, 1);
    return ty * W + tx;
  };
  const list: Cluster[] = [];
  for (let fy = 0; fy < H; fy++)
    for (let fx = 0; fx < W; fx++) {
      const i0 = idx(fx, fy);
      if (seen[i0] || !isResource(w, i0)) continue;
      seen[i0] = 1;
      const queue: [number, number][] = [[fx, fy]];
      const tiles: number[] = [];
      let v = 0;
      let sx = 0;
      let sy = 0;
      for (let q = 0; q < queue.length; q++) {
        const [cx, cy] = queue[q]!;
        const i = idx(cx, cy);
        tiles.push(i);
        const left = w.scrap[i]! * (w.terrain[i] === Terrain.Crystal ? ECONOMY.crystalValue : 1);
        v += left;
        sx += (cx + 0.5) * left;
        sy += (cy + 0.5) * left;
        for (let dy = -2; dy <= 2; dy++)
          for (let dx = -2; dx <= 2; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
            const ni = idx(nx, ny);
            if (seen[ni] || !isResource(w, ni)) continue;
            seen[ni] = 1;
            queue.push([nx, ny]);
          }
      }
      if (v <= 0) continue;
      const key = { x: sx / v, y: sy / v };
      list.push({ tiles, value: v, c: fr.toWorld(key), key });
    }
  m.clusters = { tick: w.tick, list };
  return list;
}

/** Scrap left in the field tiles within `r` of a point (crystal at its worth). */
function fieldLeft(w: World, p: P, r: number): number {
  let v = 0;
  const x0 = Math.max(0, Math.floor(p.x - r));
  const x1 = Math.min(w.width - 1, Math.floor(p.x + r));
  const y0 = Math.max(0, Math.floor(p.y - r));
  const y1 = Math.min(w.height - 1, Math.floor(p.y + r));
  for (let ty = y0; ty <= y1; ty++)
    for (let tx = x0; tx <= x1; tx++) {
      const i = ty * w.width + tx;
      if (isResource(w, i) && dist(tx + 0.5, ty + 0.5, p.x, p.y) <= r)
        v += w.scrap[i]! * (w.terrain[i] === Terrain.Crystal ? ECONOMY.crystalValue : 1);
    }
  return v;
}

/** The field tile nearest a point (a harvest order's target), or null. */
function nearestFieldTile(w: World, faction: Faction, p: P, r: number): P | null {
  const fr = sideFrame(w, faction);
  const q = fr.toFrame(p);
  let best: P | null = null;
  let bestD = Infinity;
  const R = Math.ceil(r);
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const fx = Math.floor(q.x) + dx;
      const fy = Math.floor(q.y) + dy;
      if (fx < 0 || fy < 0 || fx >= w.width || fy >= w.height) continue;
      const [tx, ty] = fr.tile(fx, fy, 1);
      if (!isResource(w, tileIndex(w, tx, ty))) continue;
      const d = dist(fx + 0.5, fy + 0.5, q.x, q.y);
      if (d > r || d >= bestD) continue;
      bestD = d;
      best = { x: tx + 0.5, y: ty + 0.5 };
    }
  return best;
}

// --- sites ---------------------------------------------------------------

/** Open ground all round tile (tx, ty) (a 3×3 block: every 2×2 footprint a Goliath could settle on there is clear). */
function openAround(w: World, tx: number, ty: number): boolean {
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      const x = tx + dx;
      const y = ty + dy;
      if (!inBounds(w, x, y) || !TERRAIN[terrainAt(w, x, y)].buildable || w.occupancy[tileIndex(w, x, y)] !== 0) return false;
    }
  return !blocksObjective(w, tx - 1, ty - 1, 3);
}

/**
 * The best tile centre to dig in at round `around`, within `max` tiles of it
 * (and `min` at least), with open ground all round, scored by `score`
 * (lower is better), scanned in the side's own frame (ties: frame order).
 */
function spotNear(
  w: World,
  faction: Faction,
  around: P,
  min: number,
  max: number,
  score: (p: P) => number,
  region = 0
): P | null {
  const fr = sideFrame(w, faction);
  const a = fr.toFrame(around);
  const R = Math.ceil(max);
  let best: P | null = null;
  let bestS = Infinity;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const fx = Math.floor(a.x) + dx;
      const fy = Math.floor(a.y) + dy;
      if (fx < 1 || fy < 1 || fx >= w.width - 1 || fy >= w.height - 1) continue;
      const d = dist(fx + 0.5, fy + 0.5, a.x, a.y);
      if (d > max || d < min) continue;
      const [tx, ty] = fr.tile(fx, fy, 1);
      if (!openAround(w, tx, ty)) continue;
      if (region && regionAt(w, tx, ty, "ground") !== region) continue;
      const p = { x: tx + 0.5, y: ty + 0.5 };
      const sc = score(p);
      if (sc < bestS - 1e-9) {
        bestS = sc;
        best = p;
      }
    }
  return best;
}

export interface GoliathContext {
  /** Our army on home land (combat units, ai/commander). */
  army: Unit[];
  /** Units already given orders this pass (updated in place). */
  used: Set<number>;
  hqC: P;
  enemyHqPos: P;
  /** Enemy units in sight. */
  seen: Unit[];
  mode: AiMode;
  /** A real attack on the base is under way. */
  threatened: boolean;
  /** Where the army gathers for a wave. */
  staging: P;
  /** The mined field near home, shaded toward home (ai/commander guardPoint). */
  guardPoint: P;
  /** We still have an HQ. */
  hasHq: boolean;
  /** A free-for-all's push under way (planPush): where our Goliaths walking with the waves march. */
  push?: P | null;
}

/** Known enemy defences covering (x, y) (range + GOLIATH_AI.defenceGap). */
function underGuns(known: readonly KnownBuilding[], p: P, gap = GOLIATH_AI.defenceGap): boolean {
  for (const kb of known) {
    const st = BUILDINGS[kb.kind];
    if (st.dps <= 0 || st.targets === "air" || kb.kind === "hq") continue;
    if (distToFootprint(kb.tx, kb.ty, st.size, p.x, p.y) <= st.range + gap) return true;
  }
  return false;
}

/** Visible armed enemy threat (threatValue) within `r` of a point. */
function enemyNear(seen: readonly Unit[], p: P, r: number): number {
  let v = 0;
  for (const e of seen) if ((UNITS[e.kind].dps > 0 || e.goliath) && dist(e.x, e.y, p.x, p.y) <= r) v += threatValue(e);
  return v;
}

/** Could two Condors fly this Goliath (not on Easy, Condors allowed, an Airpad to build them at or two on the field)? */
function canLift(w: World, faction: Faction, s: AiState): boolean {
  if (s.difficulty === "easy" || bannedBy(w, "condor", faction)) return false;
  let condors = 0;
  for (const u of w.units.values()) if (u.faction === faction && u.kind === "condor") condors++;
  if (condors >= 2) return true;
  for (const b of w.buildings.values()) if (b.faction === faction && b.kind === "airpad") return true;
  return false;
}

/**
 * Where Goliath `g` should dig in next: the best-scoring rich field no
 * drop-off of ours serves (not the enemy's, not under its guns), an island
 * relay (island maps: by lift), or, when none pays, a forward post (for a
 * personality that holds one). Null: nowhere worth it (it guards home).
 */
function chooseSite(w: World, faction: Faction, s: AiState, g: Unit, ctx: GoliathContext, m: Memo): Site | null {
  const known = knownBuildings(w, faction);
  const home = ctx.hqC;
  const enemyHq = ctx.enemyHqPos;
  const fr = sideFrame(w, faction);
  const gRegion = regionAt(w, Math.floor(g.x), Math.floor(g.y), "ground");
  const lifts = canLift(w, faction, s) && w.tick >= (m.plans.get(g.id)?.noLift ?? -1e9);
  // (a site by lift only with a way there clear of anti-air now: the Condors are only held then)
  const sky = lifts ? liftAirspace(w, faction, ctx.seen) : null;
  const flyable = (at: P) => !!sky && !sky.covered(at.x, at.y) && route(w, g, at, sky.clear) !== undefined;
  m.avoid = m.avoid.filter((a) => a.until > w.tick);
  const avoided = (p: P) => m.avoid.some((a) => dist(a.x, a.y, p.x, p.y) < 4);
  // sites other Goliaths of ours have
  const taken: P[] = [];
  for (const [id, plan] of m.plans) if (id !== g.id && plan.site) taken.push(plan.site.field ?? plan.site.at);
  const caution = s.strategy.name === "boom" ? 1 : 0.6;
  // out of an enemy Goliath's reach (two dug in within mortar range of each other only shell
  // each other's outposts), and under Robot Love well clear of one (a meeting is a draw)
  const gap = rulesOf(w).robotLove ? Math.max(GOLIATH_AI.goliathGap, GOLIATH_AI.loveGap + 4) : GOLIATH_AI.goliathGap;
  const clearOfThem = (p: P) => !ctx.seen.some((e) => !!e.goliath && dist(e.x, e.y, p.x, p.y) < gap);
  const exposure = (p: P) => Math.max(-1, Math.min(1, (dist(p.x, p.y, home.x, home.y) - dist(p.x, p.y, enemyHq.x, enemyHq.y)) / 20));
  const cands: (Site & { key: P })[] = [];

  // rich fields no drop-off of ours serves
  for (const cl of fieldClusters(w, faction, m)) {
    if (cl.value < GOLIATH_AI.siteMin) continue;
    const c = cl.c;
    const ds = nearestDropSite(w, faction, c.x, c.y, "ground");
    if (ds && ds.id !== g.id && distToFootprint(ds.tx, ds.ty, ds.size, c.x, c.y) <= GOLIATH_AI.siteServed) continue;
    if (dist(c.x, c.y, enemyHq.x, enemyHq.y) < GOLIATH_AI.enemyHome) continue;
    if (known.some((kb) => { const k = kbCentre(kb); return dist(k.x, k.y, c.x, c.y) <= GOLIATH_AI.enemyNear; })) continue;
    if (taken.some((t) => dist(t.x, t.y, c.x, c.y) < 6) || avoided(c)) continue;
    const tiles = cl.tiles;
    const nearField = (p: P) => {
      let best = Infinity;
      for (const i of tiles) best = Math.min(best, dist(p.x, p.y, (i % w.width) + 0.5, Math.floor(i / w.width) + 0.5));
      return best;
    };
    // beside the field (about two tiles from its nearest tile), on our side of it
    const reach = Math.min(12, GOLIATH_AI.siteReach + Math.sqrt(tiles.length));
    const at = spotNear(w, faction, c, 0, reach, (p) => Math.abs(nearField(p) - 2) * 2 + dist(p.x, p.y, home.x, home.y) * 0.02);
    if (!at || nearField(at) > 3.2 || underGuns(known, at) || !clearOfThem(at)) continue;
    const lift = regionAt(w, Math.floor(at.x), Math.floor(at.y), "ground") !== gRegion;
    if (lift && !flyable(at)) continue;
    const d = dist(g.x, g.y, at.x, at.y);
    let score = (cl.value / (d + 30)) * (1 - 0.5 * caution * Math.max(0, exposure(at))) - enemyNear(ctx.seen, at, 8) / 40;
    if (lift) score *= 0.7;
    cands.push({ kind: "field", at, field: c, value: cl.value, score, lift, key: cl.key });
  }

  // island relays (the island maps): two Condors fly it out, it trains the crew
  if (lifts && w.rules?.islands)
    for (const l of w.objectives.uplinks) {
      if (!l.infantryOnly) continue;
      const lr = regionAt(w, Math.floor(l.x), Math.floor(l.y), "ground");
      if (!lr || lr === gRegion || taken.some((t) => dist(t.x, t.y, l.x, l.y) < 6) || avoided(l)) continue;
      // an enemy Goliath already there: not a landing
      if (ctx.seen.some((e) => e.goliath && regionAt(w, Math.floor(e.x), Math.floor(e.y), "ground") === lr)) continue;
      const at = spotNear(w, faction, l, GOLIATH_AI.relayMin, GOLIATH_AI.relayMax, (p) => dist(p.x, p.y, l.x, l.y) + dist(p.x, p.y, home.x, home.y) * 0.02, lr);
      if (!at || underGuns(known, at) || !clearOfThem(at) || !flyable(at)) continue;
      const enemyOwned = l.owner !== null && l.owner !== faction ? 1.3 : 1;
      const v = uplinkPay(l) * GOLIATH_AI.relayWorth * enemyOwned;
      const d = dist(g.x, g.y, at.x, at.y);
      const score = (v / (d + 30)) * (1 - 0.5 * caution * Math.max(0, exposure(at))) * 0.7 - enemyNear(ctx.seen, at, 8) / 40;
      cands.push({ kind: "relay", at, field: null, value: v, score, lift: true, relayId: l.id, key: fr.toFrame(l) });
    }

  cands.sort((a, b) => b.score - a.score || a.key.y - b.key.y || a.key.x - b.key.x);
  // the best few, checked for a way there (A* is dear: three at most)
  let paths = 0;
  for (const c of cands) {
    if (c.value < GOLIATH_AI.siteMin && c.kind === "field") continue;
    if (!c.lift) {
      if (paths++ >= 3) break;
      const path = findPath(w, g.x, g.y, c.at.x, c.at.y, "ground", faction);
      const end = path?.[path.length - 1];
      if (!path || !end || dist(end.x, end.y, c.at.x, c.at.y) > 1.5) {
        if (!flyable(c.at)) continue;
        c.lift = true; // cut off by ground: fly it
      } else {
        const straight = dist(g.x, g.y, c.at.x, c.at.y);
        const walk = path.length; // (tiles: near enough)
        if (walk > straight * GOLIATH_AI.liftDetour && walk - straight > GOLIATH_AI.liftGain && freeCondors(w, faction, s, g, m).length >= 2 && flyable(c.at))
          c.lift = true;
      }
    }
    const { key: _key, ...site } = c;
    return site;
  }

  // a forward post: a share of the way to the enemy, clear of its guns
  if (GOLIATH_AI.front[s.strategy.name]) {
    const t = GOLIATH_AI.frontShare;
    const aim = { x: home.x + (enemyHq.x - home.x) * t, y: home.y + (enemyHq.y - home.y) * t };
    if (!avoided(aim)) {
      const at = spotNear(w, faction, aim, 0, 6, (p) => dist(p.x, p.y, aim.x, aim.y), gRegion);
      if (at && !underGuns(known, at, GOLIATH_AI.defenceGap + 2) && clearOfThem(at) && !taken.some((p) => dist(p.x, p.y, at.x, at.y) < 6))
        return { kind: "front", at, field: null, value: GOLIATH_AI.frontValue, score: GOLIATH_AI.frontValue / (dist(g.x, g.y, at.x, at.y) + 30), lift: false };
    }
  }
  return null;
}

// --- Condors for a lift --------------------------------------------------

/**
 * Condors free to lift Goliath `g`: ours, empty, not on a drop (ai/condor.ts)
 * or an airlift trip (ai/airlift.ts), not held for another Goliath; nearest
 * it first.
 */
function freeCondors(w: World, faction: Faction, s: AiState, g: Unit, m: Memo): Unit[] {
  const held = new Set<number>();
  for (const [id, plan] of m.plans) if (id !== g.id) for (const c of plan.carriers) held.add(c);
  const drop = dropCondorId(s);
  const out: Unit[] = [];
  for (const u of w.units.values())
    if (
      u.faction === faction && u.kind === "condor" && canCarry(u) && !isLoaded(u) && !held.has(u.id) &&
      u.id !== drop && !airliftBusy(s, u.id) && (u.order.type === "idle" || u.order.type === "move")
    )
      out.push(u);
  return out.sort((a, b) => dist(a.x, a.y, g.x, g.y) - dist(b.x, b.y, g.x, g.y) || a.id - b.id);
}

/**
 * Condors the drop and airlift planners must leave alone: those on a lift
 * (a move, unload or stop to one redirects or sets down the Goliath) and
 * those held for one.
 */
export function liftCondors(w: World, faction: Faction, s: AiState): Set<number> {
  const out = new Set<number>();
  for (const u of w.units.values()) if (u.faction === faction && u.order.type === "lift") out.add(u.id);
  const m = memos.get(s);
  if (m) for (const plan of m.plans.values()) for (const id of plan.carriers) if (w.units.has(id)) out.add(id);
  return out;
}

/** Condors a lift is still short of (the Airpad builds them: commander.ts runPads). */
export function liftWantsCondors(w: World, faction: Faction, s: AiState): number {
  const m = memos.get(s);
  if (!m) return 0;
  let want = 0;
  for (const [id, plan] of m.plans) {
    if (plan.phase !== "lift" || plan.lifting) continue;
    const g = w.units.get(id);
    if (!g) continue;
    want += Math.max(0, 2 - plan.carriers.length - freeCondors(w, faction, s, g, m).length);
  }
  return Math.min(2, want);
}

// --- holds -----------------------------------------------------------------

/** Units the Goliath plans have a claim on this pass (escorts, strikes under way): other tactics leave them be. */
export function goliathHolds(w: World, s: AiState): number[] {
  const m = memos.get(s);
  if (!m) return [];
  const out: number[] = [];
  for (const plan of m.plans.values()) for (const id of plan.escorts) if (w.units.has(id)) out.push(id);
  for (const h of m.hunts.values()) for (const id of h.ids) if (w.units.has(id)) out.push(id);
  return out;
}

/** Plans for dead Goliaths go (their escorts and harvesters are free again). */
function prune(w: World, faction: Faction, m: Memo): Plan[] {
  const gone: Plan[] = [];
  for (const [id, plan] of m.plans) {
    const g = w.units.get(id);
    if (!g || g.faction !== faction) {
      gone.push(plan);
      m.plans.delete(id);
    }
  }
  return gone;
}

// --- the harvesters ------------------------------------------------------

/**
 * Harvesters for the fields our anchored Goliaths work (call from the
 * economy pass): `extra` more wanted beyond the base's count, `keep` (ids
 * the base must not re-task) and the harvest orders that send them out — or
 * bring them home when their Goliath has moved on and no outpost Depot
 * serves the field.
 */
export function goliathHarvest(
  w: World,
  faction: Faction,
  s: AiState,
  harvesters: Unit[],
  homeField: () => P | null
): { extra: number; keep: Set<number>; cmds: Command[] } {
  const m = memos.get(s);
  const keep = new Set<number>();
  const cmds: Command[] = [];
  if (!m) return { extra: 0, keep, cmds };
  let extra = 0;
  const claimed = new Set<number>();
  for (const plan of m.plans.values()) for (const id of plan.harvesters) claimed.add(id);
  for (const [id, plan] of [...m.plans].sort((a, b) => a[0] - b[0])) {
    const g = w.units.get(id);
    const site = plan.site;
    const working = !!g && plan.phase === "hold" && isAnchored(g) && !!site?.field && fieldLeft(w, site.field, 5) > 0;
    if (!working) {
      // moved on: back home, unless an outpost Depot by the field takes their scrap
      if (plan.harvesters.length > 0) {
        const field = site?.field;
        const ds = field ? nearestDropSite(w, faction, field.x, field.y, "ground") : null;
        const served = !!field && !!ds && ds.id !== id && distToFootprint(ds.tx, ds.ty, ds.size, field.x, field.y) <= GOLIATH_AI.siteServed;
        const back = plan.harvesters.map((h) => w.units.get(h)).filter((h): h is Unit => !!h);
        const home = !served && back.length > 0 ? homeField() : null;
        if (home) cmds.push({ type: "harvest", faction, unitIds: back.map((h) => h.id), x: home.x, y: home.y });
        plan.harvesters = [];
      }
      continue;
    }
    const want = GOLIATH_AI.harvesters[s.strategy.name];
    extra += want;
    plan.harvesters = plan.harvesters.filter((h) => w.units.has(h));
    for (const h of plan.harvesters) keep.add(h);
    if (plan.harvesters.length >= want) continue;
    const target = nearestFieldTile(w, faction, g!, 6) ?? nearestFieldTile(w, faction, site!.field!, 6);
    if (!target) continue;
    // idle ones first, then those mining near home (not in a fight, not unloading), nearest first
    const pool = harvesters
      .filter((h) => !claimed.has(h.id) && w.tick - h.damagedTick > 4 * TICK_RATE)
      .filter((h) => h.order.type === "idle" || (h.order.type === "harvest" && h.order.phase !== "unloading"))
      .filter((h) => canGetWithin(w, "ground", h.x, h.y, target.x, target.y, 1.5))
      .sort((a, b) => (a.order.type === "idle" ? 0 : 1) - (b.order.type === "idle" ? 0 : 1) || dist(a.x, a.y, target.x, target.y) - dist(b.x, b.y, target.x, target.y) || a.id - b.id);
    // (never the last one at home: the base keeps mining)
    const spare = Math.max(0, harvesters.length - claimed.size - 1);
    const picks = pool.slice(0, Math.min(want - plan.harvesters.length, spare));
    if (picks.length === 0) continue;
    for (const h of picks) {
      plan.harvesters.push(h.id);
      claimed.add(h.id);
      keep.add(h.id);
    }
    cmds.push({ type: "harvest", faction, unitIds: picks.map((h) => h.id), x: target.x, y: target.y });
  }
  return { extra, keep, cmds };
}

// --- outposts ------------------------------------------------------------

/** Own buildings within `r` of a point. */
function ownBuildingsNear(w: World, faction: Faction, p: P, r: number): Building[] {
  const out: Building[] = [];
  for (const b of w.buildings.values())
    if (b.faction === faction && distToFootprint(b.tx, b.ty, BUILDINGS[b.kind].size, p.x, p.y) <= r) out.push(b);
  return out;
}

/**
 * The outpost an anchored Goliath wants started now (construction pass,
 * when the slot is free), or null: the personality's list for a field (a
 * Depot only while the field is rich, a SAM only once enemy air is about),
 * a Turret and a SAM at an island relay or a forward post, one every
 * GOLIATH_AI.outpostEvery seconds, never one it can't place.
 */
export function outpostWanted(w: World, faction: Faction, s: AiState, scrap: number): BuildingKind | null {
  const m = memos.get(s);
  if (!m || w.tick - m.lastOutpost < GOLIATH_AI.outpostEvery * TICK_RATE) return null;
  for (const [id, plan] of [...m.plans].sort((a, b) => a[0] - b[0])) {
    const g = w.units.get(id);
    const site = plan.site;
    if (!g || !site || plan.phase !== "hold" || !isAnchored(g)) continue;
    // (the first one goes up whatever; more only on an income, not out of the last of the bank)
    if (plan.outposts.length > 0 && incomeRate(m) < GOLIATH_AI.outpostIncome) continue;
    const near = ownBuildingsNear(w, faction, g, GOLIATH_AI.post + 2);
    const list: BuildingKind[] =
      site.kind === "field" ? GOLIATH_AI.outposts[s.strategy.name] : site.kind === "relay" ? ["sam-site", "turret"] : ["turret", "sam-site"];
    for (const kind of list) {
      // (each once a stay: one the enemy knocked down here isn't put straight back up under its guns)
      if (near.some((b) => b.kind === kind) || plan.outposts.includes(kind)) continue;
      if (kind === "depot" && (!site.field || fieldLeft(w, site.field, 5) < GOLIATH_AI.depotMin)) continue;
      if (kind === "sam-site" && s.seenAir < GOLIATH_AI.samAir) continue;
      if (BUILDINGS[kind].cost > scrap || bannedBy(w, kind, faction)) break;
      if (!outpostSpotFor(w, faction, g, site, kind)) continue;
      m.outpost = { kind, goliathId: id };
      m.lastOutpost = w.tick;
      plan.outposts.push(kind);
      return kind;
    }
  }
  return null;
}

/**
 * Where a finished building goes if it was started as an outpost (construction
 * pass, `kind` ready): a spot in its Goliath's ring, or null (not an outpost,
 * or its Goliath has gone: the commander places it as usual).
 */
export function outpostSpot(w: World, faction: Faction, s: AiState, kind: BuildingKind, enemyHq: P): { tx: number; ty: number } | null {
  const m = memos.get(s);
  const o = m?.outpost;
  if (!m || !o || o.kind !== kind) return null;
  m.outpost = null;
  const g = w.units.get(o.goliathId);
  const plan = m.plans.get(o.goliathId);
  if (!g || !plan?.site || !isAnchored(g)) return null;
  return outpostSpotFor(w, faction, g, plan.site, kind, enemyHq);
}

/**
 * A spot for outpost `kind` in anchored Goliath `g`'s ring: a tile's lane
 * left all round its footprint (it walks out again), lanes round the
 * building too (tooCramped), the Depot nearest the field, defences toward
 * the enemy. Searched in the side's own frame.
 */
function outpostSpotFor(w: World, faction: Faction, g: Unit, site: Site, kind: BuildingKind, enemyHq?: P): { tx: number; ty: number } | null {
  const size = BUILDINGS[kind].size;
  const fr = sideFrame(w, faction);
  const G = fr.toFrame(g);
  // the Depot by the field; defences a few tiles out toward the enemy
  const toward = enemyHq ?? { x: w.width - g.x, y: w.height - g.y };
  const k = 3 / Math.max(3, dist(g.x, g.y, toward.x, toward.y));
  const aim: P = kind === "depot" && site.field ? site.field : { x: g.x + (toward.x - g.x) * k, y: g.y + (toward.y - g.y) * k };
  const A = fr.toFrame(aim);
  const R = Math.ceil(GOLIATH.buildRing + size);
  let best: { tx: number; ty: number } | null = null;
  let bestD = Infinity;
  for (let dy = -R; dy <= R; dy++)
    for (let dx = -R; dx <= R; dx++) {
      const fx = Math.round(G.x + dx - size / 2);
      const fy = Math.round(G.y + dy - size / 2);
      const d = dist(fx + size / 2, fy + size / 2, A.x, A.y);
      if (d >= bestD - 1e-9) continue;
      const [tx, ty] = fr.tile(fx, fy, size);
      const gap = distToFootprint(tx, ty, size, g.x, g.y);
      if (gap > GOLIATH.buildRing || gap < GOLIATH.footprint / 2 + 1) continue; // (a lane round its feet)
      if (!canPlaceBuilding(w, faction, kind, tx, ty)) continue;
      if (size > 1 && cramped(w, tx, ty, size)) continue;
      best = { tx, ty };
      bestD = d;
    }
  return best;
}

/** Would a building here leave no free tile along any side (walling in)? (ai/commander's tooCramped.) */
function cramped(w: World, tx: number, ty: number, size: number): boolean {
  let free = 0;
  for (let i = -1; i <= size; i++)
    for (const [x, y] of [
      [tx + i, ty - 1],
      [tx + i, ty + size],
      [tx - 1, ty + i],
      [tx + size, ty + i]
    ] as [number, number][]) {
      if (x < 0 || y < 0 || x >= w.width || y >= w.height) continue;
      if (w.occupancy[y * w.width + x] === 0) free++;
    }
  return free < (size + 2) * 2;
}

// --- training ------------------------------------------------------------

/**
 * Anchored Goliaths that want a squad trained now, with what (runBays):
 * squads to stand by it (GOLIATH_AI.garrison; more at an island relay, more
 * still with the HQ gone), Rocket Squads once enemy air or armour is about.
 */
export function goliathBarracks(
  w: World,
  faction: Faction,
  s: AiState,
  r: () => number,
  hasHq: boolean
): { id: number; queue: QueueItem[]; kind: UnitKind }[] {
  const m = memos.get(s);
  const out: { id: number; queue: QueueItem[]; kind: UnitKind }[] = [];
  for (const g of goliathsOf(w, faction).sort(byId)) {
    if (!isAnchored(g) || g.goliath!.queue.length > 0) continue;
    const plan = m?.plans.get(g.id);
    const want = !hasHq ? GOLIATH_AI.lastGarrison : plan?.site?.kind === "relay" ? GOLIATH_AI.relayGarrison : GOLIATH_AI.garrison;
    let have = 0;
    for (const u of w.units.values()) if (u.faction === faction && isInfantry(u.kind) && dist(u.x, u.y, g.x, g.y) <= 7) have++;
    if (have >= want) continue;
    const rockets = s.seenAir >= 2 || s.seenHeavy >= 2;
    out.push({ id: g.id, queue: g.goliath!.queue, kind: rockets && r() < 0.6 ? "rocket-squad" : "trooper" });
  }
  return out;
}

// --- the plan ------------------------------------------------------------

function newPlan(w: World): Plan {
  return {
    phase: "muster", since: w.tick, site: null, next: "muster", escorts: [], harvesters: [], outposts: [], carriers: [], launchHp: [],
    waypoint: null, lifting: false, liftTick: 0, origin: null, landing: null, noLift: -1e9, tries: 0, moved: -1e9, checked: w.tick
  };
}

function setPhase(w: World, plan: Plan, p: Phase): void {
  if (plan.phase !== p) plan.since = w.tick;
  if (plan.phase !== p && (p === "dig" || p === "pack")) plan.outposts = []; // (a new stay, or the end of one)
  plan.phase = p;
  plan.tries = 0;
}

/** Give up on a site for a while (no way there, no room, taken). */
function avoidSite(w: World, m: Memo, site: Site | null): void {
  if (!site) return;
  const p = site.field ?? site.at;
  m.avoid.push({ x: p.x, y: p.y, until: w.tick + GOLIATH_AI.avoid * TICK_RATE });
}

/**
 * One decision pass for our Goliaths: pick sites, walk or fly there, dig in,
 * hold, move on, walk with a wave, fall back; escorts with them. Call after
 * the threat response and home defence, before the other tactics.
 */
export function planGoliaths(w: World, faction: Faction, s: AiState, ctx: GoliathContext): Command[] {
  const cmds: Command[] = [];
  const m = memo(s);
  prune(w, faction, m);
  const goliaths = goliathsOf(w, faction).sort(byId);
  if (goliaths.length === 0) return cmds;
  // with no HQ (lost, or Nomads) one Goliath is the base: the first dug in (else the first);
  // any other plays as if the HQ stood
  const base = ctx.hasHq ? null : goliaths.find(isAnchored) ?? goliaths[0]!;
  const love = loveMood(w, ctx, goliaths);
  for (const g of goliaths) {
    let plan = m.plans.get(g.id);
    if (!plan) {
      plan = newPlan(w);
      m.plans.set(g.id, plan);
    }
    const gctx = base && g.id !== base.id ? { ...ctx, hasHq: true } : ctx;
    if (ctx.used.has(g.id) && canWalk(g)) {
      keepEscorts(w, faction, s, g, plan, gctx, cmds);
      continue; // (dodging a reticle)
    }
    if (!(love && loveStep(w, faction, g, plan, gctx, love, cmds))) step(w, faction, s, g, plan, gctx, m, cmds);
    ctx.used.add(g.id);
    keepEscorts(w, faction, s, g, plan, gctx, cmds);
  }
  return cmds;
}

// --- Robot Love ------------------------------------------------------------

/**
 * Under Robot Love (two enemy Goliaths within GOLIATH.love.range: a draw),
 * how our Goliaths should feel about theirs: "shy" — keep clear, the usual
 * case — or "court" when we're plainly losing (what we field and see of
 * ours is under GOLIATH_AI.loveLosing of what we see of theirs, and the base
 * is under attack or gone): a draw beats a defeat. Null without the mutator
 * or an enemy Goliath.
 */
function loveMood(w: World, ctx: GoliathContext, ours: readonly Unit[]): "shy" | "court" | null {
  if (!rulesOf(w).robotLove || !ctx.seen.some((e) => !!e.goliath)) return null;
  const mine = value(ctx.army) + ours.reduce((v, g) => v + threatValue(g), 0);
  const theirs = ctx.seen.reduce((v, e) => v + (UNITS[e.kind].dps > 0 || e.goliath ? threatValue(e) : 0), 0);
  const losing = mine < GOLIATH_AI.loveLosing * theirs && (ctx.threatened || (!ctx.hasHq && !goliathBase(w)));
  return losing ? "court" : "shy";
}

/**
 * One Goliath's pass under Robot Love; true when it took the Goliath's orders.
 * Shy: an enemy Goliath within GOLIATH_AI.loveGap sends ours the other way
 * (packing up first if it is dug in and the other is close). Courting: ours
 * walks to meet the nearest of theirs.
 */
function loveStep(w: World, faction: Faction, g: Unit, plan: Plan, ctx: GoliathContext, mood: "shy" | "court", cmds: Command[]): boolean {
  const gs = g.goliath!;
  if (gs.lift) return false;
  const foes = ctx.seen.filter((e) => !!e.goliath).sort((a, b) => dist(a.x, a.y, g.x, g.y) - dist(b.x, b.y, g.x, g.y) || a.id - b.id);
  const e = foes[0];
  if (!e) return false;
  const d = dist(e.x, e.y, g.x, g.y);
  /** Taking its orders: a lift it was getting (a Condor held for it) is off. */
  const leaveLift = () => {
    if (plan.phase !== "lift") return;
    plan.carriers = [];
    plan.launchHp = [];
    plan.lifting = false;
    plan.waypoint = null;
  };
  if (mood === "court") {
    leaveLift();
    if (gs.mode === "anchored" || gs.mode === "anchoring") cmds.push({ type: "packUp", faction, unitIds: [g.id] });
    else if (gs.mode === "walking" && walkable(w, g, e)) {
      const o = g.order;
      if (!(o.type === "move" && dist(o.x, o.y, e.x, e.y) < 2)) cmds.push({ type: "move", faction, unitIds: [g.id], x: e.x, y: e.y });
    }
    plan.site = null;
    setPhase(w, plan, "guard");
    return true;
  }
  const gap = GOLIATH_AI.loveGap;
  if (d > gap + (gs.mode === "walking" ? 0 : GOLIATH.packTime * UNITS.goliath.speed)) return false;
  leaveLift();
  if (gs.mode === "anchored" || gs.mode === "anchoring") {
    cmds.push({ type: "packUp", faction, unitIds: [g.id] });
    plan.next = "guard";
    plan.site = null;
    setPhase(w, plan, "pack");
    return true;
  }
  if (gs.mode !== "walking") return true; // (packing up: away once it walks)
  // straight away from it, as far again as the gap (kept on the map)
  const k = (gap + 2) / Math.max(0.5, d);
  const to = inMap(w, { x: g.x + (g.x - e.x) * k, y: g.y + (g.y - e.y) * k });
  const o = g.order;
  if (!(o.type === "move" && dist(o.x, o.y, to.x, to.y) < 2) && walkable(w, g, to))
    cmds.push({ type: "move", faction, unitIds: [g.id], x: to.x, y: to.y });
  plan.site = null;
  setPhase(w, plan, "guard");
  return true;
}

function step(w: World, faction: Faction, s: AiState, g: Unit, plan: Plan, ctx: GoliathContext, m: Memo, cmds: Command[]): void {
  const gs = g.goliath!;
  const hp = hpShare(g);
  const move = (p: P) => {
    const o = g.order;
    if (o.type === "move" && dist(o.x, o.y, p.x, p.y) < 0.6) return;
    if (!walkable(w, g, p)) return; // (never across the water it can't walk: an island is a lift away)
    cmds.push({ type: "move", faction, unitIds: [g.id], x: p.x, y: p.y });
    plan.moved = w.tick;
  };

  // --- on a lift (or getting one) ----------------------------------------
  if (gs.lift || plan.phase === "lift") {
    liftStep(w, faction, s, g, plan, ctx, m, cmds);
    return;
  }

  // --- hurt: fall back to the Menders and home ----------------------------
  // (walking with a wave it falls back sooner: its laser gone, the long walk home is under fire)
  const floor = plan.phase === "siege" ? GOLIATH_AI.siegeRetreat : GOLIATH_AI.retreatHp;
  if (canWalk(g) && plan.phase !== "retreat" && (hp < floor || !gs.weapons.cannons.online)) {
    setPhase(w, plan, "retreat");
    plan.site = null;
  }
  // anchored and losing: pack up and go (packing takes a while: only once it's plainly losing)
  if (isAnchored(g) && plan.phase === "hold") {
    const threat = enemyNear(ctx.seen, g, GOLIATH_AI.danger);
    const local = UNITS.goliath.cost * hp + value(ctx.army.filter((u) => dist(u.x, u.y, g.x, g.y) <= 6)) +
      ownBuildingsNear(w, faction, g, 6).reduce((v, b) => v + (BUILDINGS[b.kind].dps > 0 ? BUILDINGS[b.kind].cost : 0), 0);
    if (threat > GOLIATH_AI.loseEdge * local && hp < 0.6 && ctx.hasHq && walkable(w, g, ctx.hqC)) {
      cmds.push({ type: "packUp", faction, unitIds: [g.id] });
      plan.next = "retreat";
      avoidSite(w, m, plan.site);
      setPhase(w, plan, "pack");
      return;
    }
  }

  switch (plan.phase) {
    case "muster":
    case "guard": {
      if (gs.mode === "anchored" || gs.mode === "anchoring") {
        // dug in (handed over anchored, or it settled on its own): hold here
        plan.site = plan.site ?? { kind: "front", at: { x: g.x, y: g.y }, field: null, value: 0, score: 0, lift: false };
        setPhase(w, plan, gs.mode === "anchored" ? "hold" : "dig");
        return;
      }
      if (gs.mode === "packing") return;
      if (plan.phase === "guard" && w.tick - plan.since < GOLIATH_AI.recheck * TICK_RATE) return;
      // siege personalities fall in with a wave going by
      if (joinsWave(w, s, g, ctx, m, hp)) {
        setPhase(w, plan, "siege");
        return;
      }
      const site = chooseSite(w, faction, s, g, ctx, m);
      plan.site = site;
      if (!site && ctx.mode === "assault" && ctx.hasHq && hp >= GOLIATH_AI.resumeHp) {
        // nowhere worth digging in, and an assault on: whatever the personality, it walks with
        // the waves rather than stand idle at home
        setPhase(w, plan, "siege");
        return;
      }
      if (!site) {
        // nowhere worth digging in: stand guard by the home field (or, the HQ gone, dig in there)
        const at = ctx.hasHq ? ctx.guardPoint : spotNear(w, faction, ctx.guardPoint, 0, 8, (p) => dist(p.x, p.y, ctx.guardPoint.x, ctx.guardPoint.y));
        if (!ctx.hasHq && at) {
          plan.site = { kind: "front", at, field: null, value: 0, score: 0, lift: false };
          setPhase(w, plan, "march");
          move(at);
          return;
        }
        setPhase(w, plan, "guard");
        plan.since = w.tick; // (a look round again GOLIATH_AI.recheck from now, not every pass)
        if (dist(g.x, g.y, ctx.guardPoint.x, ctx.guardPoint.y) > 4) move(ctx.guardPoint);
        return;
      }
      if (site.lift) {
        setPhase(w, plan, "lift");
        plan.carriers = [];
        plan.lifting = false;
        liftStep(w, faction, s, g, plan, ctx, m, cmds);
        return;
      }
      setPhase(w, plan, "march");
      move(site.at);
      return;
    }
    case "march": {
      const site = plan.site;
      if (!site || gs.mode !== "walking") {
        setPhase(w, plan, "muster");
        return;
      }
      // re-check now and then: taken by the enemy, under its guns?
      if (w.tick - plan.checked > GOLIATH_AI.recheck * TICK_RATE) {
        plan.checked = w.tick;
        const known = knownBuildings(w, faction);
        if (underGuns(known, site.at) || enemyNear(ctx.seen, site.at, 6) > UNITS.goliath.cost * hp * 1.5) {
          avoidSite(w, m, site);
          setPhase(w, plan, "muster");
          return;
        }
      }
      const d = dist(g.x, g.y, site.at.x, site.at.y);
      if (d > 1.2) {
        if (g.order.type === "idle" && w.tick - plan.moved > 2 * TICK_RATE) {
          // stopped short (blocked, or pushed off): again, a few times
          if (++plan.tries > 4) {
            avoidSite(w, m, site);
            setPhase(w, plan, "muster");
            return;
          }
          cmds.push({ type: "move", faction, unitIds: [g.id], x: site.at.x, y: site.at.y });
          plan.moved = w.tick;
        } else move(site.at);
        return;
      }
      if (g.order.type !== "idle") return;
      const why = anchorBlocker(w, g);
      if (!why) {
        cmds.push({ type: "anchor", faction, unitIds: [g.id] });
        setPhase(w, plan, "dig");
        return;
      }
      if (why === "Unit in the way") {
        // our own units on its feet step aside (an enemy there: fight it out first)
        shoveAside(w, faction, g, ctx, cmds);
        if (++plan.tries > 6) {
          avoidSite(w, m, site);
          setPhase(w, plan, "muster");
        }
        return;
      }
      // (it stopped a little off the spot: the nearest open ground, else another site)
      const relay = site.relayId !== undefined ? w.objectives.uplinks.find((l) => l.id === site.relayId) : undefined;
      const offRelay = (p: P) => !relay || dist(p.x, p.y, relay.x, relay.y) >= GOLIATH_AI.relayMin;
      const alt = spotNear(w, faction, g, 0, 2.5, (p) => dist(p.x, p.y, g.x, g.y) + (offRelay(p) ? 0 : 99));
      if (alt && offRelay(alt) && anchorBlockedAt(w, faction, alt.x, alt.y, g.id) === null && plan.tries < 3) {
        plan.tries++;
        site.at = alt;
        cmds.push({ type: "move", faction, unitIds: [g.id], x: alt.x, y: alt.y });
        plan.moved = w.tick;
      } else {
        avoidSite(w, m, site);
        setPhase(w, plan, "muster");
      }
      return;
    }
    case "dig": {
      if (gs.mode === "anchored") setPhase(w, plan, "hold");
      else if (gs.mode === "walking") setPhase(w, plan, plan.site ? "march" : "muster");
      return;
    }
    case "hold": {
      if (gs.mode !== "anchored") {
        setPhase(w, plan, gs.mode === "walking" ? "muster" : plan.phase);
        return;
      }
      const site = plan.site;
      // no HQ (lost, or Nomads): this is the base. It stays — unless its field is dry, or its
      // ring is full and the field thin, and a field worth it lies within reach: then it moves
      // on, while nothing threatens it (it's a drop-off and a barracks again within a minute)
      if (!ctx.hasHq) {
        if (w.tick - plan.checked < GOLIATH_AI.recheck * TICK_RATE) return;
        plan.checked = w.tick;
        const left = fieldLeft(w, g, GOLIATH_AI.baseField);
        const full = w.tick - m.noRoom < GOLIATH_AI.recheck * 2 * TICK_RATE;
        if (!(left < GOLIATH_AI.leaveBelow || (full && left < GOLIATH_AI.siteMin))) return;
        if (ctx.threatened || enemyNear(ctx.seen, g, GOLIATH_AI.danger + 3) > 0) return;
        const next = chooseSite(w, faction, s, g, ctx, m);
        if (!next || next.kind !== "field" || next.lift || dist(g.x, g.y, next.at.x, next.at.y) > GOLIATH_AI.baseMove) return;
        cmds.push({ type: "packUp", faction, unitIds: [g.id] });
        plan.site = next;
        plan.next = "march";
        setPhase(w, plan, "pack");
        return;
      }
      // a siege personality packs up to fall in with a wave going by (a forward post is on its way)
      if (site?.kind !== "relay" && joinsWave(w, s, g, ctx, m, hp, site?.kind === "front")) {
        cmds.push({ type: "packUp", faction, unitIds: [g.id] });
        plan.next = "siege";
        setPhase(w, plan, "pack");
        return;
      }
      // the field ran dry: move on
      if (site?.kind === "field" && site.field && fieldLeft(w, site.field, 5) < GOLIATH_AI.leaveBelow) {
        cmds.push({ type: "packUp", faction, unitIds: [g.id] });
        plan.next = "muster";
        avoidSite(w, m, site);
        setPhase(w, plan, "pack");
        return;
      }
      // a forward post (or a dug-in guard) moves to a field that pays far better
      if (site && site.kind === "front" && w.tick - plan.checked > GOLIATH_AI.recheck * TICK_RATE) {
        plan.checked = w.tick;
        const better = chooseSite(w, faction, s, g, ctx, m);
        if (better && better.kind !== "front" && !better.lift && better.value >= GOLIATH_AI.siteMin * GOLIATH_AI.better) {
          cmds.push({ type: "packUp", faction, unitIds: [g.id] });
          plan.next = "muster";
          setPhase(w, plan, "pack");
        }
      }
      return;
    }
    case "pack": {
      if (gs.mode === "walking") {
        const next = plan.next;
        plan.next = "muster";
        if (next === "march" && plan.site) {
          setPhase(w, plan, "march");
          move(plan.site.at);
          return;
        }
        plan.site = null;
        setPhase(w, plan, next);
      } else if (gs.mode === "anchored") cmds.push({ type: "packUp", faction, unitIds: [g.id] }); // (the order was lost: again)
      return;
    }
    case "siege": {
      if (ctx.mode !== "assault" || !ctx.hasHq || gs.mode !== "walking") {
        setPhase(w, plan, "muster");
        return;
      }
      let company = value(ctx.army.filter((u) => u.kind !== "mender" && dist(u.x, u.y, g.x, g.y) <= 8));
      // (a free-for-all: our other walking Goliaths beside it are company too — three marching
      // together don't turn back for want of an escort)
      if (ffaTactic(w, "company"))
        for (const o of goliathsOf(w, faction)) if (o.id !== g.id && canWalk(o) && dist(o.x, o.y, g.x, g.y) <= 8) company += threatValue(o);
      const deep = dist(g.x, g.y, ctx.enemyHqPos.x, ctx.enemyHqPos.y) < GOLIATH_AI.deep;
      if (deep && company < GOLIATH_AI.company) {
        // alone in their base: back to the nearest group of ours (or the staging point)
        const friends = ctx.army.filter((u) => u.kind !== "mender" && dist(u.x, u.y, ctx.enemyHqPos.x, ctx.enemyHqPos.y) > dist(g.x, g.y, ctx.enemyHqPos.x, ctx.enemyHqPos.y));
        friends.sort((a, b) => dist(a.x, a.y, g.x, g.y) - dist(b.x, b.y, g.x, g.y) || a.id - b.id);
        const to = friends[0] ?? ctx.staging;
        if (dist(g.x, g.y, to.x, to.y) > 3) move({ x: to.x, y: to.y });
        return;
      }
      // with the wave, a few tiles behind its lead (its mortars outreach the defences it shells),
      // never out in front of it; no wave out yet: the staging point
      const lead = waveLead(ctx, new Set([...m.plans.values()].flatMap((p) => p.escorts)));
      // (no wave out: it waits for the next at the staging point, where it counts toward it —
      // commander.ts — rather than walk back to dig in and pack up again)
      let goal = ctx.staging;
      if (lead) {
        const back = Math.max(0.5, dist(lead.x, lead.y, ctx.hqC.x, ctx.hqC.y));
        goal = { x: lead.x + ((ctx.hqC.x - lead.x) / back) * GOLIATH_AI.behind, y: lead.y + ((ctx.hqC.y - lead.y) / back) * GOLIATH_AI.behind };
      }
      // (a free-for-all's push: it marches on the target, the army gathering on the lead Goliath)
      if (ctx.push) goal = { x: ctx.push.x, y: ctx.push.y };
      if (dist(g.x, g.y, goal.x, goal.y) <= 2 || !walkable(w, g, goal)) return;
      const o = g.order;
      if (o.type === "attackMove" && dist(o.x, o.y, goal.x, goal.y) < 2) return;
      cmds.push({ type: "attackMove", faction, unitIds: [g.id], x: goal.x, y: goal.y });
      return;
    }
    case "retreat": {
      if (!canWalk(g)) return;
      if (hp >= GOLIATH_AI.resumeHp && gs.weapons.cannons.online) {
        setPhase(w, plan, "muster");
        return;
      }
      const home = ctx.hasHq ? ctx.hqC : ctx.guardPoint;
      const d = dist(g.x, g.y, home.x, home.y);
      // just short of home, toward where it is (the Menders come to it: ai/menders.ts)
      const k = d > 4 ? 4 / d : 0;
      const to = { x: home.x + (g.x - home.x) * k, y: home.y + (g.y - home.y) * k };
      // (no walking home from an island: it digs in where it stands, and the Menders fly to it)
      const stranded = !walkable(w, g, to);
      if (dist(g.x, g.y, to.x, to.y) > 1.5 && !stranded) move(to);
      else if ((!ctx.hasHq || stranded) && anchorBlocker(w, g) === null) {
        cmds.push({ type: "anchor", faction, unitIds: [g.id] }); // (no HQ: it dig in where it is safe and becomes the base)
        plan.site = { kind: "front", at: { x: g.x, y: g.y }, field: null, value: 0, score: 0, lift: false };
        setPhase(w, plan, "dig");
      }
      return;
    }
  }
}

/**
 * Does Goliath `g` (a siege personality's, healthy, the HQ standing) fall in
 * with our wave now: one is out, its lead within GOLIATH_AI.join tiles (a
 * Goliath walks at a tank's half speed: it joins a wave going by its post,
 * it doesn't chase one across the map)?
 */
function joinsWave(w: World, s: AiState, g: Unit, ctx: GoliathContext, m: Memo, hp: number, idle = false): boolean {
  if (ctx.mode !== "assault" || !ctx.hasHq || hp < GOLIATH_AI.resumeHp) return false;
  // (late on, a Goliath with nothing better to hold — a forward post — joins the assault whatever
  // the personality: dried-out fields and trickling waves otherwise stall into a 25-minute draw)
  if (idle && w.tick >= GOLIATH_AI.lateSiege * 60 * TICK_RATE) return true;
  if (!GOLIATH_AI.siege[s.strategy.name]) return false;
  const lead = waveLead(ctx, new Set([...m.plans.values()].flatMap((p) => p.escorts)));
  return !!lead && dist(lead.x, lead.y, g.x, g.y) <= GOLIATH_AI.join;
}

/**
 * Where our wave's lead is: the strongest group of ours (worth GOLIATH_AI.company
 * within 6 tiles at least) out past the staging point, attacking or
 * attack-moving (escorts aside). Null with no wave out.
 */
function waveLead(ctx: GoliathContext, escorts: ReadonlySet<number>): P | null {
  const out = dist(ctx.staging.x, ctx.staging.y, ctx.hqC.x, ctx.hqC.y) + 2;
  const pushing = ctx.army.filter(
    (u) =>
      u.kind !== "mender" && !escorts.has(u.id) && (u.order.type === "attack" || u.order.type === "attackMove") &&
      dist(u.x, u.y, ctx.hqC.x, ctx.hqC.y) > out
  );
  let lead: Unit | null = null;
  let best = 0;
  for (const u of pushing) {
    let v = 0;
    for (const o of pushing) if (dist(o.x, o.y, u.x, u.y) <= 6) v += UNITS[o.kind].cost;
    if (v > best) {
      best = v;
      lead = u;
    }
  }
  return lead && best >= GOLIATH_AI.company ? { x: lead.x, y: lead.y } : null;
}

/** Can Goliath `g` walk to within reach of `p` (not across the water)? */
const walkable = (w: World, g: Unit, p: P): boolean => canGetWithin(w, "ground", g.x, g.y, p.x, p.y, 2.5);

/** Our own units standing on an anchoring Goliath's footprint step aside. */
function shoveAside(w: World, faction: Faction, g: Unit, ctx: GoliathContext, cmds: Command[]): void {
  const fr = sideFrame(w, faction);
  for (const u of w.units.values()) {
    if (u.faction !== faction || u.id === g.id || UNITS[u.kind].domain !== "ground" || u.goliath) continue;
    if (dist(u.x, u.y, g.x, g.y) > 1.6) continue;
    if (ctx.used.has(u.id) && u.kind !== "harvester") continue;
    // straight out from its middle (a unit dead on centre: toward our own frame's south)
    let dx = u.x - g.x;
    let dy = u.y - g.y;
    if (dist(0, 0, dx, dy) < 0.05) [dx, dy] = fr.vec(0, 1);
    const n = Math.max(0.05, dist(0, 0, dx, dy));
    const to = inMap(w, { x: g.x + (dx / n) * 3, y: g.y + (dy / n) * 3 });
    const mc = moveClassOf(u.kind);
    if (!passable(w, Math.floor(to.x), Math.floor(to.y), mc) || !canGetWithin(w, mc, u.x, u.y, to.x, to.y, 1)) continue;
    ctx.used.add(u.id);
    cmds.push({ type: "move", faction, unitIds: [u.id], x: to.x, y: to.y });
  }
}

// --- escorts -------------------------------------------------------------

/**
 * Keep Goliath `g`'s escort: top it up from idle army nearby (some anti-air
 * first once enemy air is about), and send whoever strays back to a post
 * round it. Escorts that can't get there (it's on an island) are let go.
 */
function keepEscorts(w: World, faction: Faction, s: AiState, g: Unit, plan: Plan, ctx: GoliathContext, cmds: Command[]): void {
  if (isLifted(g) || g.goliath!.lift || plan.phase === "lift") {
    plan.escorts = [];
    return;
  }
  const reachable = (u: Unit) => canGetWithin(w, moveClassOf(u.kind), u.x, u.y, g.x, g.y, GOLIATH_AI.post + 1);
  const armyIds = new Set(ctx.army.map((u) => u.id));
  const escorts = plan.escorts
    .map((id) => w.units.get(id))
    .filter((u): u is Unit => !!u && armyIds.has(u.id) && reachable(u) && (!ctx.used.has(u.id) || plan.escorts.includes(u.id)));
  plan.escorts = escorts.map((u) => u.id);
  // home from home: the escort stands down when the Goliath guards the base anyway
  const atHome = ctx.hasHq && dist(g.x, g.y, ctx.hqC.x, ctx.hqC.y) < 10;
  const remote = plan.phase === "hold" && plan.site?.kind !== "front";
  const want = atHome ? 0 : UNITS.goliath.cost * GOLIATH_AI.escort * (remote ? 0.6 : 1);
  if (ctx.threatened && ctx.hasHq) {
    plan.escorts = [];
    return;
  }
  // (a free-for-all from 12:00: an escort beyond what's wanted now — taken on for a march, the
  // Goliath home again or dug in at a field — stands down, the nearest kept; else it stood guard
  // all game, never staged, launched or sent on a hunt. Not one walking with the waves: parked at
  // the staging point it counts as home, yet its escort is the company it marches with on a push,
  // and stripped there the army went into the rivals' guns in small waves instead)
  if (ffaTactic(w, "escortTrim") && pastLateSiege(w) && plan.phase !== "siege" && value(escorts) > want) {
    const keep = new Set<number>();
    let v = 0;
    for (const u of [...escorts].sort((a, b) => dist(a.x, a.y, g.x, g.y) - dist(b.x, b.y, g.x, g.y) || a.id - b.id)) {
      if (v >= want) break;
      keep.add(u.id);
      v += UNITS[u.kind].cost;
    }
    // (in their old order: the rest keep their posts)
    escorts.splice(0, escorts.length, ...escorts.filter((u) => keep.has(u.id)));
    plan.escorts = escorts.map((u) => u.id);
  }
  let have = value(escorts);
  const hasAa = escorts.some((u) => aaWeight(UNITS[u.kind]) >= AA_COVER);
  if (have < want) {
    const pool = ctx.army
      // (idle, or on the way to the economy guard: not a wave, not a fight)
      .filter((u) => {
        const o = u.order;
        const free = o.type === "idle" || (o.type === "attackMove" && dist(o.x, o.y, ctx.guardPoint.x, ctx.guardPoint.y) < 2);
        return free && !ctx.used.has(u.id) && u.kind !== "mender" && u.kind !== "scout" && u.kind !== "sniper";
      })
      .filter((u) => dist(u.x, u.y, g.x, g.y) <= GOLIATH_AI.escortReach && reachable(u))
      .sort((a, b) => {
        // anti-air first while the escort has none and the enemy flies
        const aa = (u: Unit) => (!hasAa && s.seenAir >= 1 && aaWeight(UNITS[u.kind]) >= AA_COVER ? 0 : 1);
        return aa(a) - aa(b) || dist(a.x, a.y, g.x, g.y) - dist(b.x, b.y, g.x, g.y) || a.id - b.id;
      });
    for (const u of pool) {
      if (have >= want) break;
      escorts.push(u);
      plan.escorts.push(u.id);
      have += UNITS[u.kind].cost;
    }
  }
  if (escorts.length === 0) return;
  const fr = sideFrame(w, faction);
  const G = fr.toFrame(g);
  escorts.forEach((u, i) => {
    ctx.used.add(u.id);
    if (u.order.type === "attack" || u.autoTargetId !== null) return; // (in a fight: let it)
    const a = (i * 2 * Math.PI) / Math.max(3, escorts.length) + 0.4;
    let post = fr.toWorld({ x: G.x + sin(a) * GOLIATH_AI.post, y: G.y - cos(a) * GOLIATH_AI.post });
    if (moveClassOf(u.kind) !== "air" && !passable(w, Math.floor(post.x), Math.floor(post.y), moveClassOf(u.kind))) post = { x: g.x, y: g.y };
    if (dist(u.x, u.y, post.x, post.y) <= 3.5) return;
    const o = u.order;
    if ((o.type === "attackMove" || o.type === "move") && dist(o.x, o.y, post.x, post.y) <= 2) return;
    cmds.push({ type: "attackMove", faction, unitIds: [u.id], x: post.x, y: post.y });
  });
}

// --- the lift ------------------------------------------------------------

/** Anti-air (Flak-weighted) the lift reckons with along a straight leg: clear when nothing above GOLIATH_AI.liftAa covers it. */
function liftAirspace(w: World, faction: Faction, seen: readonly Sighting[]) {
  const sources = aaSources(w, faction, seen);
  // (under Robot Love a lift never flies within loveGap of an enemy Goliath: a meeting is a draw)
  const love = rulesOf(w).robotLove ? seen.filter((e) => e.kind === "goliath") : [];
  const covered = (x: number, y: number) =>
    aaStrengthAt(sources, x, y) > GOLIATH_AI.liftAa || love.some((e) => dist(e.x, e.y, x, y) < GOLIATH_AI.loveGap);
  const clear = (ax: number, ay: number, bx: number, by: number) => {
    const n = Math.max(1, Math.ceil(dist(ax, ay, bx, by)));
    for (let i = 1; i <= n; i++) if (covered(ax + ((bx - ax) * i) / n, ay + ((by - ay) * i) / n)) return false;
    return true;
  };
  return { covered, clear };
}

/** The nearest ground a Goliath can stand on to (x, y), within 12 tiles (frame order for ties), or null. */
function nearestLand(w: World, faction: Faction, p: P): P | null {
  const fr = sideFrame(w, faction);
  const q = fr.toFrame(p);
  let best: P | null = null;
  let bestD = Infinity;
  for (let dy = -12; dy <= 12; dy++)
    for (let dx = -12; dx <= 12; dx++) {
      const fx = Math.floor(q.x) + dx;
      const fy = Math.floor(q.y) + dy;
      if (fx < 0 || fy < 0 || fx >= w.width || fy >= w.height) continue;
      const [tx, ty] = fr.tile(fx, fy, 1);
      if (!passable(w, tx, ty, "ground")) continue;
      const d = dist(fx + 0.5, fy + 0.5, q.x, q.y);
      if (d >= bestD - 1e-9) continue;
      bestD = d;
      best = { x: tx + 0.5, y: ty + 0.5 };
    }
  return best;
}

/**
 * The lift, step by step: pack up if dug in; hold two free Condors (more are
 * built: liftWantsCondors); hook on once the way there is clear of anti-air;
 * fly (by a flank waypoint if need be) and set down at the site; hurt on the
 * way, or anti-air turning up on the route, set down on the nearest land at
 * once. Orders go to the Goliath (lift.ts routes them), never to a Condor
 * still hooking on (that would call the lift off).
 */
function liftStep(w: World, faction: Faction, s: AiState, g: Unit, plan: Plan, ctx: GoliathContext, m: Memo, cmds: Command[]): void {
  const gs = g.goliath!;
  const lift = gs.lift;
  // carried with nowhere to go yet (a Goliath Armada start): a site first, flown to, rather
  // than down where it hangs (each picks clear of the sites the others took)
  if (lift?.phase === "carrying" && !plan.site && !plan.landing && !lift.setDown) {
    plan.site = chooseSite(w, faction, s, g, ctx, m);
    if (plan.site) setPhase(w, plan, "lift");
  }
  const site = plan.site;
  const release = () => {
    plan.carriers = [];
    plan.launchHp = [];
    plan.lifting = false;
    plan.origin = null;
    plan.landing = null;
    plan.waypoint = null;
  };
  if (!lift) {
    if (plan.lifting) {
      // set down (or the lift was called off, or a Condor went down): walk the rest, or think again
      release();
      if (site && dist(g.x, g.y, site.at.x, site.at.y) <= 3 && canWalk(g)) {
        setPhase(w, plan, "march");
        cmds.push({ type: "move", faction, unitIds: [g.id], x: site.at.x, y: site.at.y });
        plan.moved = w.tick;
      } else setPhase(w, plan, "muster");
      return;
    }
    if (!site) {
      release();
      setPhase(w, plan, "muster");
      return;
    }
    if (gs.mode === "anchored" || gs.mode === "anchoring") {
      cmds.push({ type: "packUp", faction, unitIds: [g.id] });
      return;
    }
    if (gs.mode !== "walking") return;
    const late = w.tick - plan.since > GOLIATH_AI.liftWait * TICK_RATE;
    const giveUp = () => {
      avoidSite(w, m, site);
      release();
      plan.noLift = w.tick + GOLIATH_AI.liftRetry * TICK_RATE;
      setPhase(w, plan, "muster");
    };
    // a clear way there first (the Condors are only held once there is one: the airlift needs them)
    const { covered, clear } = liftAirspace(w, faction, ctx.seen);
    const wp = covered(site.at.x, site.at.y) ? undefined : route(w, g, site.at, clear);
    if (wp === undefined) {
      plan.carriers = [];
      if (late) giveUp();
      return;
    }
    // hold two Condors
    plan.carriers = plan.carriers.filter((id) => {
      const c = w.units.get(id);
      return !!c && canCarry(c) && !isLoaded(c);
    });
    if (plan.carriers.length < 2)
      for (const c of freeCondors(w, faction, s, g, m)) {
        if (plan.carriers.length >= 2) break;
        if (!plan.carriers.includes(c.id)) plan.carriers.push(c.id);
      }
    if (plan.carriers.length < 2) {
      if (late) giveUp();
      return;
    }
    cmds.push({ type: "lift", faction, unitIds: [...plan.carriers], goliathId: g.id });
    plan.lifting = true;
    plan.origin = { x: g.x, y: g.y };
    plan.landing = null;
    plan.liftTick = w.tick;
    plan.launchHp = plan.carriers.map((id) => w.units.get(id)!.hp);
    plan.waypoint = wp;
    return;
  }
  // it's ours to steer now: the lift's own Condors
  plan.lifting = true;
  if (plan.carriers.length < 2) plan.carriers = [...lift.carriers];
  if (lift.phase === "hooking") {
    if (w.tick - plan.liftTick > GOLIATH_AI.liftHook * TICK_RATE) {
      // the Condors never got there: call it off (a stop to a Condor still hooking on does)
      cmds.push({ type: "stop", faction, unitIds: [...lift.carriers] });
      avoidSite(w, m, site);
      release();
      setPhase(w, plan, "muster");
    }
    return;
  }
  // carrying: called off already? Down where it was sent
  const setDownAt = (p: P) => {
    if (!(lift.setDown && lift.dest && dist(lift.dest.x, lift.dest.y, p.x, p.y) < 0.5))
      cmds.push({ type: "unload", faction, unitIds: [g.id], x: p.x, y: p.y });
  };
  if (plan.landing) {
    setDownAt(plan.landing);
    return;
  }
  // (each against its own HP at launch: the sim may hook the pair on the other way round)
  const hurt = lift.carriers.some((id) => {
    const c = w.units.get(id);
    return !c || c.hp < (plan.launchHp[plan.carriers.indexOf(id)] ?? UNITS.condor.hp) - UNITS.condor.hp * GOLIATH_AI.liftAbort;
  });
  const { covered, clear } = liftAirspace(w, faction, ctx.seen);
  const goal = site?.at ?? null;
  /** Call it off: down at `p` (or, nothing given, the nearest land) and think again. */
  const callOff = (p: P | null) => {
    const to = p ?? nearestLand(w, faction, g);
    avoidSite(w, m, site);
    plan.waypoint = null;
    if (!to) {
      cmds.push({ type: "move", faction, unitIds: [g.id], x: ctx.hqC.x, y: ctx.hqC.y }); // (open sea all round: head home)
      return;
    }
    plan.landing = to;
    setDownAt(to);
  };
  // hurt (a Condor going down drops it): down on the nearest land, now
  if (hurt || !goal) {
    callOff(null);
    return;
  }
  // anti-air at the site, or no clear way on from here: back where it came from (or the nearest land)
  if (plan.waypoint && !(clear(g.x, g.y, plan.waypoint.x, plan.waypoint.y) && clear(plan.waypoint.x, plan.waypoint.y, goal.x, goal.y)))
    plan.waypoint = null;
  if (!plan.waypoint && (covered(goal.x, goal.y) || !clear(g.x, g.y, goal.x, goal.y))) {
    const wp = covered(goal.x, goal.y) ? undefined : route(w, g, goal, clear);
    if (wp) plan.waypoint = wp;
    else {
      const back = plan.origin && clear(g.x, g.y, plan.origin.x, plan.origin.y) ? plan.origin : null;
      callOff(back);
      return;
    }
  }
  if (lift.setDown) return; // on its way down at the site
  if (plan.waypoint) {
    if (dist(g.x, g.y, plan.waypoint.x, plan.waypoint.y) > 1.5) {
      if (!lift.dest || dist(lift.dest.x, lift.dest.y, plan.waypoint.x, plan.waypoint.y) > 0.5)
        cmds.push({ type: "move", faction, unitIds: [g.id], x: plan.waypoint.x, y: plan.waypoint.y });
      return;
    }
    plan.waypoint = null;
  }
  cmds.push({ type: "unload", faction, unitIds: [g.id], x: goal!.x, y: goal!.y });
}

// --- the push (a free-for-all) ---------------------------------------------

/** What a free-for-all's push marches on: the focus rival's base Goliath, or its HQ. */
export interface PushTarget extends P {
  id: number;
  /** Its HQ (a classic free-for-all), not a Goliath. */
  building: boolean;
}

export interface PushContext {
  /** The rival we're out to beat (none in a duel: no push). */
  focus: Faction | null;
  seen: Unit[];
  armyValue: number;
  mode: AiMode;
  /** The focus's HQ, where we know it stands. */
  enemyHq: KnownBuilding | null;
  /** The focus's home corner (where its HQ stands, or would). */
  enemyHome: P;
}

/**
 * A free-for-all's push (ai/ffa.ts). From GOLIATH_AI.lateSiege, in an
 * assault, our Goliaths walking with the waves (phase siege, at
 * GOLIATH_AI.siegeRetreat health or better) and the whole army march on the
 * focus's base once together they outgun what holds it (defenceAt)
 * GOLIATH_AI.pushEdge times over, an edge that wears down to pushFloor as
 * the match drags on, and pushHold once they're on their way. Its base is
 * its HQ where we know it stands (FFA_TACTICS.pushHq: a classic
 * free-for-all), else its base Goliath: the first dug in, nearest its home
 * corner (a Goliath is always in sight). One no walker of ours can walk to
 * (across the water, or on a lift) is passed over for the next; the first
 * they can reach decides (outgunned there, no push), and with none left the
 * push is off: the Goliaths walk with the waves as before.
 *
 * Returns the target and the lead walker (the nearest that can get there:
 * the army gathers on it, and the waves go once it is GOLIATH_AI.pushNear
 * from the target), or null. The target is noted in `s.push`: the focus
 * holds while a push is on (commander.ts pickFocus), so a march isn't
 * turned round halfway by the focus moving on.
 */
export function planPush(w: World, faction: Faction, s: AiState, ctx: PushContext): { target: PushTarget; lead: Unit } | null {
  const push = findPush(w, faction, s, ctx);
  // (only once there has been a push: a duel's AiState is never touched)
  if (push || s.push !== undefined) s.push = push?.target.id;
  return push;
}

function findPush(w: World, faction: Faction, s: AiState, ctx: PushContext): { target: PushTarget; lead: Unit } | null {
  if (!ctx.focus || !ffaTactic(w, "push") || ctx.mode !== "assault" || !pastLateSiege(w)) return null;
  // (rules with HQs, a classic free-for-all: only by its own switch)
  if (!goliathBase(w) && !FFA_TACTICS.pushHq) return null;
  const m = memos.get(s);
  if (!m) return null;
  const walkers = goliathsOf(w, faction)
    .filter((g) => m.plans.get(g.id)?.phase === "siege" && canWalk(g) && hpShare(g) >= GOLIATH_AI.siegeRetreat)
    .sort(byId);
  if (walkers.length === 0) return null;
  const minutes = w.tick / TICK_RATE / 60 - GOLIATH_AI.lateSiege;
  const edge = Math.max(GOLIATH_AI.pushFloor, GOLIATH_AI.pushEdge - GOLIATH_AI.pushDecay * minutes);
  for (const target of pushTargets(ctx)) {
    const able = walkers.filter((g) => walkable(w, g, target));
    if (able.length === 0) continue; // (none of ours can walk there: the next)
    const ours = ctx.armyValue + able.reduce((v, g) => v + threatValue(g), 0);
    const need = s.push === target.id ? Math.min(edge, GOLIATH_AI.pushHold) : edge;
    if (ours < need * defenceAt(w, faction, ctx.seen, target)) return null;
    const lead = able.sort((a, b) => dist(a.x, a.y, target.x, target.y) - dist(b.x, b.y, target.x, target.y) || a.id - b.id)[0]!;
    return { target, lead };
  }
  return null;
}

/**
 * What a push may march on, best first: the focus's HQ where we know it
 * stands (pushHq), else its Goliaths (not one in the air on a lift), dug in
 * first, nearest its home corner.
 */
function pushTargets(ctx: PushContext): PushTarget[] {
  if (ctx.enemyHq) {
    if (!FFA_TACTICS.pushHq) return [];
    return [{ id: ctx.enemyHq.id, ...kbCentre(ctx.enemyHq), building: true }];
  }
  const home = ctx.enemyHome;
  return ctx.seen
    .filter((e) => e.faction === ctx.focus && !!e.goliath && !isLifted(e))
    .sort(
      (a, b) =>
        (isAnchored(b) ? 1 : 0) - (isAnchored(a) ? 1 : 0) || dist(a.x, a.y, home.x, home.y) - dist(b.x, b.y, home.x, home.y) || a.id - b.id
    )
    .map((e) => ({ id: e.id, x: e.x, y: e.y, building: false }));
}

/**
 * What holds a spot: the enemy firepower we see within GOLIATH_AI.danger of
 * it (threatValue: a Goliath by what it can still fire), and the known
 * armed buildings there, at their price.
 */
function defenceAt(w: World, faction: Faction, seen: readonly Unit[], p: P): number {
  let v = enemyNear(seen, p, GOLIATH_AI.danger);
  for (const kb of knownBuildings(w, faction)) {
    const c = kbCentre(kb);
    if (BUILDINGS[kb.kind].dps > 0 && dist(c.x, c.y, p.x, p.y) <= GOLIATH_AI.danger) v += BUILDINGS[kb.kind].cost;
  }
  return v;
}

/**
 * Is the match past GOLIATH_AI.lateSiege? A free-for-all's stalemate tactics
 * (ai/ffa.ts: the push, wave hygiene, the escort trim, the calldown aim) start
 * there, and leave the opening's four-way brawl as it was.
 */
export const pastLateSiege = (w: World): boolean => w.tick >= GOLIATH_AI.lateSiege * 60 * TICK_RATE;

/** Is Goliath `id` walking with the waves (phase siege) by its plan? (commander.ts counts it toward a staged wave.) */
export function sieging(s: AiState, id: number): boolean {
  return memos.get(s)?.plans.get(id)?.phase === "siege";
}

// --- hunting enemy Goliaths ----------------------------------------------

export interface HuntContext {
  army: Unit[];
  used: Set<number>;
  seen: Unit[];
  enemyHqPos: P;
  mode: AiMode;
  threatened: boolean;
}

/**
 * Strikes on enemy Goliaths (always in sight): for each (by id), idle units
 * within GOLIATH_AI.huntReach that can hurt it and get at it, worth
 * GOLIATH_AI.huntEdge times what it can still do (threatValue, plus the
 * escort round it; less while a weapon is down), go for it — those that can
 * hit aircraft take its Menders first. One carried by Condors is struck
 * through its weaker Condor. Not one dug in under its own base's guns
 * (that's a wave's job), and not while our base is under attack. Strikers
 * stay on it (goliathHolds) until it, or they, are done.
 */
export function huntGoliaths(w: World, faction: Faction, s: AiState, ctx: HuntContext): Command[] {
  const cmds: Command[] = [];
  const m = memo(s);
  // strikes under way: those still on it stay claimed
  for (const [eid, h] of m.hunts) {
    const e = w.units.get(eid);
    if (!e) {
      m.hunts.delete(eid);
      continue;
    }
    h.ids = h.ids.filter((id) => {
      const u = w.units.get(id);
      return !!u && u.order.type === "attack";
    });
    if (h.ids.length === 0 && w.tick - h.tick > GOLIATH_AI.huntEvery * TICK_RATE) m.hunts.delete(eid);
    for (const id of h.ids) ctx.used.add(id);
  }
  if (ctx.threatened) return cmds;
  const known = knownBuildings(w, faction);
  const foes = ctx.seen.filter((e) => !!e.goliath).sort(byId);
  for (const e of foes) {
    const h = m.hunts.get(e.id);
    if (h && w.tick - h.tick < GOLIATH_AI.huntEvery * TICK_RATE) continue;
    const homeGuns = dist(e.x, e.y, ctx.enemyHqPos.x, ctx.enemyHqPos.y) < GOLIATH_AI.enemyHome && underGuns(known, e, 1);
    if (homeGuns && ctx.mode !== "assault") continue;
    const lifted = isLifted(e);
    const carriers = lifted ? e.goliath!.lift!.carriers.map((id) => w.units.get(id)).filter((c): c is Unit => !!c) : [];
    // a carried Goliath: down its weaker Condor (over water, that's the Goliath too)
    const mark = lifted ? [...carriers].sort((a, b) => a.hp - b.hp || a.id - b.id)[0] ?? e : e;
    const domain = domainOf(mark);
    const escortValue = ctx.seen.reduce((v, o) => (o.id !== e.id && !o.goliath && UNITS[o.kind].dps > 0 && dist(o.x, o.y, e.x, e.y) <= 6 ? v + UNITS[o.kind].cost : v), 0);
    let need = (lifted ? UNITS.condor.cost * 2 : threatValue(e) + escortValue) * GOLIATH_AI.huntEdge;
    if (weaponsDown(e).length > 0) need *= GOLIATH_AI.huntWeak;
    need = Math.max(need, GOLIATH_AI.huntMin);
    const armour = UNITS[mark.kind].armor;
    const able = ctx.army
      .filter((u) => !ctx.used.has(u.id) && u.order.type === "idle" && u.kind !== "mender")
      .filter((u) => dist(u.x, u.y, e.x, e.y) <= GOLIATH_AI.huntReach)
      .sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y) || a.id - b.id);
    // its Menders first (a mended Goliath never goes down): a couple of units that can hit each
    const menders = lifted
      ? []
      : ctx.seen
          .filter((o) => UNITS[o.kind].heal && dist(o.x, o.y, e.x, e.y) <= 4)
          .sort((a, b) => dist(a.x, a.y, e.x, e.y) - dist(b.x, b.y, e.x, e.y) || a.id - b.id)
          .slice(0, 2);
    const onMender = new Map<number, number[]>();
    const strike: Unit[] = [];
    const taken = new Set<number>();
    for (const md of menders) {
      const ids = able
        .filter((u) => !taken.has(u.id) && effectivenessVs(u.kind, UNITS[md.kind].armor, domainOf(md)) >= USELESS && engageable(w, u, md.id))
        .slice(0, GOLIATH_AI.medicHunters);
      for (const u of ids) {
        taken.add(u.id);
        strike.push(u);
      }
      if (ids.length > 0) onMender.set(md.id, ids.map((u) => u.id));
    }
    // then what it takes to bring the Goliath down
    let v = 0;
    const onIt: number[] = [];
    for (const u of able) {
      if (v >= need) break;
      if (taken.has(u.id) || effectivenessVs(u.kind, armour, domain) < USELESS || !engageable(w, u, mark.id)) continue;
      onIt.push(u.id);
      strike.push(u);
      v += UNITS[u.kind].cost;
    }
    if (v < need) continue;
    for (const [id, ids] of onMender) cmds.push({ type: "attack", faction, unitIds: ids, targetId: id });
    cmds.push({ type: "attack", faction, unitIds: onIt, targetId: mark.id });
    for (const u of strike) ctx.used.add(u.id);
    m.hunts.set(e.id, { tick: w.tick, ids: strike.map((u) => u.id) });
    break; // (one new strike a pass)
  }
  return cmds;
}

/**
 * Enemy Gantries known to have a Goliath on the cradle (public: the build
 * shows on the model, GOLIATH.md), and how far along each is.
 */
export function enemyGantryBuilds(w: World, faction: Faction): { id: number; x: number; y: number; progress: number }[] {
  const out: { id: number; x: number; y: number; progress: number }[] = [];
  for (const kb of knownBuildings(w, faction)) {
    if (kb.kind !== "gantry") continue;
    const head = w.buildings.get(kb.id)?.queue[0];
    if (!head || head.kind !== "goliath") continue;
    const total = UNITS.goliath.buildTime * TICK_RATE;
    const c = kbCentre(kb);
    out.push({ id: kb.id, x: c.x, y: c.y, progress: 1 - head.remaining / total });
  }
  return out;
}

/** Is the enemy HQ known to be gone (its spot seen empty)? Then its Goliaths are what's left to beat. */
export function enemyHqGone(w: World, faction: Faction, enemyHqGuess: P): boolean {
  if (knownBuildings(w, faction).some((kb) => kb.kind === "hq")) return false;
  return isVisible(w, faction, Math.floor(enemyHqGuess.x), Math.floor(enemyHqGuess.y));
}

/** The Goliath plans' phases (tests and tools). */
export function goliathPhases(s: AiState): Map<number, string> {
  const m = memos.get(s);
  return new Map([...(m?.plans ?? new Map<number, Plan>())].map(([id, p]) => [id, p.phase]));
}

/** A Goliath's site as the plan sees it (tests and tools). */
export function goliathSite(s: AiState, id: number): { kind: string; x: number; y: number; lift: boolean } | null {
  const site = memos.get(s)?.plans.get(id)?.site;
  return site ? { kind: site.kind, x: site.at.x, y: site.at.y, lift: site.lift } : null;
}
