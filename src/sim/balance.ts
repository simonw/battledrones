import {
  Terrain,
  type ArmorClass,
  type BuildingKind,
  type DamageType,
  type Domain,
  type TargetDomain,
  type UnitKind,
  type WeaponFx
} from "./types";

/**
 * Every tunable number in the game lives here.
 * Distances are in tiles, speeds in tiles/second, times in seconds,
 * damage in HP/second — the sim converts to per-tick internally.
 */
export const TICK_RATE = 10;
export const TICKS_PER_SEC = TICK_RATE;

/** Weapon/armor fields shared by units and armed buildings. */
export interface ArmedStats {
  targets: TargetDomain;
  /** Sustained damage per second against a 1.0× armor match. */
  dps: number;
  range: number;
  /** Seconds between shots (damage per shot = dps × shotInterval). */
  shotInterval?: number;
  /** Can't fire at targets closer than this (artillery). */
  minRange?: number;
  /** Splash radius in tiles (full damage at centre, half at the edge). */
  splash?: number;
  /** If set, shots are simulated projectiles at this speed (tiles/s). */
  projectileSpeed?: number;
  dmgType?: DamageType;
  fx?: WeaponFx;
  /** Damage multiplier against aircraft (generalist weapons are weaker vs air). */
  airMult?: number;
}

export interface UnitStats extends ArmedStats {
  name: string;
  /** One-line role summary for the build-bar tooltip. */
  role: string;
  cost: number;
  hp: number;
  speed: number;
  sight: number;
  domain: Domain;
  armor: ArmorClass;
  /** Hovers: crosses water, ignores rough ground (still a ground target). */
  hover?: boolean;
  /** Repair beam: HP/second restored to one damaged friendly in range. */
  heal?: number;
  buildTime: number;
  builtAt: BuildingKind;
  /** Extra building that must exist before this unit can be produced. */
  requires?: BuildingKind;
  /** Rendered with a separately rotating turret. */
  turret?: boolean;
  /** Collision/visual radius in tiles. */
  radius: number;
  /**
   * Robot infantry: the number of robots the squad is drawn as. A squad is
   * one sim unit with one HP pool; a robot falls each time HP crosses a 1/N
   * step and DPS scales with the robots still standing (infantry.ts).
   */
  squad?: number;
  /** Transport (Condor): infantry squads it can carry. */
  capacity?: number;
  /** Always visible to the enemy, through fog and on the minimap (the Goliath: it can't hide). */
  alwaysVisible?: boolean;
}

export interface BuildingStats extends ArmedStats {
  name: string;
  role: string;
  cost: number;
  hp: number;
  sight: number;
  /** Square footprint edge, in tiles. */
  size: number;
  buildTime: number;
  /** Any one of these must already stand before construction can start. */
  requires?: BuildingKind[];
  /** Every one of these must already stand before construction can start (the Gantry). */
  requiresAll?: BuildingKind[];
  /** One per side: it can't be started while the side has one (standing). */
  unique?: boolean;
  /** Always visible to the enemy, through fog and on the minimap, with what it is building. */
  alwaysVisible?: boolean;
  /** Harvesters may unload scrap here. */
  dropOff?: boolean;
}

/**
 * Combat units carry 1.5× their original HP (Hornets 1.3×, so Flak still
 * answers them; Harvesters and Scouts unchanged): half an army now takes
 * ~7–9 s to die instead of 5–7, long enough to react on a phone.
 */
