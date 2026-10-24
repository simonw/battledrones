/** The sides: blue and red in every match; green and purple join them on a four-player map (sides.ts). */
export type Faction = "blue" | "red" | "green" | "purple";
/**
 * A value for each side playing: blue's and red's always, green's and
 * purple's when a four-player map adds them (records, recaps, reports). The
 * world's own per-side state is a full Record<Faction, …> (sides.ts perSide).
 */
export type PerSide<T> = Record<"blue" | "red", T> & Partial<Record<"green" | "purple", T>>;
export type Domain = "ground" | "air";
export type TargetDomain = "ground" | "air" | "both" | "none";

export type UnitKind =
  | "harvester"
  | "scout"
  | "stinger"
  | "flak-crawler"
  | "mortar"
  | "mastodon"
  | "lancer"
  | "wasp"
  | "raptor"
  | "hornet"
  | "mender"
  // robot infantry (INFANTRY.md): each is ONE sim unit drawn as UNITS[kind].squad robots
  | "trooper"
  | "rocket-squad"
  | "sniper"
  /** Dropship: carries two infantry squads, unarmed. */
  | "condor"
  /**
   * Giant walking mech and mobile base (GOLIATH.md, goliath.ts): four weapon
   * systems it loses as it takes damage, and anchored, a drop-off, a build
   * ring and infantry training. Built at the Gantry.
   */
  | "goliath";

export type BuildingKind =
  | "hq"
  | "fab-plant"
  | "airpad"
  | "tech-lab"
  | "depot"
  | "turret"
  | "sam-site"
  | "radar"
  /** Builds robot infantry. */
  | "assembly-bay"
  /** Top of the tree: builds the Goliath (one per side, always visible to the enemy). */
  | "gantry";

/** Armor classes: weapons deal a damage-type-specific multiple vs each. */
export type ArmorClass = "light" | "medium" | "heavy" | "structure" | "infantry";

/** Damage types, each with a multiplier row in `DAMAGE_VS` (balance.ts). */
export type DamageType = "kinetic" | "cannon" | "flak" | "missile" | "explosive" | "laser" | "precision";

/** How a weapon looks when it fires (render-only hint carried on fx). */
export type WeaponFx =
  | "cannon"
  | "heavy-cannon"
  | "flak"
  | "rockets"
  | "missile"
  | "laser"
  | "shell"
  | "bomb"
  | "mg"
  /** Trooper rifles: a crackle of light tracers from each robot standing. */
  | "rifle"
  /** Sniper rail-rifle: one bright, instant streak. */
  | "snipe";

export const enum Terrain {
  Ground = 0,
  Rock = 1,
  Scrap = 2,
  /** Deep water (or lava): blocks tracked/wheeled units; hover and air cross. */
  Water = 3,
  /** Paved road: faster ground movement. */
  Road = 4,
  /** Mud, scree, slush: slow for wheels/tracks, hover glides over. */
  Rough = 5,
  /** Woods: slow for everyone on the ground, and cover (less damage taken). */
  Forest = 6,
  /** Rich crystal field: harvests into more scrap per load. */
  Crystal = 7,
  /** Bridge deck over water: a road that can't be built on. */
  Bridge = 8,
  /** Shallow ford: slow for ground units, open to hover. */
  Shallows = 9,
  /** Open sea: too deep and rough for anything but aircraft (hover included). */
  Deep = 10
}

/** Harvester internal cycle state. */
export type HarvestPhase = "toField" | "harvesting" | "toBase" | "unloading";

