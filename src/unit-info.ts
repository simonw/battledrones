// Every unit's and building's description, read from balance.ts so it never
// drifts from the game, plus hand-written notes on what makes each one
// special: the cards on the vehicles page (vehicles.html) and the 3D models
// page (models.html).
import {
  BUILDINGS, DAMAGE_VS, ECONOMY, GOLIATH, INFANTRY, OBJECTIVES, TERRAIN, UNITS, shotDamage,
  type ArmedStats, type GoliathWeaponStats
} from "./sim/balance";
import { COUNTERS } from "./game/advisor";
import { Terrain, type ArmorClass, type BuildingKind, type UnitKind } from "./sim/types";

export const FEATURES: Record<UnitKind, string[]> = {
  harvester: [
    "Your economy: drives to the nearest scrap or crystal field, fills its hold and hauls it back to the HQ or a Depot.",
    "Crystal is worth 1.6× scrap per load, so crystal fields are worth fighting over.",
    "Unarmed and slow; air raids hunt them first. Build a Depot near distant fields to shorten the trip.",
    "Leaves no salvage when destroyed."
  ],
  scout: [
    "The fastest thing on the map, with the widest sight of any unit.",
    "Unarmed: use it to find the enemy base, spot fields and watch for attacks coming through the fog.",
    "Cheap and quick to build — losing one is fine if it bought you information."
  ],
  stinger: [
    "Cheap, fast light tank with a turreted cannon — the backbone of an early army.",
    "Quick enough to raid harvesters and outrun slower armour.",
    "Wins cost-for-cost against Flak Crawlers, Mortars and Lancers, but cannot shoot at aircraft."
  ],
  "flak-crawler": [
    "The dedicated anti-air answer: rapid flak bursts that shred drones, extra-effective against light airframes.",
    "Beats every aircraft cost-for-cost, including Hornet bombers.",
    "Completely helpless against ground units — escort it with tanks."
  ],
  mortar: [
    "Long-range artillery: out-ranges every turret and SAM Site, making it the tool for cracking a base.",
    "Shells are real projectiles with splash, aimed where the target was — fast units can dodge them.",
    "Has a minimum range and light armour: anything that closes the distance tears it apart."
  ],
  mastodon: [
    "Super-heavy twin-cannon tank with by far the most HP of any tank.",
    "Its cannons hit heavy armour harder, and it crushes Stingers, Flak and Mortars.",
    "Slow and unable to shoot at air — Wasps and Lancers are its nightmare."
  ],
  lancer: [
    "Hover tank: crosses water and shallows and ignores rough ground, opening routes no tracked unit can take.",
    "Its laser burns through heavy armour (1.55×), making it the Mastodon killer.",
    "The only tank that can also shoot aircraft, at reduced effect."
  ],
  wasp: [
    "Rocket strike drone that flies over every obstacle to hit ground targets.",
    "Beats tanks and artillery cost-for-cost — great for harassing harvesters and Mortars.",
    "Dies quickly to Flak, Raptors and SAM Sites."
  ],
  raptor: [
    "Air superiority interceptor: fast missiles that hunt other aircraft.",
    "Counters Wasps, Hornets and Menders.",
    "Cannot attack anything on the ground."
  ],
  hornet: [
    "Heavy armoured bomber that carpet-bombs ground units and buildings with splash damage.",
    "Explosive bombs do 1.35× damage to structures — ideal for flattening a base.",
    "Bombs are projectiles that can be dodged, and it needs an escort against Flak, Raptors and SAMs."
  ],
  mender: [
    "Repair drone: a beam that heals one damaged friendly unit or building in range at a time.",
    "Keeps an army in the fight longer; the AI uses them as army escorts.",
    "Unarmed and lightly armoured — Raptors and Flak pick them off."
  ],
  trooper: [
    `Five rifle bots fighting as one squad: one HP pool, and a robot falls each time it loses a fifth of it — the squad's firepower falls with them.`,
    "The cheapest unit that can shoot aircraft, at half effect. Every side starts the match with one squad.",
    `Walks through woods and rough ground at full speed, and takes only ${Math.round(INFANTRY.woodsCover * 100)}% damage in woods (vehicles: ${Math.round(TERRAIN[Terrain.Forest].cover * 100)}%).`,
    `Captures Uplinks ${INFANTRY.captureWeight}× as fast as a vehicle and picks up supply crates. Leaves no wreck.`
  ],
  "rocket-squad": [
    `Three bots with shoulder-fired rockets: cannon damage that hits heavy armour ${DAMAGE_VS.cannon.heavy}× — the cheap answer to Mastodons.`,
    `Also fires at aircraft (${UNITS["rocket-squad"].airMult}×), so Hornets and Wasps pay for low passes.`,
    "Weak against other infantry: Troopers and Snipers cut it down."
  ],
  sniper: [
    `Two marksmen with rail-rifles: precision damage, ${Math.round(shotDamage(UNITS.sniper))} per shot and ${DAMAGE_VS.precision.infantry}× against infantry — one shot drops about three Trooper robots.`,
    `Hidden in woods: enemies only see it within ${INFANTRY.concealRadius} tiles, until ${INFANTRY.concealAfterShot} s after it fires.`,
    "Next to useless against armour and buildings, and slow to fire: keep vehicles away from it."
  ],
  condor: [
    `Dropship: carries ${UNITS.condor.capacity} infantry squads over water, rock and anything else in the way. Unarmed.`,
    `Select squads and tap the Condor to load them (1 s each, once they reach it); long-press the map to fly there and drop them (it hovers ${INFANTRY.unloadHover} s), or tap Unload.`,
    `Shot down over land, its squads bail out with at most ${Math.round(INFANTRY.bailoutHp * 100)}% HP; over water or rock they are lost with it.`
  ],
  goliath: [
    "A giant walking mech and a mobile base: shoulder mortars, an eye laser, arm cannons and machine guns that hit aircraft too.",
    `Anchor it (${GOLIATH.anchorTime} s to dig in, ${GOLIATH.packTime} s to pack up) and it takes harvesters' scrap, trains infantry, and lets you build outposts within ${GOLIATH.buildRing} tiles of it, anywhere on the map. Dug in, it also salvages ${GOLIATH.trickle} scrap a second on its own.`,
    `Loses its weapons as it is hurt: mortars below ${Math.round(GOLIATH.weapons.mortars.lostBelow * 100)}% HP, the laser below ${Math.round(GOLIATH.weapons.laser.lostBelow * 100)}%, the cannons below ${Math.round(GOLIATH.weapons.cannons.lostBelow * 100)}%. Only Menders repair it, and each weapon reboots once it is mended.`,
    `Always visible to the enemy. Two empty Condors can carry it; while a side has a Goliath, losing its HQ doesn't lose the game. Each one costs ${Math.round(GOLIATH.costStep * 100)}% more for every Goliath you already have.`
  ]
};