export const UNITS: Record<UnitKind, UnitStats> = {
  harvester: {
    name: "Harvester", role: "Mines scrap and crystal. Keep it safe.",
    cost: 150, hp: 250, speed: 1.6, sight: 4, domain: "ground", armor: "medium",
    targets: "none", dps: 0, range: 0,
    buildTime: 10, builtAt: "hq", radius: 0.45
  },
  scout: {
    name: "Scout", role: "Fast flying eyes. Unarmed.",
    cost: 75, hp: 60, speed: 4.8, sight: 9, domain: "air", armor: "light",
    targets: "none", dps: 0, range: 0,
    buildTime: 4, builtAt: "airpad", radius: 0.3
  },
  stinger: {
    name: "Stinger", role: "Fast light tank. Beats Flak and Mortars. Can't hit air.",
    cost: 150, hp: 255, speed: 2.3, sight: 5, domain: "ground", armor: "medium",
    targets: "ground", dps: 22, range: 3.2, shotInterval: 0.6, dmgType: "kinetic", fx: "cannon",
    buildTime: 7, builtAt: "fab-plant", turret: true, radius: 0.38
  },
  "flak-crawler": {
    name: "Flak Crawler", role: "Anti-air. Shreds drones. Helpless vs ground.",
    cost: 190, hp: 285, speed: 1.9, sight: 6, domain: "ground", armor: "medium",
    targets: "air", dps: 31, range: 5, shotInterval: 0.3, dmgType: "flak", fx: "flak",
    buildTime: 8, builtAt: "fab-plant", turret: true, radius: 0.4
  },
  mortar: {
    name: "Mortar", role: "Long-range splash artillery. Razes bases. Fragile up close.",
    cost: 275, hp: 195, speed: 1.5, sight: 6, domain: "ground", armor: "light",
    targets: "ground", dps: 18, range: 8, minRange: 2.5, shotInterval: 3,
    splash: 1.1, projectileSpeed: 5.5, dmgType: "explosive", fx: "shell",
    buildTime: 10, builtAt: "fab-plant", requires: "tech-lab", turret: true, radius: 0.42
  },
  mastodon: {
    name: "Mastodon", role: "Super-heavy tank. Crushes light armies. Can't hit air.",
    cost: 475, hp: 1050, speed: 1.2, sight: 6, domain: "ground", armor: "heavy",
    targets: "ground", dps: 46, range: 4, shotInterval: 1.2, dmgType: "cannon", fx: "heavy-cannon",
    buildTime: 15, builtAt: "fab-plant", requires: "tech-lab", turret: true, radius: 0.55
  },
  lancer: {
    name: "Lancer", role: "Hover laser tank. Burns through armour, hits air too. Crosses water.",
    cost: 275, hp: 405, speed: 2.5, sight: 6, domain: "ground", armor: "medium",
    hover: true,
    targets: "both", dps: 28, range: 4.5, shotInterval: 0.8, dmgType: "laser", fx: "laser", airMult: 0.65,
    buildTime: 11, builtAt: "fab-plant", requires: "tech-lab", turret: true, radius: 0.42
  },
  wasp: {
    name: "Wasp", role: "Strike drone. Rockets ground targets. Dies to Flak.",
    cost: 200, hp: 205, speed: 3.6, sight: 6, domain: "air", armor: "light",
    targets: "ground", dps: 28, range: 3, shotInterval: 1, dmgType: "missile", fx: "rockets",
    buildTime: 8, builtAt: "airpad", radius: 0.35
  },
  raptor: {
    name: "Raptor", role: "Interceptor. Hunts air units. Can't hit ground.",
    cost: 250, hp: 265, speed: 4.1, sight: 7, domain: "air", armor: "medium",
    targets: "air", dps: 32, range: 4, shotInterval: 0.8, dmgType: "missile", fx: "missile",
    buildTime: 9, builtAt: "airpad", radius: 0.38
  },
  hornet: {
    name: "Hornet", role: "Heavy bomber. Carpet-bombs ground and bases. Needs escort.",
    cost: 375, hp: 505, speed: 2.1, sight: 6, domain: "air", armor: "heavy",
    targets: "ground", dps: 36, range: 1.6, shotInterval: 2, splash: 1.1,
    projectileSpeed: 5, dmgType: "explosive", fx: "bomb",
    buildTime: 14, builtAt: "airpad", requires: "tech-lab", radius: 0.5
  },
  mender: {
    name: "Mender", role: "Repair drone. Heals nearby units and buildings.",
    cost: 150, hp: 180, speed: 3.2, sight: 6, domain: "air", armor: "light",
    targets: "none", dps: 0, range: 3, heal: 10,
    buildTime: 7, builtAt: "airpad", radius: 0.32
  },
  // ---- robot infantry (INFANTRY.md): one sim unit each, drawn as `squad` robots ----
  // (tuned down from the spec's 225 HP / 18 DPS: cost for cost those beat Stingers by
  // 0.48 in tools/balance.ts duels; Stingers are meant to handle infantry)
  trooper: {
    name: "Trooper Squad", role: "Cheap rifle bots. Hit ground and air. Take cover in woods.",
    cost: 100, hp: 190, speed: 1.8, sight: 5, domain: "ground", armor: "infantry",
    targets: "both", dps: 15, range: 3, shotInterval: 0.4, dmgType: "kinetic", fx: "rifle", airMult: 0.5,
    buildTime: 6, builtAt: "assembly-bay", radius: 0.4, squad: 5
  },
  // (the spec's 180 HP and 0.8× vs air lost to Hornets by 0.59 cost for cost — their bombs
  // splash whole clumps of squads; 210 HP and 1.5× vs air kill them, as the role says)
  "rocket-squad": {
    name: "Rocket Squad", role: "Anti-armour rockets. Kill Mastodons and Hornets. Weak vs infantry.",
    cost: 175, hp: 210, speed: 1.6, sight: 6, domain: "ground", armor: "infantry",
    targets: "both", dps: 26, range: 4, shotInterval: 1.5, dmgType: "cannon", fx: "rockets", airMult: 1.5,
    buildTime: 9, builtAt: "assembly-bay", radius: 0.4, squad: 3
  },
  sniper: {
    name: "Sniper Team", role: "Long-range marksmen. Delete infantry. Useless vs vehicles.",
    cost: 200, hp: 120, speed: 1.7, sight: 8, domain: "ground", armor: "infantry",
    // 50 per shot; precision ×3 vs infantry = 150 (about three Trooper robots)
    targets: "ground", dps: 20, range: 7, shotInterval: 2.5, dmgType: "precision", fx: "snipe",
    buildTime: 10, builtAt: "assembly-bay", requires: "tech-lab", radius: 0.35, squad: 2
  },
  condor: {
    name: "Condor", role: "Dropship. Carries two infantry squads over anything. Unarmed.",
    cost: 200, hp: 400, speed: 3.6, sight: 6, domain: "air", armor: "medium",
    targets: "none", dps: 0, range: 0,
    buildTime: 9, builtAt: "airpad", radius: 0.5, capacity: 2
  },
  // The Goliath fights with GOLIATH.weapons (goliath.ts), not these: they
  // summarise them for estimates and tooltips (every weapon's DPS together,
  // the mortars' reach). Cost is the first one's: each costs GOLIATH.costStep more.
  goliath: {
    name: "Goliath", role: "Giant walking mech and mobile base. Anchor it to build, train and unload anywhere.",
    cost: 1600, hp: 3000, speed: 1.0, sight: 10, domain: "ground", armor: "heavy",
    targets: "both", dps: 125, range: 8,
    buildTime: 60, builtAt: "gantry", radius: 1.0, alwaysVisible: true
  }
};