export type UnitOrder =
  | { type: "idle" }
  | { type: "move"; x: number; y: number }
  | { type: "attackMove"; x: number; y: number }
  | { type: "attack"; targetId: number }
  | { type: "harvest"; fieldX: number; fieldY: number; phase: HarvestPhase }
  /**
   * Infantry: walk to Condor `carrierId` and climb aboard (transport.ts).
   * `ticks` counts up while the squad is within boarding range; at
   * INFANTRY.boardTime it is taken off the map into the Condor.
   */
  | { type: "board"; carrierId: number; ticks: number }
  /**
   * Condor: fly to (x, y) — already snapped to the nearest tile infantry can
   * stand on — hover for INFANTRY.unloadHover, then drop every passenger.
   * `hover` is -1 while flying, then counts ticks spent hovering.
   */
  | { type: "unload"; x: number; y: number; hover: number }
  /**
   * Condor: one of the two carrying Goliath `goliathId` (lift.ts). The lift
   * moves it; tickMovement leaves it alone.
   */
  | { type: "lift"; goliathId: number };

/** The Goliath's weapon systems (goliath.ts). The machine guns never go offline. */
export type GoliathWeapon = "mortars" | "laser" | "cannons" | "mg";

/** Walking ⇄ anchored, through the timed transitions between them (goliath.ts). */
export type GoliathMode = "walking" | "anchoring" | "anchored" | "packing";

export interface GoliathWeaponState {
  /** Firing. False while lost to damage, and through the reboot that brings it back. */
  online: boolean;
  /** Ticks left of the reboot that brings it back online (−1: not rebooting). */
  reboot: number;
  /** Ticks until this weapon may fire again. */
  cooldown: number;
  /** What it is shooting at (picked per weapon), or null. */
  targetId: number | null;
  /** Tick it last fired (renderer: recoil, muzzle flash). */
  firedTick: number;
}

/** Two Condors carrying a walking Goliath (lift.ts). */
export interface GoliathLift {
  /** The two Condors (each on a `lift` order naming this Goliath). */
  carriers: [number, number];
  /** "hooking": the Condors are flying in to hook on; "carrying": it is off the ground. */
  phase: "hooking" | "carrying";
  /** Where the lift is flying (null: hovering where it is). */
  dest: { x: number; y: number } | null;
  /** On arrival at `dest`, set the Goliath down (else hover there). */
  setDown: boolean;
}

/** Everything a Goliath carries beyond a plain unit (Unit.goliath; goliath.ts). */
export interface GoliathState {
  mode: GoliathMode;
  /** Ticks left of an anchoring or packing transition (0 once settled). */
  modeTicks: number;
  weapons: Record<GoliathWeapon, GoliathWeaponState>;
  /** Infantry training queue: advances only while anchored. */
  queue: QueueItem[];
  rally: { x: number; y: number } | null;
  /** Two Condors hooking on or carrying it, or null. */
  lift: GoliathLift | null;
  /**
   * Dug in (anchoring, anchored or packing up): the top-left tile of the
   * GOLIATH.footprint² it stands on, stamped with its id in World.occupancy
   * so paths go round it like a building. null while it walks.
   */
  foot: { tx: number; ty: number } | null;
}