export const GROUPS: { title: string; kinds: UnitKind[] }[] = [
  { title: "Built at the HQ", kinds: ["harvester"] },
  { title: "Fab Plant — ground vehicles", kinds: ["stinger", "flak-crawler", "mortar", "mastodon", "lancer"] },
  { title: "Assembly Bay — robot infantry", kinds: ["trooper", "rocket-squad", "sniper"] },
  { title: "Airpad — flying drones", kinds: ["scout", "wasp", "raptor", "hornet", "mender", "condor"] },
  { title: "Gantry — Goliath", kinds: ["goliath"] }
];

const BUILT_AT: Record<string, string> = { hq: "HQ", "fab-plant": "Fab Plant", airpad: "Airpad", "assembly-bay": "Assembly Bay", gantry: "Gantry" };
const TARGETS = { ground: "Ground", air: "Air", both: "Ground + air", none: "Unarmed" };

type Threat = UnitKind | "turret" | "sam-site";
const threatName = (k: Threat): string =>
  k === "turret" ? "Turret" : k === "sam-site" ? "SAM Site" : UNITS[k].name;
const threatLink = (k: Threat): string =>
  k in UNITS ? `<a href="#${k}">${threatName(k)}</a>` : threatName(k);

// "Weak against" is the inverse of the advisor's counter table
const counteredBy = (kind: UnitKind): Threat[] =>
  (Object.entries(COUNTERS) as [Threat, Threat[]][]).filter(([, beats]) => beats.includes(kind)).map(([k]) => k);