export const BUILDINGS: Record<BuildingKind, BuildingStats> = {
  hq: {
    name: "HQ", role: "Command centre. Builds Harvesters, takes scrap. Lose it and every Goliath, lose the game.",
    cost: 0, hp: 3200, sight: 7, size: 3, buildTime: 0, dropOff: true,
    // point defence: swats early drone raids, leaves ground assaults to real defences
    targets: "air", dps: 9, range: 4.5, shotInterval: 0.5, dmgType: "kinetic", fx: "mg"
  },
  "fab-plant": {
    name: "Fab Plant", role: "Builds ground vehicles.",
    cost: 300, hp: 1000, sight: 4, size: 2, buildTime: 10,
    targets: "none", dps: 0, range: 0
  },
  airpad: {
    name: "Airpad", role: "Builds flying drones.",
    cost: 350, hp: 850, sight: 4, size: 2, buildTime: 12,
    targets: "none", dps: 0, range: 0
  },
  "tech-lab": {
    name: "Tech Lab", role: "Unlocks Mortar, Mastodon, Lancer, Hornet and Sniper.",
    cost: 450, hp: 800, sight: 4, size: 2, buildTime: 20, requires: ["fab-plant", "airpad", "assembly-bay"],
    targets: "none", dps: 0, range: 0
  },
  depot: {
    name: "Depot", role: "Forward scrap drop-off. Build it near distant fields.",
    cost: 250, hp: 800, sight: 4, size: 2, buildTime: 10, dropOff: true,
    targets: "none", dps: 0, range: 0
  },
  turret: {
    name: "Turret", role: "Autocannon defence. Hits ground and air.",
    cost: 225, hp: 650, sight: 6, size: 1, buildTime: 8,
    targets: "both", dps: 26, range: 4.5, shotInterval: 0.5, dmgType: "kinetic", fx: "cannon"
  },
  "sam-site": {
    name: "SAM Site", role: "Long-range anti-air missiles.",
    cost: 275, hp: 560, sight: 7, size: 1, buildTime: 9,
    targets: "air", dps: 32, range: 6.5, shotInterval: 1.2, dmgType: "missile", fx: "missile"
  },
  radar: {
    name: "Radar", role: "Reveals a wide area through the fog.",
    cost: 200, hp: 450, sight: 13, size: 1, buildTime: 8,
    targets: "none", dps: 0, range: 0
  },
  "assembly-bay": {
    name: "Assembly Bay", role: "Builds robot infantry.",
    cost: 250, hp: 700, sight: 4, size: 2, buildTime: 15,
    targets: "none", dps: 0, range: 0
  },
  gantry: {
    name: "Gantry", role: "Builds the Goliath. One per side, and the enemy can always see it.",
    cost: 600, hp: 1200, sight: 5, size: 3, buildTime: 25,
    requiresAll: ["fab-plant", "airpad", "tech-lab", "assembly-bay"], unique: true, alwaysVisible: true,
    targets: "none", dps: 0, range: 0
  }
};