export interface Unit {
  id: number;
  kind: UnitKind;
  faction: Faction;
  /** Position in tile units (floats); the unit's centre. */
  x: number;
  y: number;
  hp: number;
  /** Hull facing angle in radians, 0 = North (up), clockwise. */
  facing: number;
  /** Weapon aim angle (turrets track this independently of the hull). */
  aim: number;
  order: UnitOrder;
  /** Remaining path waypoints in tile coords (ground units). */
  path: { x: number; y: number }[] | null;
  /** Destination the current path was computed for (invalidation check). */
  pathGoal: { x: number; y: number } | null;
  /** Scrap carried (harvesters). */
  cargo: number;
  /** Ticks until this unit may fire again. */
  cooldown: number;
  /** Current auto-acquired target while attack-moving/idling. */
  autoTargetId: number | null;
  /** Tick this unit last took damage (drives harvester flee behaviour). */
  damagedTick: number;
  /** Who last hurt us (unit or building id) — idle units retaliate. */
  lastAttackerId: number | null;
  /**
   * The side of whoever last hurt us, kept with the hit: a free-for-all's kill credit when no unit
   * or building of theirs is left to say (a calldown has none to point at; a shell outlives its gun).
   */
  lastAttackerSide?: Faction | null;
  /** Tick this unit last fired (renderer: recoil, turret settle). */
  firedTick: number;
  /** Combat experience: scrap value of enemies destroyed. */
  xp: number;
  /** Veterancy rank 0–3 (derived from xp); boosts damage. */
  rank: number;
  /** Enemy units and buildings this unit has destroyed. */
  kills: number;
  /**
   * Condor only: the infantry squads aboard (at most INFANTRY.capacity).
   * Passengers are taken OUT of `World.units` while aboard — hidden, unable
   * to fire, no vision, no presence — and put back (same id) when dropped.
   * Absent on every other unit.
   */
  passengers?: Unit[];
  /**
   * A target this unit found it can't get in range of (across the water), left
   * alone until `until` (tick) so it fights what it can reach meanwhile.
   */
  ignore?: { id: number; until: number };
  /**
   * Handed out by the map, not bought: the island map's starting Condor and
   * the free replacement Condor with its squad (lifeline.ts). A free unit
   * leaves no wreck and its loss charges no one's ⚡ meter, so throwing one
   * away gains nothing.
   */
  free?: boolean;
  /** Goliath only: its modes, weapon systems, training queue and lift (goliath.ts). Absent on every other unit. */
  goliath?: GoliathState;
}

export interface QueueItem {
  kind: UnitKind;
  /** Ticks of build time remaining. */
  remaining: number;
  /** Scrap paid, when it isn't the kind's list price (a Goliath's escalating cost): what a cancel refunds. */
  paid?: number;
}

export interface Building {
  id: number;
  kind: BuildingKind;
  faction: Faction;
  /** Top-left tile of the footprint. */
  tx: number;
  ty: number;
  hp: number;
  queue: QueueItem[];
  rally: { x: number; y: number } | null;
  /** Turret head facing, radians clockwise from North. */
  facing: number;
  cooldown: number;
  damagedTick: number;
  lastAttackerId: number | null;
  /** The side of whoever last hurt it (Unit.lastAttackerSide). */
  lastAttackerSide?: Faction | null;
  firedTick: number;
  /**
   * Placed in the build ring of an anchored Goliath, out of normal build range
   * (goliath.ts). It works like any other building, but never counts as base
   * for build range: nothing can be built off it. Decided when it is placed.
   */
  outpost?: boolean;
}

/** A building being constructed C&C-style (timer in the "sidebar"). */
export interface PendingBuilding {
  kind: BuildingKind;
  remaining: number;
  ready: boolean;
}

export interface FactionStats {
  unitsBuilt: number;
  unitsLost: number;
  unitsKilled: number;
  buildingsLost: number;
  /** Enemy buildings destroyed (by anything this faction owns). */
  buildingsKilled: number;
  scrapHarvested: number;
  /** Scrap collected from battlefield wrecks (salvage.ts). */
  scrapSalvaged: number;
}

export interface FactionState {
  scrap: number;
  /** At most one building under construction at a time (C&C rule). */
  pending: PendingBuilding | null;
  stats: FactionStats;
  /** Multiplier on harvested scrap (AI difficulty handicap/bonus). */
  incomeMult: number;
}

/** A simulated slow projectile (artillery shell, bomb): dodgeable. */
export interface Projectile {
  id: number;
  faction: Faction;
  fx: WeaponFx;
  /** Launch point, current point, and ground impact point (tiles). */
  sx: number;
  sy: number;
  x: number;
  y: number;
  tx: number;
  ty: number;
  /** Tiles per tick. */
  speed: number;
  damage: number;
  splash: number;
  dmgType: DamageType;
  targets: TargetDomain;
  sourceId: number;
  /** Launched from the air (bombs fall rather than arc). */
  fromAir: boolean;
}