const stat = (value: string | number, label: string): string =>
  `<div class="stat"><b>${value}</b><span>${label}</span></div>`;

const fmt = (n: number): string => String(Math.round(n * 100) / 100);

/** One of the Goliath's weapon systems: what it fires, how hard and how far, and when damage takes it offline. */
function goliathWeapon(w: GoliathWeaponStats): string {
  const bits = [
    `<b>${w.name}</b> ${w.dmgType}`,
    `${fmt(shotDamage(w))} every ${w.shotInterval ?? 0.5}s`,
    `range ${w.range}${w.minRange ? ` (min ${w.minRange})` : ""}`,
    w.targets === "both" ? "ground + air" : w.targets,
    w.lostBelow > 0 ? `offline below ${Math.round(w.lostBelow * 100)}% HP` : "never offline"
  ];
  return bits.join(" · ");
}

function weaponLine(kind: UnitKind): string {
  const u = UNITS[kind];
  // four weapon systems, the long-ranged first (damage takes them in that order)
  if (kind === "goliath")
    return (["mortars", "laser", "cannons", "mg"] as const).map((k) => goliathWeapon(GOLIATH.weapons[k])).join("<br />");
  if (u.heal) return `<b>Repair beam</b> · ${u.heal} HP/s · range ${u.range}`;
  return armedLine(u);
}

/** A unit's or building's weapon: its damage type, how hard and how often, and what it's strong against. */
function armedLine(u: ArmedStats): string {
  if (u.targets === "none") return "<b>No weapon</b>";
  const strong = (Object.entries(DAMAGE_VS[u.dmgType!]) as [ArmorClass, number][])
    .filter(([a, m]) => a !== "structure" ? m > 1 : m >= 1.3)
    .map(([a, m]) => `${a === "structure" ? "buildings" : a === "infantry" ? "infantry" : `${a} armour`} ×${m}`);
  const bits = [
    `<b>${u.dmgType}</b> damage`,
    `${fmt(shotDamage(u))} per shot every ${u.shotInterval ?? 0.5}s`,
    u.minRange ? `min range ${u.minRange}` : "",
    u.splash ? `splash ${u.splash} tiles` : "",
    u.airMult ? `×${u.airMult} vs air` : "",
    strong.length ? `strong vs ${strong.join(", ")}` : ""
  ];
  return bits.filter(Boolean).join(" · ");
}

/**
 * A unit's description card: name, role, tags, stats, weapon, notes and matchups.
 * `portrait: false` leaves out its portrait, and `id: false` the anchor (models.html
 * puts both on the row it shares with the unit's 3D model).
 */