/** Damage multiplier by damage type (row) vs armor class (column). */
export const DAMAGE_VS: Record<DamageType, Record<ArmorClass, number>> = {
  kinetic: { light: 1.0, medium: 1.0, heavy: 0.6, structure: 0.65, infantry: 1.0 },
  cannon: { light: 0.8, medium: 1.0, heavy: 1.3, structure: 1.0, infantry: 0.4 },
  flak: { light: 1.25, medium: 1.0, heavy: 1.15, structure: 0.5, infantry: 1.25 },
  missile: { light: 1.15, medium: 1.0, heavy: 0.9, structure: 0.6, infantry: 0.7 },
  explosive: { light: 1.2, medium: 0.9, heavy: 0.85, structure: 1.35, infantry: 1.3 },
  laser: { light: 1.0, medium: 1.0, heavy: 1.55, structure: 0.8, infantry: 0.7 },
  // Sniper rail-rifles: deadly to robot infantry, next to useless against armour
  precision: { light: 0.6, medium: 0.4, heavy: 0.25, structure: 0.15, infantry: 3.0 }
};

export interface TerrainInfo {
  name: string;
  /** Tracked/wheeled units can enter. */
  ground: boolean;
  /** Hover units can enter. */
  hover: boolean;
  /** Speed multiplier for tracked/wheeled and hover units. */
  speed: number;
  hoverSpeed: number;
  /** Speed multiplier for robot infantry (0 = they can't enter: Water and Rock). */
  footSpeed: number;
  /** Buildings may be placed here. */
  buildable: boolean;
  /** Damage multiplier for ground units standing here (cover). */
  cover: number;
}