export type FxEvent =
  | {
      type: "shot";
      fx: WeaponFx;
      x: number;
      y: number;
      tx: number;
      ty: number;
      /** Shooter / target are airborne (for render altitude). */
      fromAir: boolean;
      air: boolean;
      sourceId: number;
    }
  | { type: "explosion"; x: number; y: number; size: number; air: boolean; kind: "unit" | "building" | "impact" }
  | { type: "heal"; x: number; y: number; tx: number; ty: number; sourceId: number; targetId: number }
  | { type: "built"; faction: Faction; id: number }
  | { type: "sold"; id: number }
  | {
      type: "hit";
      /** Victim's faction, id and position. */
      faction: Faction;
      id: number;
      x: number;
      y: number;
      building: boolean;
      /** Who dealt the damage (may already be dead next tick). */
      attackerId: number;
    }
  | { type: "rankUp"; id: number }
  | {
      /**
       * Something was destroyed. Emitted once per death alongside the
       * visual "explosion" event, with everything feedback, stats and
       * awards need (the entity is already gone from the world).
       */
      type: "death";
      id: number;
      /** The victim's faction; the kill is credited to the other one. */
      faction: Faction;
      unitKind: UnitKind | null;
      buildingKind: BuildingKind | null;
      x: number;
      y: number;
      air: boolean;
      /** Scrap value of what died (HQs count 500). */
      value: number;
      /** Killer unit/building id if it is still alive this tick, else null. */
      killerId: number | null;
      /** The killer's unit kind, when the killer is a living unit. */
      killerKind: UnitKind | null;
      /** Victim's veterancy rank and kill count at death (0 for buildings). */
      rank: number;
      kills: number;
      /** A map-given unit (Unit.free): its loss charges no ⚡ meter. */
      free?: boolean;
      /** A free-for-all: the killer's side, when it was on the map to say (absent in a duel: the other side). */
      by?: Faction | null;
    }
  | {
      /**
       * A free-for-all: `faction` is out (its HQ and every Goliath gone, or it
       * resigned), finished off by `by`; `left` sides remain (combat.ts eliminate).
       */
      type: "eliminated";
      faction: Faction;
      by: Faction | null;
      left: number;
    }
  | {
      /** A harvester started unloading `amount` scrap at a drop-off. */
      type: "deposit";
      faction: Faction;
      id: number;
      x: number;
      y: number;
      amount: number;
    }
  | {
      /** Last Stand: wave `wave` lands in `eta` ticks at (x, y), entering from `dir`. */
      type: "waveIncoming";
      wave: number;
      theme: WaveTheme;
      name: string;
      x: number;
      y: number;
      dir: string;
      eta: number;
      /** Scrap paid because the defender called this wave early (0 if not). */
      early: number;
    }
  | { type: "waveSpawned"; wave: number; theme: WaveTheme; name: string; x: number; y: number; count: number }
  | {
      /** Last Stand: every wave unit is dead; the defender got `bonus` scrap. */
      type: "waveCleared";
      wave: number;
      bonus: number;
      next: string;
      nextTheme: WaveTheme;
    }
  | {
      /** A ground unit scooped up a wreck: `value` scrap (after incomeMult) went to `faction`. */
      type: "salvage";
      faction: Faction;
      x: number;
      y: number;
      value: number;
      wreckId: number;
      /** The collecting unit (or the building placed on top of the wreck). */
      collectorId: number;
    }
  | {
      /**
       * A commander calldown was fired (powers.ts). Public: both sides see
       * the telegraph through the fog. It lands at `landTick`.
       */
      type: "calldown";
      id: number;
      faction: Faction;
      power: PowerKind;
      x: number;
      y: number;
      radius: number;
      landTick: number;
    }
  | {
      /**
       * A calldown landed: one per Barrage shell; the EMP pulse; the Drop
       * Pod touching down (`unitIds` = its crew); the Sky Hammer strike.
       * `hits` = enemy units and buildings it damaged or stunned.
       */
      type: "calldownImpact";
      id: number;
      faction: Faction;
      power: PowerKind;
      x: number;
      y: number;
      radius: number;
      hits: number;
      unitIds: number[];
    }
  | {
      /** EMP: these entities (of `faction`) can't move, fire or produce until `until`. */
      type: "stun";
      faction: Faction;
      ids: number[];
      x: number;
      y: number;
      until: number;
    }
  | {
      /** A power just came online for `faction` (the Sky Hammer at 6:00). */
      type: "powerOnline";
      faction: Faction;
      power: PowerKind;
    }
  | {
      /**
       * An Uplink changed hands (objectives.ts): `owner` took it (from
       * neutral), or `owner` is null when `prev` lost it to a neutralising
       * push by `by`. Public: both sides see it.
       */
      type: "uplinkFlip";
      id: number;
      x: number;
      y: number;
      owner: Faction | null;
      prev: Faction | null;
      by: Faction;
    }
  | {
      /** `faction` started pushing an Uplink's capture bar its way (fires once per push). */
      type: "uplinkContest";
      id: number;
      x: number;
      y: number;
      faction: Faction;
      /** Owner at the moment the push began. */
      owner: Faction | null;
    }
  | {
      /** A supply crate was announced (public, both sides): it lands at `landTick`. */
      type: "crateIncoming";
      id: number;
      x: number;
      y: number;
      reward: CrateReward;
      landTick: number;
      /** Which drop of the match (0 = the first); both crates of a drop share it. */
      drop: number;
    }
  | { type: "crateLanded"; id: number; x: number; y: number; reward: CrateReward }
  | {
      /**
       * `faction` claimed a crate. `amount`: scrap or charge gained, units
       * promoted or healed; `unitIds`: the units it affected (or the one it
       * delivered).
       */
      type: "crateClaimed";
      id: number;
      x: number;
      y: number;
      faction: Faction;
      collectorId: number;
      reward: CrateReward;
      amount: number;
      unitIds: number[];
      /** Scrap credited (the scrap reward, or the fallback when a kit had nothing to work on). */
      scrap: number;
    }
  | { type: "crateExpired"; id: number; x: number; y: number }
  | {
      /** A free replacement Condor `id` flew in at (x, y) (lifeline.ts), `squad`: with a free squad aboard. */
      type: "lifeline";
      faction: Faction;
      id: number;
      x: number;
      y: number;
      squad: boolean;
    }
  | {
      /** Infantry squad `unitId` climbed into Condor `carrierId` (it left World.units). */
      type: "embark";
      faction: Faction;
      carrierId: number;
      unitId: number;
      x: number;
      y: number;
    }
  | {
      /**
       * Condor `carrierId` put squads `unitIds` back on the ground at (x, y):
       * a normal drop, or `bailout` when it was shot down (they land hurt).
       */
      type: "disembark";
      faction: Faction;
      carrierId: number;
      unitIds: number[];
      x: number;
      y: number;
      bailout: boolean;
    }
  | {
      /** A Mastodon rolled over enemy squad `id` this tick (crushing, INFANTRY.crushDps). */
      type: "crush";
      faction: Faction;
      id: number;
      attackerId: number;
      x: number;
      y: number;
    }
  | {
      /**
       * A Gantry's Goliath build (public: both sides hear it): `started` as a
       * build begins, `nearlyDone` as it passes GOLIATH.nearlyDone.
       */
      type: "goliathBuild";
      faction: Faction;
      buildingId: number;
      stage: "started" | "nearlyDone";
      x: number;
      y: number;
    }
  | {
      /** Goliath `id` walked off its Gantry `buildingId` (public). */
      type: "goliathRollout";
      faction: Faction;
      id: number;
      buildingId: number;
      x: number;
      y: number;
    }
  | {
      /** Goliath `id` entered `mode`: anchoring (digging in), anchored, packing (up), walking (free to move). */
      type: "goliathMode";
      faction: Faction;
      id: number;
      mode: GoliathMode;
      x: number;
      y: number;
    }
  | {
      /** A Goliath weapon system went `offline` (damage), started `rebooting` (repaired), or came back `online`. */
      type: "goliathWeapon";
      faction: Faction;
      id: number;
      weapon: GoliathWeapon;
      state: "offline" | "rebooting" | "online";
      x: number;
      y: number;
    }
  | {
      /**
       * Two Condors `carrierIds` and Goliath `id` (lift.ts): `hooked` (it left
       * the ground), `setDown` (put down on purpose), or `dropped` (a Condor
       * was lost): it fell, `destroyed` over water, sea, lava or rock.
       */
      type: "goliathLift";
      faction: Faction;
      id: number;
      carrierIds: number[];
      state: "hooked" | "setDown" | "dropped";
      x: number;
      y: number;
      destroyed?: boolean;
    }
  | {
      /**
       * Robot Love: enemy Goliaths `ids` (blue's, red's) came within
       * GOLIATH.love.range of each other and fell in love; the match ends in
       * a draw this tick. (x, y) is the point between them, where they meet.
       */
      type: "love";
      ids: [number, number];
      x: number;
      y: number;
    }
  /** `faction` resigned (a sound duel): the other side wins this tick. */
  | { type: "resign"; faction: Faction };