export function card(kind: UnitKind, { portrait = true, id = true } = {}): string {
  const u = UNITS[kind];
  const beats = (COUNTERS[kind] ?? []) as Threat[];
  const fears = counteredBy(kind);
  const tags = [
    `<span class="tag">${u.hover ? "Hover" : u.squad ? "Infantry" : u.domain === "air" ? "Air" : "Ground"}</span>`,
    `<span class="tag">${u.armor === "infantry" ? `squad of ${u.squad}` : `${u.armor} armour`}</span>`,
    u.capacity ? `<span class="tag">Carries ${u.capacity} squads</span>` : "",
    `<span class="tag">${BUILT_AT[u.builtAt]}</span>`,
    u.requires ? `<span class="tag tech">⚗ Needs Tech Lab</span>` : ""
  ].join("");
  const matchups =
    beats.length || fears.length
      ? `<div class="matchups">
          <div class="beats"><h4>Strong against</h4>${beats.map(threatLink).join(", ") || "—"}</div>
          <div class="fears"><h4>Weak against</h4>${fears.map(threatLink).join(", ") || "—"}</div>
        </div>`
      : "";
  return `<article${id ? ` id="${kind}"` : ""}>
    <div class="head">
      ${portrait ? `<img src="./assets/icons/${kind}.webp" alt="" loading="lazy" />` : ""}
      <div>
        <h3>${u.name}</h3>
        <div class="role">${u.role}</div>
        <div class="tags">${tags}</div>
      </div>
    </div>
    <div class="stats">
      ${stat(u.cost, "Scrap")}
      ${stat(u.hp, "HP")}
      ${stat(u.speed, "Speed")}
      ${stat(u.sight, "Sight")}
      ${stat(u.dps || (u.heal ? `+${u.heal}` : "—"), u.heal ? "Heal/s" : "DPS")}
      ${stat(u.range || "—", "Range")}
      ${stat(TARGETS[u.targets], "Hits")}
      ${stat(`${u.buildTime}s`, "Build")}
    </div>
    <div class="weapon">${weaponLine(kind)}</div>
    <ul class="features">${FEATURES[kind].map((f) => `<li>${f}</li>`).join("")}</ul>
    ${matchups}
  </article>`;
}

// ------------------------------------------------------------ buildings ---

/** The map's objectives: no one builds them, both sides fight over them. */
export type ObjectiveKind = "uplink" | "supply-crate";
export type SiteKind = BuildingKind | ObjectiveKind;

export const BUILDING_GROUPS: { title: string; kinds: SiteKind[] }[] = [
  { title: "Command and economy", kinds: ["hq", "depot", "radar"] },
  { title: "Production", kinds: ["fab-plant", "airpad", "assembly-bay", "tech-lab", "gantry"] },
  { title: "Defences", kinds: ["turret", "sam-site"] },
  { title: "Map objectives", kinds: ["uplink", "supply-crate"] }
];

const isObjective = (k: SiteKind): k is ObjectiveKind => k === "uplink" || k === "supply-crate";
const U = OBJECTIVES.uplink;
const D = OBJECTIVES.drops;
const mmss = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const OBJECTIVE_INFO: Record<ObjectiveKind, { name: string; role: string; tags: string[]; stats: [string | number, string][]; features: string[] }> = {
  uplink: {
    name: "Uplink relay",
    role: "A capturable relay in the contested middle of the map: scrap, vision and command charge to whoever holds it.",
    tags: ["Neutral", "Capturable"],
    stats: [[`${U.income}/s`, "Scrap"], [U.sight, "Sight"], [U.radius, "Zone"], [`~${Math.round(100 / U.maxRate)}s`, "Capture"]],
    features: [
      `Park units in its ${U.radius}-tile zone to swing the capture bar your way: neutral to yours takes about ${Math.round(100 / U.maxRate)} s with four units, taking it off the enemy twice that.`,
      `Infantry squads count ${INFANTRY.captureWeight}× and aircraft ${U.airWeight}×; harvesters don't count.`,
      `Its holder earns ${U.income} scrap a second, sees ${U.sight} tiles around it and charges their command meter for calldowns.`,
      "Some sit on islands only robot infantry flown in by Condor can take, and an island relay pays only while troops stand on it."
    ]
  },
  "supply-crate": {
    name: "Supply crate",
    role: "Parachuted onto the battlefield in pairs: the first unit there takes it.",
    tags: ["Neutral", "Announced to both sides"],
    stats: [[mmss(D.first), "First"], [`${D.every}s`, "Every"], [`${D.warning}s`, "Warning"], [`${D.ttl}s`, "Lasts"]],
    features: [
      `The first drop lands at ${mmss(D.first)}, then one every ${D.every} s, announced to both sides ${D.warning} s ahead with a pillar of light where they'll land.`,
      `Any unit but a harvester that comes within ${D.claimRadius} tiles claims it; unclaimed, it burns out after ${D.ttl} s.`,
      `Inside: ${D.scrap} scrap, Veterans (+1 rank to the claimer and allies within ${D.veteranRadius} tiles), Field Repair (${Math.round(D.repairShare * 100)}% HP to your units within ${D.repairRadius}), +${D.charge} command charge, or a rare free Lancer.`
    ]
  }
};