export const TERRAIN: Record<Terrain, TerrainInfo> = {
  [Terrain.Ground]: { name: "Ground", ground: true, hover: true, speed: 1, hoverSpeed: 1, footSpeed: 1, buildable: true, cover: 1 },
  [Terrain.Rock]: { name: "Rock", ground: false, hover: false, speed: 0, hoverSpeed: 0, footSpeed: 0, buildable: false, cover: 1 },
  [Terrain.Scrap]: { name: "Scrap field", ground: true, hover: true, speed: 0.85, hoverSpeed: 1, footSpeed: 0.85, buildable: false, cover: 1 },
  [Terrain.Water]: { name: "Water", ground: false, hover: true, speed: 0, hoverSpeed: 1, footSpeed: 0, buildable: false, cover: 1 },
  [Terrain.Road]: { name: "Road", ground: true, hover: true, speed: 1.35, hoverSpeed: 1.15, footSpeed: 1.35, buildable: true, cover: 1 },
  [Terrain.Rough]: { name: "Rough ground", ground: true, hover: true, speed: 0.6, hoverSpeed: 1, footSpeed: 1, buildable: false, cover: 1 },
  [Terrain.Forest]: { name: "Woods", ground: true, hover: true, speed: 0.55, hoverSpeed: 0.6, footSpeed: 1, buildable: false, cover: 0.7 },
  [Terrain.Crystal]: { name: "Crystal field", ground: true, hover: true, speed: 0.85, hoverSpeed: 1, footSpeed: 0.85, buildable: false, cover: 1 },
  [Terrain.Bridge]: { name: "Bridge", ground: true, hover: true, speed: 1.35, hoverSpeed: 1.15, footSpeed: 1.35, buildable: false, cover: 1 },
  [Terrain.Shallows]: { name: "Shallows", ground: true, hover: true, speed: 0.5, hoverSpeed: 1, footSpeed: 0.8, buildable: false, cover: 1 },
  [Terrain.Deep]: { name: "Open sea", ground: false, hover: false, speed: 0, hoverSpeed: 0, footSpeed: 0, buildable: false, cover: 1 }
};

/**
 * The island map's free replacement Condor (lifeline.ts): a side with no
 * Condor (none flying, none being built) gets one `delay` s later, flown in
 * from the map edge nearest its HQ. It brings a free Trooper Squad only while
 * the side has fewer than `squadUnder` squads, so it rescues a side that has
 * lost its infantry and can't be farmed for troops.
 */
export const LIFELINE = {
  delay: 45,
  squadUnder: 2,
  /** How far inside the map edge it appears (tiles). */
  edgeInset: 1.5
};

export const ECONOMY = {
  startingScrap: 600,
  /** Scrap a harvester can carry per trip. */
  harvesterCapacity: 100,
  /** Scrap mined per second while sitting on a field. */
  harvestRate: 21,
  /** Scrap transferred per second while unloading at a drop-off. */
  unloadRate: 140,
  /** Scrap in a fresh scrap-field tile. */
  scrapPerTile: 1500,
  /** Raw crystal in a fresh crystal tile… */
  crystalPerTile: 1200,
  /** …and each unit of it mined is worth this much scrap in the hold. */
  crystalValue: 1.6,
  /** New buildings must be placed within this range of a friendly building. */
  buildRadius: 6,
  /** Fraction of cost refunded when selling a building. */
  sellRefund: 0.5,
  /** Scrap per second every HQ salvages on its own (keeps broke sides alive). */
  hqTrickle: 2,
  /** Max units queued per production building. */
  maxQueue: 6
};

export const COMBAT = {
  /** Default seconds between shots; damage per shot = dps * this. */
  shotInterval: 0.5,
  /** Auto-acquire radius = weapon range + this bonus. */
  acquireBonus: 1.5,
  /** Idle units retaliate against attackers up to this far away. */
  retaliateRange: 9,
  /** Idle allies this close to a victim join in its defence. */
  assistRadius: 5,
  /**
   * Auto-targeting reckons an enemy Mender this many tiles closer than it is,
   * and a unit that can hit one drops its current auto-target for a Mender
   * in weapon range: kill the healer first, or the fight never ends.
   */
  healerPriority: 2.5,
  /** XP (fraction of own cost in kills) needed for ranks 1, 2, 3. */
  rankXp: [1, 2.5, 5],
  /** Damage bonus per veterancy rank. */
  rankDamage: 0.15,
  /** HP/sec regenerated at rank 3 (fraction of max HP). */
  eliteRegen: 0.01
};

/**
 * Robot infantry and the Condor dropship (INFANTRY.md; infantry.ts,
 * transport.ts). Squads are single sim units drawn as several robots.
 */