/**
 * A capturable Uplink relay (objectives.ts). Not a building: nothing
 * occupies its tiles and nothing can shoot it, so combat never sees it.
 */
export interface Uplink {
  id: number;
  /** Centre of the capture zone, in tiles. */
  x: number;
  y: number;
  owner: Faction | null;
  /**
   * Capture bar: −100 (red holds it) … 0 (neutral) … +100 (blue holds it). In
   * a free-for-all, how full `bar`'s colour is: 0 … 100 (objectives.ts uplinkBar).
   */
  progress: number;
  /** A free-for-all's bar: whose colour it is filling (absent in a duel). */
  bar?: Faction | null;
  /** Who is pushing the bar right now (null: nobody, or contested). */
  pushing: Faction | null;
  /** Both sides are inside the zone (the bar is frozen). */
  contested: boolean;
  /**
   * An island relay: only robot infantry count in its zone, to take it AND to
   * contest it (aircraft, the Condor and vehicles don't), and it pays only
   * while the holder's infantry stand in it ("crewed"). Set by the map.
   */
  infantryOnly?: boolean;
  /** Scrap per second to the holder (default OBJECTIVES.uplink.income). */
  income?: number;
  /** ⚡ meter per second to the holder (default OBJECTIVES.uplink.charge). */
  charge?: number;
  /** Infantry-only relays: the holder has a squad in the zone this tick, so it pays. */
  crewed?: boolean;
}