/** A building's or objective's name. */
export const siteName = (k: SiteKind): string => (isObjective(k) ? OBJECTIVE_INFO[k].name : BUILDINGS[k].name);

/** A building's or objective's card (buildingCard(), or the objective's own). */
export function siteCard(kind: SiteKind, { id = true } = {}): string {
  if (!isObjective(kind)) return buildingCard(kind, { id });
  const o = OBJECTIVE_INFO[kind];
  return `<article${id ? ` id="${kind}"` : ""}>
    <div class="head">
      <div>
        <h3>${o.name}</h3>
        <div class="role">${o.role}</div>
        <div class="tags">${o.tags.map((t) => `<span class="tag">${t}</span>`).join("")}</div>
      </div>
    </div>
    <div class="stats">${o.stats.map(([v, l]) => stat(v, l)).join("")}</div>
    <ul class="features">${o.features.map((f) => `<li>${f}</li>`).join("")}</ul>
  </article>`;
}

const BUILDING_FEATURES: Record<BuildingKind, string[]> = {
  hq: [
    "Every side starts with one, and it can't be built: the heart of your base.",
    `Builds Harvesters and takes their scrap, and salvages ${ECONOMY.hqTrickle} scrap a second on its own, so a broke side is never stuck.`,
    "Its point-defence gun swats early drone raids. It can't hit ground units: leave those to real defences.",
    "Lose it and every Goliath, and you lose the game."
  ],
  "fab-plant": [
    "The ground-vehicle factory: tanks, anti-air, artillery and hover tanks roll out of its hall.",
    `Queue up to ${ECONOMY.maxQueue} at a time, and tap the map to set where they rally.`,
    "Heavier models need a Tech Lab too."
  ],
  airpad: [
    "Launches every flying drone, from the Scout to the Condor dropship.",
    `Queue up to ${ECONOMY.maxQueue} at a time, and tap the map to set where they rally.`,
    "Aircraft ignore terrain, so an Airpad anywhere can strike everywhere."
  ],
  "assembly-bay": [
    "Assembles robot infantry: Trooper Squads, Rocket Squads and Sniper Teams.",
    "Squads are cheap, take cover in woods and capture Uplinks fastest.",
    "An anchored Goliath trains infantry too, wherever it stands."
  ],
  "tech-lab": [
    "Research, not production: it unlocks the heavier units at the other factories.",
    "Needs a Fab Plant, an Airpad or an Assembly Bay first.",
    "Lose it and those units can't be built again until you rebuild it."
  ],
  gantry: [
    `Builds the Goliath, one at a time over ${UNITS.goliath.buildTime} s: the mech goes up on its cradle in stages, the crane swinging armour plates on.`,
    "Needs every other factory and the Tech Lab. One per side.",
    "The enemy can always see it, and the Goliath taking shape on it: expect them to come for it."
  ],
  depot: [
    "A forward drop-off: harvesters unload at the nearest one, so a Depot by a distant field cuts their trip.",
    "Harvesters drop off at it just as at the HQ; it builds nothing.",
    "Built near an anchored Goliath, an outpost Depot takes scrap anywhere on the map."
  ],
  turret: [
    "Autocannon defence that hits ground and air.",
    `Mortars out-range it (${UNITS.mortar.range} tiles to its ${BUILDINGS.turret.range}): crack it with artillery, not tanks.`,
    `Kinetic shells: weaker against heavy armour (×${DAMAGE_VS.kinetic.heavy}), so Mastodons shrug it off.`
  ],
  "sam-site": [
    `Long-range anti-air missiles, reaching ${BUILDINGS["sam-site"].range} tiles: further than any aircraft's weapon.`,
    "Can't shoot at anything on the ground: tanks and artillery roll right past it.",
    "Pair it with a Turret to cover both."
  ],
  radar: [
    `Sees ${BUILDINGS.radar.sight} tiles in every direction, the widest view in the game, its dish sweeping round.`,
    "Watch for attacks coming through the fog, or spot the next field.",
    "Unarmed and lightly built: easy to lose to a raid."
  ]
};