export const INFANTRY = {
  /** Damage multiplier for a squad standing in Woods (vehicles get TERRAIN cover 0.7). */
  woodsCover: 0.5,
  /** A Sniper Team in Woods is only seen by enemies this close (tiles)… */
  concealRadius: 3,
  /** …until this many seconds after it fires. */
  concealAfterShot: 2,
  /** HP/s a moving Mastodon deals to an enemy squad it rolls over. */
  crushDps: 30,
  /** A Mastodon crushes squads whose centre is within its radius + this (tiles). */
  crushReach: 0.15,
  /** Uplink capture weight of a squad (vehicles count 1, aircraft 0.5). */
  captureWeight: 2,
  /** Seconds a squad takes to climb aboard once it is within `boardRange` of the Condor. */
  boardTime: 1,
  /** Horizontal distance (tiles) between squad and Condor that counts as adjacent. */
  boardRange: 1.2,
  /** Seconds a Condor hovers over the drop point before the squads are down. */
  unloadHover: 1.5,
  /** How far (tiles) a drop may snap to find a tile infantry can stand on (past that: the nearest anywhere). */
  dropSearch: 6,
  /** Squads set down (dropped or bailed out) keep their centre this far (tiles) from ground they can't stand on and the map's edge: their robots stand around it. */
  dropClear: 0.4,
  /** After a drop the Condor backs off this far (tiles) the way it came, off its squads' heads. */
  dropBackOff: 1.5,
  /** A Condor shot down over walkable ground: passengers bail out with at most this share of their max HP. */
  bailoutHp: 0.5
};

export const FOG = {
  /** Visibility recompute cadence, in ticks (10Hz / 4 ≈ 2.5Hz–4Hz zone). */
  intervalTicks: 3
};

/** Damage per shot for a weapon, before armor/veterancy. */
export const shotDamage = (s: ArmedStats): number =>
  s.dps * (s.shotInterval ?? COMBAT.shotInterval);

/**
 * Battlefield salvage (salvage.ts): a destroyed combat unit leaves a
 * burning wreck worth a share of its cost, scooped up by the first ground
 * unit of either side to drive over it. Fights leave loot worth holding.
 */
export const SALVAGE = {
  /** Wreck value as a share of the dead unit's cost (harvesters leave none). */
  share: 0.3,
  /** Seconds a wreck lies on the field before it burns out. */
  ttl: 60,
  /** Seconds a fresh wreck burns before it can be salvaged (not mid-brawl). */
  hot: 2.5,
  /** A ground unit whose centre comes this close (tiles) collects the wreck. */
  pickupRadius: 0.9,
  /** A death spot no tank could reach (water, rock, a building) shifts to a passable tile this close, else no wreck. */
  shiftRadius: 2,
  /** Most wrecks on the field at once; past that the oldest burns out. */
  maxWrecks: 60
};

/**
 * Commander calldowns (powers.ts). A Command meter per side (0–100) fills
 * slowly on its own and mostly from losses, and pays for three telegraphed,
 * map-targeted powers; the Sky Hammer is a separate late-game strike that
 * comes online for both sides at 6:00. Every telegraph is public (both
 * sides see it through the fog), so landing one and dodging one are both
 * skill moments. Damage stays modest and cooldowns long: burst powers fed
 * the snowball in the design panel's prototypes.
 */