/** What a supply crate holds (the same for both crates of a drop: fair). */
export type CrateReward = "scrap" | "veterans" | "repair" | "charge" | "unit";

export interface Crate {
  id: number;
  x: number;
  y: number;
  reward: CrateReward;
  drop: number;
  /** Announced at, lands (claimable from) at, and burns out at, in ticks. */
  announcedTick: number;
  landTick: number;
  expireTick: number;
}

export interface ObjectiveState {
  uplinks: Uplink[];
  /** Announced or landed crates not yet claimed or expired. */
  crates: Crate[];
  /** Supply-drop sites (tiles, blue-side; each drop lands a crate here and at the mirror). Empty = no drops. */
  dropSites: { x: number; y: number }[];
  /** Drops announced so far (the next drop's index). */
  drops: number;
  /** Index into `dropSites` of the last drop (the next one lands elsewhere). */
  lastSite: number;
  /** Per side: scrap from Uplinks and crates, captures, crates claimed. */
  stats: Record<Faction, { uplinkScrap: number; crateScrap: number; captures: number; crates: number }>;
}

/**
 * What a destroyed combat unit leaves behind (salvage.ts): a burning hull
 * worth scrap to whichever side's ground unit reaches it first. Wrecks are
 * pure loot: they never block movement or placement.
 */