const B_NAME = (k: BuildingKind): string => `<a href="#${k}">${BUILDINGS[k].name}</a>`;
const U_NAME = (k: UnitKind): string => `<a href="#${k}">${UNITS[k].name}</a>`;

/**
 * A building's description card: name, role, tags, stats, weapon, notes and
 * what it builds or unlocks. `id: false` leaves out the anchor (as card()).
 */
export function buildingCard(kind: BuildingKind, { id = true } = {}): string {
  const b = BUILDINGS[kind];
  const kinds = Object.keys(UNITS) as UnitKind[];
  const builds = kinds.filter((k) => UNITS[k].builtAt === kind);
  const unlocks = kinds.filter((k) => UNITS[k].requires === kind);
  const tags = [
    `<span class="tag">${b.size}×${b.size}</span>`,
    b.dropOff ? `<span class="tag">Scrap drop-off</span>` : "",
    b.unique ? `<span class="tag">One per side</span>` : "",
    b.alwaysVisible ? `<span class="tag">Always visible</span>` : "",
    b.requires ? `<span class="tag tech">Needs ${b.requires.map((k) => BUILDINGS[k].name).join(" or ")}</span>` : "",
    b.requiresAll ? `<span class="tag tech">Needs ${b.requiresAll.map((k) => BUILDINGS[k].name).join(", ")}</span>` : ""
  ].join("");
  const armed = b.targets !== "none";
  const lists = [
    builds.length ? `<div class="beats"><h4>Builds</h4>${builds.map(U_NAME).join(", ")}</div>` : "",
    unlocks.length ? `<div class="beats"><h4>Unlocks</h4>${unlocks.map(U_NAME).join(", ")}</div>` : "",
    b.requires || b.requiresAll
      ? `<div class="fears"><h4>Needs</h4>${b.requires ? b.requires.map(B_NAME).join(" or ") : b.requiresAll!.map(B_NAME).join(", ")}</div>`
      : ""
  ].filter(Boolean);
  return `<article${id ? ` id="${kind}"` : ""}>
    <div class="head">
      <div>
        <h3>${b.name}</h3>
        <div class="role">${b.role}</div>
        <div class="tags">${tags}</div>
      </div>
    </div>
    <div class="stats">
      ${stat(b.cost || "—", "Scrap")}
      ${stat(b.hp, "HP")}
      ${stat(b.sight, "Sight")}
      ${stat(b.buildTime ? `${b.buildTime}s` : "—", "Build")}
      ${armed ? stat(b.dps, "DPS") : ""}
      ${armed ? stat(b.range, "Range") : ""}
      ${armed ? stat(TARGETS[b.targets], "Hits") : ""}
    </div>
    ${armed ? `<div class="weapon">${armedLine(b)}</div>` : ""}
    <ul class="features">${BUILDING_FEATURES[kind].map((f) => `<li>${f}</li>`).join("")}</ul>
    ${lists.length ? `<div class="matchups">${lists.join("")}</div>` : ""}
  </article>`;
}