export const POWERS = {
  meterMax: 100,
  /** Meter per second, always. */
  passive: 0.035,
  /** Meter per scrap of your own units and buildings destroyed (comeback-weighted). */
  perScrapLost: 0.008,
  /** Meter per scrap of enemy units and buildings you destroy. */
  perScrapKilled: 0.002,
  barrage: {
    cost: 60, cooldown: 45, telegraph: 2.5,
    /** Shells, the seconds between them, and their scatter (tiles) around the aim point. */
    shells: 3, shellGap: 0.3, scatter: 0.9,
    damage: 170, splash: 2,
    /** Reticle size: the area any shell can reach. */
    radius: 2.9
  },
  emp: {
    cost: 40, cooldown: 40, telegraph: 0.8,
    radius: 3,
    /** Seconds stunned units can't move or fire and buildings can't fire or produce. */
    stun: 4
  },
  droppod: {
    cost: 70, cooldown: 60, telegraph: 2,
    radius: 1.2,
    /** Light impact on enemy ground units right under the pod. */
    damage: 60,
    units: ["stinger", "stinger", "flak-crawler"] as UnitKind[],
    /** With a Tech Lab standing. */
    techUnits: ["lancer", "lancer", "flak-crawler"] as UnitKind[]
  },
  hammer: {
    /** Comes online for both sides at this match time (seconds), then recharges. */
    unlock: 6 * 60, cooldown: 150, telegraph: 3,
    radius: 2.5,
    /** Units: this × (1 − 0.5·d/r), any armour, ground or air. */
    unitDamage: 260,
    /** Buildings whose footprint is in the radius: flat (an HQ loses ~22%). */
    buildingDamage: 700
  }
};

/**
 * Map objectives (objectives.ts): capturable Uplink relays in the contested
 * middle of each map, and supply drops announced to both sides. They give
 * armies a reason to fight away from the bases and the opening a goal.
 */
export const OBJECTIVES = {
  uplink: {
    /** Capture zone radius (tiles) around the relay's centre. */
    radius: 2.5,
    /** Presence per unit in the zone (harvesters don't count); aircraft count this much. */
    airWeight: 0.5,
    /** Capture bar points per second per unit present (bar spans −100…100)… */
    perUnit: 3.5,
    /** …capped at this (4 units): neutral → owned in ~7 s, a flip in ~14 s. */
    maxRate: 14,
    /** Points per second the bar drifts back to its rest (owned: full, neutral: 0) with nobody there. */
    settle: 2,
    /** Scrap per second to the owner (× its income multiplier). */
    income: 1.5,
    /** The owner sees this far (tiles) around the relay. */
    sight: 7,
    /** Command meter per second to the owner (powers.ts). */
    charge: 0.06
  },
  drops: {
    /** Seconds into the match the first drop lands; then one every `every` seconds. */
    first: 90,
    every: 75,
    /** Seconds of public warning before a drop lands. */
    warning: 10,
    /** Seconds a landed crate waits before it burns out. */
    ttl: 45,
    /** The first non-harvester unit whose centre comes this close (tiles) claims it. */
    claimRadius: 0.8,
    /** Reward weights (both crates of a drop share the roll). */
    weights: { scrap: 38, veterans: 20, repair: 15, charge: 17, unit: 10 } as Record<string, number>,
    scrap: 200,
    /** Veterans: +1 rank to the claimer and its allies this close. */
    veteranRadius: 3,
    /** Field Repair: own units this close are healed this share of their max HP. */
    repairRadius: 4,
    repairShare: 0.5,
    /** Command meter added. */
    charge: 40,
    /** A Veterans / Repair / Charge crate that would do nothing (no one to promote or heal, meter full) pays this scrap instead. */
    fallbackScrap: 150,
    /** The rare drop: a free unit of this kind at this rank. */
    unit: "lancer" as UnitKind,
    unitRank: 1
  }
};

/** One Goliath weapon system: a weapon, and the share of max HP below which damage takes it offline. */
export interface GoliathWeaponStats extends ArmedStats {
  name: string;
  /** Offline below this share of max HP (0: never — the machine guns). */
  lostBelow: number;
}

/**
 * The Goliath (GOLIATH.md; goliath.ts, lift.ts) and its Gantry. Every number
 * here is a starting point for tuning with tools/balance.ts, not a promise.
 */