export interface Wreck {
  /** The dead unit's id (ids are never reused, so this is unique). */
  id: number;
  kind: UnitKind;
  /** Whose unit it was (the renderer tints the hull; anyone may salvage it). */
  faction: Faction;
  /** Resting position (tiles): where it died, or nudged onto passable ground. */
  x: number;
  y: number;
  /** Hull facing at death, radians clockwise from North. */
  facing: number;
  /** Scrap it is worth before the collector's incomeMult. */
  value: number;
  /** Ticks left before it burns out. */
  ttl: number;
  /** Ticks left while it is still too hot to salvage. */
  hot: number;
  /**
   * A scrap pile, not a hull: one of the piles a fallen Goliath scatters, or
   * a half-built one strewn around its destroyed Gantry (goliath.ts). `kind`
   * is "goliath"; its `id` is fresh (several piles share one dead unit).
   */
  pile?: boolean;
}

/** Commander calldowns (powers.ts): three on the Command meter plus the late-game Sky Hammer. */
export type PowerKind = "barrage" | "emp" | "droppod" | "hammer";

/** A calldown in flight: telegraphed from `startTick`, landing at `landTick`. */
export interface Calldown {
  id: number;
  faction: Faction;
  power: PowerKind;
  x: number;
  y: number;
  radius: number;
  startTick: number;
  landTick: number;
  /** Barrage: where and when each shell lands (seeded scatter). */
  shells: { x: number; y: number; tick: number }[];
}

export interface PowerState {
  /** Command meter per side, 0–POWERS.meterMax. */
  meter: Record<Faction, number>;
  /** Tick each power is next usable, per side (the Sky Hammer starts locked). */
  readyAt: Record<Faction, Record<PowerKind, number>>;
  /** Telegraphed calldowns not yet resolved (public information). */
  active: Calldown[];
  /** EMP'd entity id → tick the stun wears off. */
  stunned: Map<number, number>;
  /** Calldowns fired per side and power (stats). */
  fired: Record<Faction, Record<PowerKind, number>>;
}

import type { FactionFog } from "./fog";
import type { SurvivalState, WaveTheme } from "./modes/survival";
import type { Rules } from "./rules";
import type { OpsState } from "./ops";

export type Biome = "temperate" | "desert" | "arctic" | "volcanic" | "tropical";

export interface World {
  tick: number;
  width: number;
  height: number;
  terrain: Uint8Array;
  /**
   * Scrap remaining per tile (only meaningful on scrap/crystal tiles). Floats: a harvester takes
   * 2.1 a tick, and whole numbers would drop the tenths every tick (a tile gave up 3 for every 2.1
   * mined, so a field yielded 70% of what it held).
   */
  scrap: Float64Array;
  /** Building id occupying each tile (0 = none) — O(1) footprint lookups. */
  occupancy: Int32Array;
  nextId: number;
  units: Map<number, Unit>;
  buildings: Map<number, Building>;
  projectiles: Projectile[];
  /** Salvageable wrecks on the field, oldest first. */
  wrecks: Wreck[];
  /** Commander meters, cooldowns, calldowns in flight and EMP stuns (powers.ts). */
  powers: PowerState;
  /** Map objectives: Uplink relays and supply drops (objectives.ts). Empty unless the match enables them. */
  objectives: ObjectiveState;
  factions: Record<Faction, FactionState>;
  /**
   * null while the match runs; then the winning faction (once a side has lost
   * its HQ and every Goliath), or "draw" (Robot Love: two enemy Goliaths fell
   * in love, goliath.ts tickLove). Anything that only asks "is it over?" can
   * test it for truthiness.
   */
  winner: Faction | "draw" | null;
  /** Transient render events emitted this tick (cleared each step). */
  fx: FxEvent[];
  fog: Record<Faction, FactionFog>;
  /** Map metadata for the renderer. */
  mapId: string;
  biome: Biome;
  /**
   * Per-match seed. All sim randomness must derive from this (see rand.ts),
   * never Math.random, so a match replays identically from its commands.
   */
  seed: number;
  /** Last Stand (survival mode) wave director state; absent in skirmish. */
  survival?: SurvivalState | null;
  /** Match mutators (rules.ts); absent = classic rules. Read via rulesOf(w). */
  rules?: Rules | null;
  /** Ops campaign scenario state (ops.ts); absent in skirmish and Last Stand. */
  ops?: OpsState | null;
  /** Free replacement Condors (lifeline.ts); absent unless the map hands them out. */
  lifeline?: Record<Faction, LifelineSlot> | null;
  /** Robot Love: the two Goliaths that fell in love and ended the match in a draw, where and when (goliath.ts tickLove). */
  love?: { ids: [number, number]; x: number; y: number; tick: number } | null;
  /** The side that resigned, when a `resign` command decided the match. */
  resigned?: Faction | null;
  /**
   * The sides playing, in canonical order (sides.ts). Absent: blue and red,
   * as in every 2-player match. A four-player map sets all four.
   */
  sides?: Faction[];
  /**
   * A free-for-all's eliminations so far, in order (combat.ts eliminate): the
   * side, the tick, and who finished it (null: nobody, or a resign).
   */
  out?: { faction: Faction; tick: number; by: Faction | null }[];
}