export const GOLIATH = {
  /** Each Goliath costs this much more (share of list price) for every one the side already has (alive, or on the Gantry). */
  costStep: 0.25,
  /** Goliaths a Gantry queues at once (one on the cradle). */
  queueMax: 1,
  /** Build share past which the enemy hears "Enemy Goliath nearly complete". */
  nearlyDone: 0.85,
  /** Seconds to dig in (anchor), and to pack up again: leaving under fire is the risky moment. */
  anchorTime: 4,
  packTime: 6,
  /** Footprint edge (tiles) of the ground it needs to anchor on: buildable, nothing in the way. Harvesters dock at its edge. */
  footprint: 2,
  /** Anchored: buildings may go up this far (tiles) from its centre to their footprint, as outposts. */
  buildRing: 3,
  /**
   * Anchored: scrap per second it salvages on its own (× the side's income, as the HQ's trickle):
   * half an Uplink's pay, so a side with no HQ (the Armada, Nomads, an HQ lost) isn't left with
   * nothing once the fields run dry.
   */
  trickle: OBJECTIVES.uplink.income / 2,
  /** Seconds a repaired weapon takes to reboot… */
  reboot: 2.5,
  /** …once HP is back this share of max above the line where it went offline (no flicker at the line). */
  restoreMargin: 0.05,
  /**
   * Weapon strength ≈ 2 Mortars, 1 Lancer, 1 Mastodon and 1 Trooper Squad
   * (≈ 1,400 scrap of firepower), lost in this order as its health falls.
   */
  weapons: {
    // two shoulder tubes taking turns: a Mortar shell every 1.5 s. (A tighter
    // burst than the Mortar's 1.1: at 1.1 a cost-equal group of Rocket Squads
    // only edged it, −0.14 in tools/balance.ts goliath duels; at 0.9, −0.39,
    // a real answer like Lancers, Wasps and Hornets, and it still beats Troopers.)
    mortars: {
      name: "Mortars", lostBelow: 0.75,
      targets: "ground", dps: 36, range: 8, minRange: 2.5, shotInterval: 1.5,
      splash: 0.9, projectileSpeed: 5.5, dmgType: "explosive", fx: "shell"
    },
    laser: {
      name: "Eye laser", lostBelow: 0.5,
      targets: "both", dps: 28, range: 4.5, shotInterval: 0.8, dmgType: "laser", fx: "laser", airMult: 0.65
    },
    // two arm cannons taking turns: a Mastodon's damage, half a shell at a time
    cannons: {
      name: "Arm cannons", lostBelow: 0.25,
      targets: "ground", dps: 46, range: 4, shotInterval: 0.6, dmgType: "cannon", fx: "heavy-cannon"
    },
    mg: {
      name: "Machine guns", lostBelow: 0,
      targets: "both", dps: 15, range: 3, shotInterval: 0.4, dmgType: "kinetic", fx: "mg", airMult: 0.5
    }
  } as Record<"mortars" | "laser" | "cannons" | "mg", GoliathWeaponStats>,
  /** Two-Condor lift (lift.ts). */
  lift: {
    /** Lift speed as a share of the Condor's. */
    speedMult: 0.5,
    /** Dropped over land (a Condor shot down): this share of max HP in damage. Over water, sea, lava or rock: destroyed. */
    dropDamage: 0.25,
    /** Each Condor hooks on this far (tiles) to either side of the Goliath's centre. */
    span: 1.1,
    /** A Condor within this distance (tiles) of its hook point has hooked on. */
    hookRange: 0.3,
    /** A set-down point that isn't ground a Goliath can stand on snaps to the nearest that is, this far (tiles) at most. */
    setDownSearch: 6
  },
  /** A destroyed Goliath scatters this share of its list price over `piles` scrap piles across ~2×`spread` tiles. */
  salvage: { share: 0.3, piles: [6, 8] as [number, number], spread: 2.5 },
  /** A Gantry destroyed mid-build scatters this share of the scrap paid × the build's progress, in up to `piles` piles. */
  gantrySalvage: { share: 0.3, piles: 4, spread: 2.5 },
  /** Seconds a scrap pile lies before it burns out (longer than a wreck: holding the ground pays). */
  pileTtl: 90,
  /** Robot Love mutator: enemy Goliaths this close (tiles, centre to centre) fall in love, and the match is a draw. */
  love: { range: 5 },
  /** Goliath Armada mutator: the four starting Goliaths hang this far (tiles) either way of the HQ's centre, on each axis (lift.ts armadaStart). */
  armada: { gap: 2.2 }
};