/** One side's free-Condor clock (lifeline.ts). */
export interface LifelineSlot {
  /** Tick the replacement flies in (null: the side has a Condor, or none is owed). */
  due: number | null;
  /** Free Condors handed out so far. */
  given: number;
}

export type Command =
  | { type: "move"; faction: Faction; unitIds: number[]; x: number; y: number }
  | { type: "attackMove"; faction: Faction; unitIds: number[]; x: number; y: number }
  | { type: "attack"; faction: Faction; unitIds: number[]; targetId: number }
  | { type: "harvest"; faction: Faction; unitIds: number[]; x: number; y: number }
  | { type: "stop"; faction: Faction; unitIds: number[] }
  /** `buildingId`: a production building, or an anchored Goliath's unit id (it trains infantry, goliath.ts). */
  | { type: "produce"; faction: Faction; buildingId: number; unit: UnitKind }
  | { type: "cancelProduce"; faction: Faction; buildingId: number; unit: UnitKind }
  | { type: "startBuilding"; faction: Faction; building: BuildingKind }
  | { type: "cancelBuilding"; faction: Faction }
  | { type: "placeBuilding"; faction: Faction; tx: number; ty: number }
  | { type: "sell"; faction: Faction; buildingId: number }
  | { type: "rally"; faction: Faction; buildingId: number; x: number; y: number }
  /** Last Stand: bring the next wave in now for a scrap bonus. */
  | { type: "callWave"; faction: Faction }
  | { type: "calldown"; faction: Faction; power: PowerKind; x: number; y: number }
  /** Infantry `unitIds` board Condor `carrierId` (the Condor comes to meet them if idle). */
  | { type: "board"; faction: Faction; unitIds: number[]; carrierId: number }
  /**
   * Condors `unitIds` drop their passengers: at (x, y) if given (they fly there
   * first; the drop snaps to the nearest tile infantry can stand on), else
   * right where they are.
   */
  | { type: "unload"; faction: Faction; unitIds: number[]; x?: number; y?: number }
  /** Goliaths `unitIds` dig in where they stand (goliath.ts anchorBlocker says where they can't). */
  | { type: "anchor"; faction: Faction; unitIds: number[] }
  /** Anchored (or anchoring) Goliaths `unitIds` pack up to walk again. */
  | { type: "packUp"; faction: Faction; unitIds: number[] }
  /**
   * Two empty Condors `unitIds` hook onto walking Goliath `goliathId` and lift
   * it (lift.ts). Then `move` flies the lift, `unload` sets it down (at x, y
   * if given) and `stop` hovers it.
   */
  | { type: "lift"; faction: Faction; unitIds: number[]; goliathId: number }
  /** `faction` gives up: the other side wins on this tick (a sound duel's Resign, SOUND-DUEL.md). */
  | { type: "resign"; faction: Faction };
