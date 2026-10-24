# Battle Drones — Design

A mobile-friendly real-time strategy game in the Command & Conquer tradition.
Two armies of drones — flying and ground-based — battle for territory and
resources. Single-player skirmish against an AI commander (or watch two AIs
fight), playable in a mobile browser and installable as a PWA.

This document started as the MVP design (6 units, 4 buildings, one map);
the v2 overhaul expanded it to 11 units, 8 buildings, 5 maps across 4
biomes with gameplay-relevant terrain, a damage/armor model, AI
personalities and difficulty levels, painted art and procedural audio.
Robot infantry (three squad types, the Condor dropship and the Assembly
Bay; draft spec in INFANTRY.md) took it to 15 units and 9 buildings. The
Goliath (a giant walking mech that is also a mobile base, built at a new
top-of-the-tree Gantry; spec in GOLIATH.md) took it to 16 units and 10
buildings, and renamed the Titan tank the Mastodon.

## Design pillars

1. **Readable at phone size.** Every unit, building, and state must be
   identifiable on a 6" screen. Big touch targets, high-contrast sprites,
   minimal chrome.
2. **A full match in a coffee break.** Target match length ~10 minutes
   against a human (AI-vs-AI games settle in a median of ~10½ since robot
   infantry, ~8¼ before; see Balance & pacing).
3. **Air vs ground is the core tension.** The rock-paper-scissors between
   flying and ground drones is what makes this game *Battle Drones* and not
   a generic RTS. Every roster and map decision should feed it.

## Locked-in decisions

| Decision | Choice |
|---|---|
| Platform | Web PWA — TypeScript, three.js (WebGL), rendered at device pixel ratio (≤ 2×, adaptive) |
| Opponent | Single-player vs scripted AI (6 personalities × 3 difficulties), AI vs AI spectator, Last Stand waves, or the Ops campaign |
| Core mechanics | Resource harvesting, base building, tech tree, fog of war, terrain |
| Win condition | Destroy the enemy HQ and every Goliath it has (Last Stand: survive as many waves as you can; Ops: the op's objective) |
| Roster size | 16 units (three of them robot infantry squads, one the Goliath), 10 buildings |
| Art | Procedural low-poly 3D models; painted terrain (OpenAI `gpt-image-2.5-sunburst`, see ART.md) draped over a 3D heightfield |
| Controls | Full-screen touch-first (mouse also supported); portrait and landscape both first-class |

## Tech stack

- **Language:** TypeScript, strict mode.
- **Engine:** [three.js](https://threejs.org/) for WebGL rendering, with a
  small purpose-built layer on top (`src/game/three/`, see **3D view**
  below): camera rig, procedural models, terrain, particles, tweens. Game
  *logic* stays in plain TS modules that don't import three.js, so the
  simulation is unit-testable headlessly.
- **Build tooling:** Vite + `vite-plugin-pwa` (service worker, installable,
  offline-capable after first play of each map). The worker precaches each
  build and serves the game from that cache, so a deploy lands in the
  background: the page asks for a new build on launch, on coming back to the
  foreground (at most once a minute) and every 30 minutes. The new worker
  activates at once and takes over the open page, and the home screen then
  shows a **"✨ New version ready · Update ↻"** pill whose button reloads into
  it (`src/ui/update.ts`). A build that lands mid-match is never pushed on the
  player: every Menu button reloads, so the next menu already runs it.
  Painted map terrain is cached on first play and served cache-first after
  that, so its chunk URLs carry the map's revision, a hash of its chunks
  taken at build time (`src/game/map-art.ts`): a repainted map comes from new
  URLs, never from a returning player's cache (where the Archipelago's
  96-tile paint once turned up on its 108-tile grid).
- **Testing:** Vitest for the simulation (economy, pathfinding, combat,
  terrain, tech tree, AI, maps); a Playwright smoke test that drives the
  real touch input paths; a headless balance harness (`tools/balance.ts`).
- **Audio:** every sound — effects, the adaptive score and the ambience — is
  synthesised live with WebAudio; no audio files.
- **No server.** Everything runs on-device. Settings persist in
  `localStorage`.

## The game

### Maps & terrain

Six 2-player maps, all point-symmetric (rotated 180°) so both sides are
equal, and one 4-player map with four-way rotational symmetry (turned 90°,
see FFA.md), painted procedurally from a seed in `src/sim/maps.ts`. The rules are
symmetric too: every search whose ties go by scan order runs in each side's
own frame (see *Side fairness* under Balance & pacing). The map picker lists
them in `MAPS` order, the classic Proving Grounds first; the row scrolls
sideways on a phone, so the side with more cards fades out and shows a
chevron (`ui/hscroll.ts`).

| Map | Size | Biome | Character |
|---|---|---|---|
| Proving Grounds | 48² | Temperate | The original MVP map: rock ridges, one contested field, an expansion field out on each flank |
| Riverlands | 56² | Temperate | A river splits the valley: one bridge, two muddy fords, woods on the banks |
| Dune Sea | 56² | Desert | Open sands between mesas, a palm oasis in the middle, three lanes |
| Frostbite | 48² | Arctic | A frozen sea in the centre — short, brutal, hover-friendly |
| Ashlands | 64² | Volcanic | Lava rivers carve three plateaus joined by bridges; air rules |
| Compass Rose | 72² | Arctic | Four players, one per corner: frozen streams with a bridge and a ford split the quarters, five Uplinks (the centre and one by each bridge); a free-for-all (see FFA.md) |
| Archipelago | 108² | Tropical | Seven island Uplinks only troops flown in by Condor can take; two bridges, scarce scrap (see *The Archipelago*) |

Terrain matters (numbers in `TERRAIN` in `src/sim/balance.ts`):

| Terrain | Tanks | Hover | Infantry | Air | Notes |
|---|---|---|---|---|---|
| Ground | ✓ | ✓ | ✓ | ✓ | Buildable |
| Road / Bridge | ✓ fast (1.35×) | ✓ | ✓ fast (1.35×) | ✓ | Roads are buildable, bridges not |
| Rough (mud, scree, slush, cinders) | ✓ slow (0.6×) | ✓ full speed | ✓ full speed | ✓ | |
| Woods | ✓ slow (0.55×) | ✓ slow | ✓ full speed | ✓ | Ground units inside take 30% less damage (infantry 50%) |
| Shallows (fords) | ✓ slow (0.5×) | ✓ | ✓ (0.8×) | ✓ | |
| Water / lava | ✗ | ✓ | ✗ | ✓ | The Lancer's party trick |
| Open sea (Archipelago) | ✗ | ✗ | ✗ | ✓ | Too deep and rough even for hover |
| Rock | ✗ | ✗ | ✗ | ✓ | |
| Scrap field | ✓ | ✓ | ✓ | ✓ | Resource: 1500 per tile |
| Crystal field | ✓ | ✓ | ✓ | ✓ | Rich resource: mines 1.6× faster per load |

Ground pathfinding is A* weighted by terrain speed, so tanks prefer roads
and skirt mud. Robot infantry path on foot by their own speed column
(`footSpeed`; the `foot` move class in `world.ts`), so squads cut straight
through woods and mud that tanks go round. Air units fly straight over
everything.

Every movement class also has **regions** (`world.ts regionLabels`): the
connected stretches of terrain it can walk, labelled once per map from
terrain alone (buildings come and go; terrain doesn't). A goal in another
region (an island, the far shore) is answered in one lookup: A* snaps it to
the nearest tile within 6 that the unit *can* reach, or gives up at once,
where it used to flood the whole landmass every tick. Combat drops an attack
order, auto-target or retaliation on a target out of range that the unit
can never get within range of (`engageable`), so a garrison shelled from
across the water doesn't freeze on a dead order while enemies land beside
it. A* reuses its scratch arrays; a new building re-plans only the paths
that cross or brush its footprint; a drop point out at sea is found by an
expanding ring search. On the 108² Archipelago an AI-vs-AI match costs
about what one on the 64² Ashlands does (a prototype before these fixes ran
~20× slower, 85% of it in A*).

### The Archipelago

The map built to make robot infantry, the Condor and aircraft the heart of
the game, and to make the fight about Uplinks. 108² (nearly four times the
area of Riverlands). The two HQs' landmasses are split by **open sea** along
the diagonal, necked at **two bridges** near the middle (the only land route:
a test cuts them and checks nothing crosses) and opening into a wide gulf in
each empty corner: a bay round the corner whose shore swings out and in with
broad headlands and coves, and which leaves the necks as they are.

- **Seven island Uplinks**, every one on an island: each side's two home
  isles off its own coasts (2.5 scrap/s), an outer isle out in each gulf
  (3.5) and the centre island in a lagoon between the bridges (5). Each
  island has at least 4 tiles of walkable ground round its relay (room for
  two drops, and to dodge a Barrage).
- **Scattered, not packed**: a gulf's three isles each have their own shape
  (a few overlapping lobes: the outer isle the biggest, long and ragged,
  red's home isle rounder), sit at uneven distances from each other, and
  have at least 4 tiles of open sea to the next island or a coast (a test
  checks; it also checks no other speck of land breaks the surface). Reef
  shoals and limestone sea stacks (rock: nothing stands on them) fill the
  water between. The map grew from 96² to give the gulfs that room: the
  middle (lagoon, necks, bridges, roads, the HQs and their distances to the
  bridges) is the 96² layout moved to the new centre, and each HQ gained
  open ground behind it.
- **Infantry only** (`Uplink.infantryOnly`, `captureWeight` in
  `objectives.ts`): only robot squads count in an island relay's ring, to
  take it and to contest it. Aircraft, the Condor itself and vehicles count
  nothing, so they can't take one, nor freeze a capture by hovering over it.
- **Crewed**: an island relay pays its scrap and ⚡ charge only while the
  holder's squads stand in it. Held but empty it stays yours (enemy troops
  must still land to take it), but pays nothing: holding one costs a squad
  sitting on it. That's what aircraft are for here: they can't take a relay,
  but killing its garrison switches it off.
- **Only by Condor**: the sea stops hover tanks too, and on a map with
  islands (`Rules.islands`) buildings, factory roll-outs and Drop Pods stay
  on land joined to the side's own HQ (`onHomeLand`; `Rules.homeTiles`
  remembers where it stood, so this holds once the HQ has fallen, or under
  Nomads was never built), so no turret, Assembly Bay or pod crew from home
  ever reaches an island. The one exception is a Goliath: two Condors can
  lift one onto an island, where it anchors like anywhere else, trains
  squads that step out round its feet, and lets outposts go up in its
  build ring, whose units roll out on the island too (see *The Goliath*).
  Harvesters only count a Goliath or an outpost as a drop-off if they can
  drive up to it.
- **Scarce scrap**: a 9-tile home field (13,500) and two crystal tiles out
  by a bridge per side; HQ trickle 3/s instead of 2. Relays are the economy.
- **Start**: each side gets a free **Condor** beside its HQ with its Trooper
  Squad already aboard (through the rules' `startUnits`, so Airborne doesn't
  add a second one and the AI plans around it).
- **The free replacement Condor** (`lifeline.ts`): a side with no Condor
  flying or being built gets one 45 s later, flown in from the map edge
  nearest its HQ to set down beside it (with no HQ, as under Nomads or
  after it falls with a Goliath fighting on, beside the Goliath, an anchored
  one first), with a free Trooper Squad aboard if
  the side has fewer than 2 squads. Map-given units (`Unit.free`) leave no
  wreck and charge no ⚡ meter when lost, so throwing a Condor away gains
  nothing: a bought one comes back free only after the wait, and the squad
  only when the side is really short of infantry. The top bar counts it down
  (🚁) and the radio calls it in.
- **Modes and mutators**: skirmish (and AI vs AI) only. Not in Last Stand
  (`lastStand: false`: hidden in the picker), not in the Ops, not in the
  Daily Op (which draws from a frozen list of the five older maps, so adding
  a map never changes a day's map). **Air War** is banned here
  (`bannedMutators`: no Condors, no infantry, no way onto an island): greyed
  out in the picker and dropped from the match. The ★★ star is "win in under
  12:00" here (`starSecs`).
- **Controls**: with a loaded Condor selected, a plain **tap on an island**
  drops its troops there (no hidden long-press for the map's main move),
  and every island relay they could take shows gold landing chevrons. Tanks
  or squads sent at an island get a one-line tip on how to get there.
  Island relays have their own ring (long dashes, a dotted inner ring); an
  empty one dims, its HUD pip goes hollow and the radio warns "Uplink
  unmanned". The opener picker marks Air Wing as the one that suits it.
- **AI** (`ai/airlift.ts`): on a map with island relays the commander's
  airlift owns every Condor (the harvester-raid planner stands down), for
  every personality and difficulty. It scores neutral, enemy-held and its
  own empty relays by pay, flight time, a per-personality caution and what
  it has seen there; it only lands bringing 1.3× what's there (squads and
  the Wasps and Hornets circling the island), and a lone squad never races
  the enemy to a relay equally near both. Each Condor boards 1–2 healthy
  squads at home (Rocket Squads first once the enemy flies), flies a route
  clear of the anti-air it has seen or remembers, lands in the ring on the
  relay's own island and turns back after losing 30%. Garrisons are held on
  their island and walk back after a chase; a secured island's spare squads
  are flown on when nobody is free at home. Enemy Condors near its relays,
  base or dropships get Raptors (the threat response skips unarmed units);
  idle Wasps and Hornets clear an enemy garrison no anti-air covers. Here
  every build order has an Assembly Bay second and an Airpad third, 2
  Condors (3 on Hard), a 30% infantry floor, ground vehicles held to 15% and
  up to 6 Raptors. Easy flies one Condor from 0:30, to neutral or its own
  relays only. Everywhere, the AI only sends units where they can go:
  capture squads and garrisons skip island relays, threat responders must
  be able to get in range, island squads stay out of army value and waves,
  harvesters stay on their own side of the bridges and aren't rebuilt once
  those fields are dry, and sweeps, dodges and veteran retreats check
  reachability. Before it, the AI never took an island on purpose.
- **Measured** (`tools/pacing.ts --maps archipelago`, all 30 pairings × 4
  seeds, Normal, 120 matches): both sides take an island in every match
  (first capture median 0:30); 20.9 island captures per match, 12.3 of them
  retakes, 34.8 relay flips; Condors drop 45.1 squads per match onto relays
  (5.7 elsewhere); 25% of unit deaths within 8 tiles of a relay. Value
  built: infantry and Condors 46%, aircraft 43%, ground vehicles 12%.
  Personality win rates 23–80% (Air Swarm 23, Balanced 35, Ironclad 45,
  Boom 53, Rush 58, Skyforce 80; about ±8 points at 40 games each). 3 of
  120 drawn at 25 min; decided median **16:03** (p10 12:21, p90 21:03),
  longer than the other maps: the side that holds the relays (about 83% of
  crewed relay-time) starves the other, but an air-heavy army is slow to
  break turrets and SAM sites. The same panel on the old 96² layout, same
  code: 4 draws, decided median 15:15 (p10 12:01, p90 18:49), 19.9
  captures, win rates 28–73% (Skyforce 63, Rush 73): the wider gulfs add
  under a minute, mostly to the longest games; Skyforce's rise is at the
  edge of the noise. Raising relay income 50% (on the 96² layout) took
  about a minute off and swung the win rates, so the numbers stay as they
  are for now. Easy vs Easy plays (9.5 squads airlifted a match, first
  capture median 1:03). Cost: about 5% more per sim-minute than the 96²
  layout, measured side by side; the other maps' round robins and the
  beginner harness are unchanged.

### Economy

- Single currency: **Scrap**. Harvesters haul 100 per trip from scrap piles
  or glowing crystals back to the nearest **drop-off** (HQ, Depot or an
  anchored Goliath; `nearestDropSite`). Harvesters flee home when shot and
  auto-mine when built. One bound for a Goliath reroutes to the nearest
  other drop-off the moment it starts packing up; with none left, a loaded
  harvester waits for a Goliath to dig in again instead of going idle.
- Each HQ also salvages a trickle of 2 scrap/second, so no side can be left
  permanently broke, and each anchored Goliath 0.75 (half an Uplink's pay:
  `GOLIATH.trickle`), so a side with no HQ (the Armada, Nomads, an HQ lost)
  isn't left with nothing once the fields run dry. Four AIs under the
  Goliath Armada once mined Compass Rose out by 10:00, and the three sides
  without Uplinks earned nothing for the hour after.
- A scrap tile holds 1500 and a crystal tile 1200, and all of it can be
  mined: field scrap is kept as a float. (Through v14 it was kept as a
  whole number, which dropped the tenths of every 2.1 a harvester takes
  each tick, so a tile gave up 3 for every 2.1 hauled and a field yielded
  70%.)
- Starting stockpile: 600 scrap, one harvester and one Trooper Squad, plus
  the side's opener (below) — so in practice two or three harvesters and a
  factory.
- **Battlefield salvage** (below): wrecks are the second income stream,
  ~20% of all scrap earned in AI-vs-AI play.

### Battlefield salvage

Every destroyed combat unit leaves a burning wreck worth **30% of its
cost** (Stinger 45, Mastodon 143, Hornet 113 …; harvesters and robot infantry
squads leave none; Last
Stand's wave units only 5%, see Last Stand) for **60 s**. After 2.5 s it
has cooled enough to touch, and the first ground
unit of *either* side — harvesters included — whose centre comes within
0.9 tiles scoops it up (income multipliers apply; a side on a frozen
economy — an op's zero income, or Last Stand's waves — can't cash wrecks in, so its units drive
over them, no "+0" pops or salvage tip, and the wreck stays for the enemy).
Fights leave loot worth
holding the field for, a defender who breaks a wave gets paid for it, and
the losing side has a way back in.

- Aircraft wrecks land where they fall; a death spot no tank could reach
  (rock, water, lava, a building) slides to the nearest passable point
  within 2 tiles, else the wreck is lost. Wrecks never block movement or
  placement (a building placed on one clears it for its owner).
- At most 60 wrecks at once (the oldest burns out first).
- **A Goliath leaves no hull**: it scatters 30% of its list price
  (`GOLIATH.salvage`: 480 scrap, scaled like any wreck) over 6–8 scrap
  piles (`Wreck.pile`), each up to 2.5 tiles out, so collecting all of it
  means holding the ground. Piles lie for 90 s (`GOLIATH.pileTtl`; a
  wreck's 60) and cool like wrecks; one that would land where no tank can
  reach slides to ground within 2 tiles, or is lost. A **Gantry** destroyed
  with a Goliath on its cradle loses the build and strews 30% of what was
  paid for it × the build's progress over up to 4 piles round it
  (`GOLIATH.gantrySalvage`). A pile is a heap of metal and scrap lumps, not
  a burnt hull, flung out of the Goliath as it slams down (or out of the
  Gantry as it blows) to land in a puff of dust, seen even in the fog.
- Looks: the dead unit's own sprite, charred, turret blown off its ring;
  embers and smoke while hot, then a gold glint and a faint warm glow that
  say "loot"; it fades over its last 10 s. Downed aircraft tumble from
  flying height first. Pickups pop a gold "+52" (merged when several land
  together) with a coin blip; the enemy's pickups show in muted red.
  A sweep of 400+ in a few seconds calls out a "SALVAGE HAUL" banner.
  Wrecks show only where you have vision and are remembered like buildings
  until you see they're gone; gold minimap dots. The income rate (+N/m)
  includes salvage, and the end screen has a Salvaged row.
- Measured (AI-vs-AI round robin with openers, all 5 maps, 300 games
  per setting): about 6,100 scrap salvaged per match (18% of income);
  stalemate draws 30 → 17; the side ahead by 200+ value at 2:00 / 3:00
  went on to win 88% / 92% → 84% / 88%; median length 5.5 → 5.7 min, mean
  8.8 → 7.8. Shares of 25% and 35% were tried too: 35% removes more draws
  but hands the leader its edge back (87% / 88%); 25% was within noise
  of 30%.

### Openers (quick start)

Every skirmish opens on three cards and the clock waits for the pick, so
there is no dead "wait for the first factory" stretch (the old opening had
a 14 s idle gap and the first combat unit at 0:51):

| Opener | You get | Plays like |
|---|---|---|
| **Blitz** | Fab Plant + 3 Stingers + 2 harvesters, −100 scrap | Army on the field at 0:00; raid early |
| **Industry** | Fab Plant + 3 harvesters + 200 scrap | Out-mine now, out-build later |
| **Air Wing** | Airpad + 3 Wasps + 2 harvesters | Fast strike drones; dies to Flak |

Blitz and Industry are worth 650 scrap; the Airpad is a side-grade (you
still want a Fab for anti-air), so Air Wing carries a third Wasp (950). A
720-game AI-vs-AI opener matrix (every opener pair, both sides, six
personality pairings, five maps; measured before robot infantry) has them
winning 53% / 55% / 42% of decided games — Air Wing rewards a human's micro
more than the AI's.

`src/sim/openers.ts` places the factory deterministically ~4.5 tiles from
the HQ toward the map centre (legal, off the roads and the harvest route,
never walling anything in), with every search done in the side's own
frame so both sides get mirror-image setups. `createMapWorld(id, { openers: { blue, red } })` applies them for
tests and the balance harness; without the option the classic start is
unchanged. The AI picks by personality (Rush → Blitz, Boom → Industry,
Air Swarm / Skyforce → Air Wing, Balanced → any, Ironclad → Blitz or
Industry, seeded) and holds its raiders home for the first 45 s. The
cards name the enemy personality, so the pick can be a counter-pick.

**The starting squad.** Whatever the opener, every side also starts with
one **Trooper Squad** beside its HQ, on the other flank from the starting
harvester (west of blue's HQ, east of red's: the mirror image, snapped onto
ground a squad can stand on). `createMapWorld` places it, so every skirmish,
Daily Op, opener and objectives match has it, and so do Ops (the player, and
an AI side that starts with an HQ) and the Last Stand defender (the wave
side's units are cleared as before). Air War keeps it but bans raising
more infantry, and the Condor that could fly it into the fight; Airborne
parks a Condor, a Rocket Squad and a Sniper Team round it (one of each
squad); Veterans ranks it like every other combat unit. It is an early guard against the
first raids — it hits air at half damage — and a cheap Uplink holder.
Every match now has two more units than before, so the balance tools were
re-run with it in (see *Infantry pass* under Balance & pacing).

### Buildings (10)

| Building | Role | Requires |
|---|---|---|
| **HQ** | Pre-placed. Builds Harvesters, takes scrap, point-defence gun vs aircraft. Lose it and every Goliath, lose the game. 3×3. | — |
| **Fab Plant** | Builds ground vehicles. 2×2. | — |
| **Airpad** | Builds aircraft (and the Condor dropship). 2×2. | — |
| **Assembly Bay** | Builds robot infantry: Trooper Squads, Rocket Squads, Sniper Teams. 2×2. | — |
| **Tech Lab** | Unlocks Mortar, Mastodon, Lancer, Hornet and Sniper Team. 2×2. | Fab Plant, Airpad or Assembly Bay |
| **Depot** | Forward scrap drop-off for distant fields. 2×2. | — |
| **Turret** | Autocannon, hits ground and air. 1×1. | — |
| **SAM Site** | Long-range anti-air missiles. 1×1. | — |
| **Radar** | Reveals a 13-tile radius through the fog. 1×1. | — |
| **Gantry** | Builds the Goliath, one at a time. One per side; the enemy always sees it, and the Goliath taking shape on it. 3×3. | Fab Plant, Airpad, Tech Lab **and** Assembly Bay |

C&C build flow: pick a structure → it constructs on a timer → tap it again
and place it on a valid spot within 6 tiles of your base (see "Command UX"
below), or anything but an HQ within 3 tiles of an anchored Goliath, as an
**outpost** that never counts as base for build range (see *The Goliath*
below). One construction at a time. Buildings can be **sold** for 50%
(scaled by health, plus whatever is still queued in them, at what it
cost).

### Units (16)

| Unit | Built at | Domain | Hits | Role |
|---|---|---|---|---|
| **Harvester** | HQ | Ground | — | Economy |
| **Scout** | Airpad | Air | — | Fast, big sight radius |
| **Stinger** | Fab | Ground | Ground | Cheap fast light tank |
| **Flak Crawler** | Fab | Ground | Air | The anti-air answer |
| **Mortar** ⚗ | Fab | Ground | Ground | Long-range splash artillery with a minimum range; shells are real projectiles and can be dodged |
| **Mastodon** ⚗ | Fab | Ground | Ground | Super-heavy twin-cannon tank |
| **Lancer** ⚗ | Fab | Hover | Both | Anti-armour laser that also hits air (at reduced effect) and crosses water |
| **Wasp** | Airpad | Air | Ground | Rocket strike drone |
| **Raptor** | Airpad | Air | Air | Interceptor |
| **Hornet** ⚗ | Airpad | Air | Ground | Heavy bomber: splash vs ground and bases |
| **Mender** | Airpad | Air | — | Repair drone: heals units and buildings |
| **Trooper Squad** | Assembly Bay | Foot | Both | Cheap rifle robots; half damage vs air; best in woods |
| **Rocket Squad** | Assembly Bay | Foot | Both | Anti-armour rockets: kills Mastodons and Hornets, weak vs infantry |
| **Sniper Team** ⚗ | Assembly Bay | Foot | Ground | Long-range marksmen: deletes infantry, useless vs vehicles; hides in woods |
| **Condor** | Airpad | Air | — | Unarmed dropship: carries two squads over anything |
| **Goliath** | Gantry | Ground | Both | Giant walking mech and mobile base; loses its weapons as it is hurt |

⚗ = needs a Tech Lab (the Gantry already does).

**Robot infantry** (`src/sim/infantry.ts`). A squad is **one sim unit**
drawn as several robots: one HP pool, and a robot falls each time HP
crosses a 1/N step (robots standing = ⌈N × HP / max⌉). Its damage per shot
scales with the robots still standing (× standing / N), so a squad shoots
weaker as it is whittled down. One tap target, one entry in a squad chip,
no extra pathing cost. Squads are ground units of armour class `infantry`
that move on foot (*Maps & terrain*), leave no wreck, count double on an
Uplink, claim crates and rank up like any other unit.

| | Trooper Squad | Rocket Squad | Sniper Team | Condor |
|---|---|---|---|---|
| Robots / seats | 5 | 3 | 2 | carries 2 squads |
| Cost / HP | 100 / 190 | 175 / 210 | 200 / 120 | 200 / 400 |
| Speed / sight | 1.8 / 5 | 1.6 / 6 | 1.7 / 8 | 3.6 / 6 |
| Weapon | 15 DPS, range 3, kinetic; ×0.5 vs air | 26 DPS, range 4, cannon (rockets); ×1.5 vs air | 50 a shot every 2.5 s, range 7, precision (150 vs infantry) | none (medium armour) |
| Build time | 6 s | 9 s | 10 s | 9 s |

One Sniper shot takes about three robots off a Trooper Squad; two wipe a
Rocket Squad. The Trooper and Rocket numbers were retuned from INFANTRY.md's
draft (225 HP / 18 DPS; 180 HP and ×0.8 vs air): see *Infantry pass* under
Balance & pacing.

**The Condor** (`src/sim/transport.ts`). Squads **board** it by walking up
to it: after 1 s within 1.2 tiles a squad climbs in and leaves the map. A
squad aboard is off the field (out of `World.units`), so it can't fire, see,
capture or be shot; an idle Condor drifts over to meet a squad coming to
board it and holds still while one climbs in. To **unload**, the Condor
flies to the drop point, hovers 1.5 s and sets every squad down around it,
then backs off 1.5 tiles the way it came and idles there, off their heads.
Squads are set down at least 0.4 tiles from anything they can't stand on
(Water, Rock, a building) and from the map's edge, so no robot stands in
the river, and a squad's width apart, so separation never shoves one
toward the water. The point snaps to the nearest such spot within 6 tiles;
out over a big lake (Frostbite's frozen sea), to the nearest shore at any
distance. Every scan runs in the side's own frame, so drops are
mirror-fair. Only a map with no ground at all refuses an unload, and a
move or stop order calls a drop off. **Shot down** over ground a squad
could stand on, its passengers bail out with at most 50% HP, set down
clear of the water's edge the same way; over water, rock or a building
they go down with it, each a unit lost and a kill for whoever downed the
Condor. EMP freezes Condors and boarding squads like anything else.

**The Goliath** (`src/sim/goliath.ts`; spec in GOLIATH.md). A giant
walking mech that is also a base on legs. The Gantry builds one at a time
(`GOLIATH.queueMax`) and it walks off the cradle when it is done. It moves
like a tank (the `ground` move class: slow in mud and woods, no water or
rock) and fights with four weapon systems at once, which it loses one by
one as it is hurt.

| | Goliath | Gantry |
|---|---|---|
| Cost / HP | 1,600 (+25% per Goliath owned) / 3,000, heavy armour | 600 / 1,200 |
| Speed / sight | 1.0 / 10 | — / 5 |
| Size | radius 1.0; anchors on a 2×2 patch | 3×3 |
| Build time | 60 s | 25 s |

| System (`GOLIATH.weapons`) | Like | Damage | Range | Hits | Offline below | Back at |
|---|---|---|---|---|---|---|
| **Mortars** (two shoulder tubes, taking turns) | 2 Mortars | 36 DPS explosive: a shell every 1.5 s, splash 0.9 | 2.5–8 | Ground | 75% HP | 80% |
| **Eye laser** | 1 Lancer | 28 DPS laser, ×0.65 vs air | 4.5 | Both | 50% | 55% |
| **Arm cannons** (two, taking turns) | 1 Mastodon | 46 DPS cannon: half a shell every 0.6 s | 4 | Ground | 25% | 30% |
| **Machine guns** | 1 Trooper Squad | 15 DPS kinetic, ×0.5 vs air | 3 | Both | never | — |

That is about 1,400 scrap of firepower (two Mortars, a Lancer, a Mastodon
and a Trooper Squad). `UNITS.goliath`'s own weapon line (125 DPS, range 8,
hits both) only sums them up for tooltips and estimates.

- **Walking and anchored.** Walking, it moves and fights, and that's all.
  The anchor command (the ⚓ chip, or G) digs it in where it stands, onto
  the middle of the nearest 2×2 patch (`GOLIATH.footprint`) of buildable
  ground with no building, Uplink platform, crate or ground unit on it,
  anywhere on the map: there is no build-range rule (`anchorBlocker` says
  why not: "Needs open ground", "Unit in the way", "Blocked", "Off the
  map"). Digging in takes 4 s (`anchorTime`) and packing up 6 s
  (`packTime`), so leaving under fire is the risky moment; an EMP pauses
  either. Dug in (anchoring, anchored or packing up), its patch is stamped
  into the occupancy grid like a building's: paths go round it, nothing is
  built or anchors there, and it is never pushed. It fires as usual. A move
  or attack-move sent to it packs it up, and it walks off once it is free;
  an attack order doesn't (it fires from where it stands), and a dug-in
  Goliath that is shot doesn't go after the shooter as an idle unit would.
- **Anchored, it is a base.** Harvesters unload at it, docking at the edge
  of its patch; those bound for it reroute to the nearest other drop-off
  the moment it starts packing up. It trains robot infantry on its own
  queue (up to 6) with no Assembly Bay (a Sniper Team still needs a Tech
  Lab): squads step out round its feet, on an island too, and head for its
  rally point, and the queue pauses while it walks, packs up or is EMP'd.
  And any building but an HQ can go up within 3 tiles of it (`buildRing`,
  from its centre to the building's footprint): an **outpost**.
- **Outposts** (`Building.outpost`, decided when the building is placed:
  one inside normal base range is a normal building, Goliath or not). An
  outpost never counts as base for build range (`inBaseRange`), so nothing
  can be built off it unless a Goliath anchors nearby again. Otherwise it
  works like any other building and keeps working after the Goliath has
  gone: an outpost Depot still takes scrap, an outpost factory rolls its
  units out round itself (on an island too).
- **Weapons.** Each system has its own clock and picks its own target: the
  ordered target when it can reach it, else what it was shooting while
  that stays in reach (switching to an enemy Mender that comes into reach),
  else the best target in its own reach. It fires on the move; on
  attack-move it halts once any weapon has a target, on an attack order
  once the target is in reach of a weapon that can hit it. The torso turns
  to the heaviest weapon's target.
- **Damage takes them offline**, longest reach first: the mortars below
  75% HP, the laser below 50%, the arm cannons below 25% (`lostBelow`).
  The machine guns always work, so it is never helpless against aircraft
  or infantry, and its reach (and the threat ring that shows it) shrinks
  as it weakens, 8 → 4.5 → 4 → 3 tiles: a hurt Goliath can no longer shell
  a base from afar.
- **Repair: Menders only.** A Field Repair crate passes it over and a rank-3
  Goliath doesn't patch itself up. A lost weapon comes back once HP is 5%
  of max above its line (`restoreMargin`: the mortars at 80%, the laser at
  55%, the cannons at 30%), after a 2.5 s reboot (`reboot`); knocked back
  under the line mid-reboot, it goes offline again. A Mender heals 10 HP/s,
  a third of a percent of 3,000: one takes 15 s to win back the 5% a
  weapon needs, three take 5 s, so it takes a cloud of them to make real
  progress (and the enemy shoots Menders first). A Mender's own pick
  favours a Goliath with a weapon down, rebooting or a few percent from
  coming back (`repairUrgency`). An EMP on the Goliath blocks repair and
  holds a reboot while it lasts.
- **Seen by everyone.** Sight 10, the best of any unit (Radar sees 13).
  The enemy always sees it (`UNITS.goliath.alwaysVisible`), and the Gantry
  with whatever it is building (see *Fog of war*).
- **Cost.** Each Goliath costs 25% of the list price more for every one
  the side already has, alive or on a Gantry's cradle (`goliathCost`:
  1,600, then 2,000, 2,400…), so losing one makes the next cheaper again.
  A cancel refunds what was paid (`QueueItem.paid`). The Gantry is
  `unique` (one per side, one under construction included) and needs all
  four of its prerequisites (`requiresAll`; the reason names the missing
  ones: "Needs Tech Lab and Assembly Bay").
- **Defeat.** A side is beaten only when its HQ **and** every Goliath are
  gone (`cleanupDeaths`: an HQ falls with no Goliath left, or the last
  Goliath falls with no HQ). With its HQ gone and a Goliath standing, a
  side plays on: it still builds near an anchored Goliath and in range of
  its surviving buildings (never a new HQ), and still calls down strikes
  ("Calldowns need an HQ or a Goliath"). Last Stand and Ops are bases to
  hold: there the HQ still decides.
- **Death.** It topples (the fall hurts nothing) and leaves no wreck: its
  salvage lies scattered in 6–8 scrap piles (see *Battlefield salvage*).
- **Readability.** Its health bar is wider and taller than a unit's and
  notched where each weapon goes offline; each lost system shows on the
  model (a smoking shoulder, a dark eye, drooping cannons; see *3D view*);
  a ring of dashes marks its current reach (strong when it is selected,
  faint for an enemy's) and a team-coloured ring its build ring while it
  is dug in; a progress arc round its feet counts down digging in and
  packing up; and the radio calls its news (see *Voices & announcer*).

**The two-Condor lift** (`src/sim/lift.ts`). Two empty Condors of its side
can carry a walking Goliath ("Pack up first" otherwise). Select them (of
several, the two nearest go) and tap the Goliath, or right-click it: they
fly in, hook on 1.1 tiles to either side of it (`lift.span`) and lift it
once both are on, and the selection becomes the lift. A tap then flies it
there to hover, a long-press flies it there and sets it down, **⇣ Set
down** (key U) puts it down where it hovers and ■ Stop holds it still; an
order given while the Condors are still hooking on waits until it is up
(a Stop calls the lift off). It flies straight at half a Condor's speed
(`lift.speedMult`), and never off the map's edge. A set-down point a
Goliath can't stand on (water, a building) drifts to the nearest ground
within 6 tiles that it can (`lift.setDownSearch`); with none, it hovers.
In the air it is an **air target** (`domainOf`) and only its machine guns
fire; its Condors take no passengers while they lift, and an EMP on any of
the three holds the whole lift still. **If either Condor is shot down** it
drops: onto ground a walker could stand on (sliding off a building to open
ground close by) it lands with 25% of its max HP in damage
(`lift.dropDamage`), credited to whoever downed the Condor; into water, sea
or lava, or onto rock, it is destroyed, like squads in a downed Condor.
There are no special island rules: set down on an Archipelago island, it
anchors and trains squads there like anywhere else.

The counter web (verified by the cost-equal duel matrix in
`tools/balance.ts duels`): **Stingers** beat Flak, Mortars and Lancers ·
**Lancers** burn through Mastodons · **Mastodons** crush Stingers, Flak and
Mortars · **Flak** beats all aircraft · **Wasps** beat tanks and artillery ·
**Raptors** beat aircraft · **Hornets** smash bases and armour but die to
Flak/Raptors/SAMs. Stinger › Lancer › Mastodon › Stinger is the ground
triangle; air vs anti-air sits across it.

Robot infantry adds a web on foot (duel margins from the *Infantry pass*):
**Rocket Squads** kill Mastodons (+0.69) and Hornets (+0.31) and beat Flak,
Lancers, Wasps and Raptors too, but lose to Stingers, Mortars, Troopers and
Snipers · **Troopers** beat Rocket Squads (+0.79) and Lancers (+0.43) ·
**Sniper Teams** delete Troopers (+0.37) and Rocket Squads (+0.87) and lose
by 0.75–0.94 to every vehicle or aircraft that can hit ground units ·
**Mortars**, **Hornets** and **Stingers** handle infantry (+0.55, +0.68
and +0.15 vs Troopers), and a Turret beats two Trooper Squads. **Mastodons**
are poor against infantry: cannon fire does ×0.4 to it, so a Mastodon army
only edges out Troopers (+0.13, against +0.61–0.88 over vehicle armies)
and loses hard to Rocket Squads.

The **Goliath** was tuned against four answers (`npm run balance goliath`:
one Goliath against 1,600 scrap of each unit, from both sides of the
field, + = the Goliath wins): it falls to **Wasps** (−0.84), **Lancers**
(−0.61), **Hornets** (−0.54) and **Rocket Squads** (−0.39), about trades
with Mastodons (−0.09), and beats Flak (+0.96), Sniper Teams (+0.89),
Raptors (+0.61; they can't hit it), Mortars (+0.50), Troopers (+0.41) and
Stingers (+0.22). Two Menders behind it (`--menders 2`, 1,900 scrap a
side) don't pay for themselves in a straight fight: Wasps (−0.78), Lancers
(−0.70), Rocket Squads (−0.61), Hornets (−0.49) and Mastodons (−0.32)
still win, and Troopers (−0.46) and Stingers (−0.24) now do too.

### Combat

- **Damage types × armor classes.** Every weapon has a damage type
  (kinetic, cannon, flak, missile, explosive, laser, precision) and every
  target an armor class (light, medium, heavy, structure, infantry);
  `DAMAGE_VS` in `balance.ts` is the multiplier table. Robot infantry
  added the `infantry` column and the Sniper's `precision` row; the
  Goliath (heavy armour) fires four of the types, one per weapon system:

  | Damage type (used by) | light | medium | heavy | structure | infantry |
  |---|---|---|---|---|---|
  | kinetic (Stinger, Trooper, Turret, HQ gun, Goliath machine guns) | 1.0 | 1.0 | 0.6 | 0.65 | 1.0 |
  | cannon (Mastodon, Rocket Squad, Goliath arm cannons) | 0.8 | 1.0 | 1.3 | 1.0 | 0.4 |
  | flak (Flak Crawler) | 1.25 | 1.0 | 1.15 | 0.5 | 1.25 |
  | missile (Wasp, Raptor, SAM) | 1.15 | 1.0 | 0.9 | 0.6 | 0.7 |
  | explosive (Mortar, Hornet, Goliath mortars) | 1.2 | 0.9 | 0.85 | 1.35 | 1.3 |
  | laser (Lancer, Goliath eye laser) | 1.0 | 1.0 | 1.55 | 0.8 | 0.7 |
  | precision (Sniper Team) | 0.6 | 0.4 | 0.25 | 0.15 | **3.0** |
- **Splash & projectiles.** Mortar shells (the Goliath's too) and Hornet
  bombs are simulated projectiles aimed at where the target *was* — fast
  units can dodge.
  Splash falls off from 100% to 50% at the edge.
- **Cover.** Ground units in woods take 30% less damage; robot infantry
  take half (`INFANTRY.woodsCover` 0.5).
- **Crushing.** A Mastodon that actually drove this tick deals 30 HP/s to
  every enemy squad whose centre is within its radius + 0.15 tiles,
  credited to the Mastodon (kills, XP, retaliation); a Mastodon standing still
  crushes nothing. Squads step aside for their own vehicles on the move
  (sideways off the vehicle's line when in front of it, else straight
  back); a squad and a parked vehicle share the push, as two vehicles do,
  so a squad walking up to a parked tank or harvester shoulders past it
  instead of being pinned there for good. Enemy vehicles drive straight
  through squads. Ground units keep 0.4 tiles inside the map's edge (their
  models stand around the centre), and a factory boxed in at the edge
  still rolls its units out onto the map.
- **Sniper concealment.** A Sniper Team standing in Woods is hidden from a
  side more than 2 s after its last shot, unless one of that side's units
  or buildings is within 3 tiles. It works apart from fog (a hidden Sniper
  stays hidden under Clear Skies) and everything uses the same check
  (`unitSeenBy`): auto-targeting skips it, attack orders on it drop, and the
  AI, the renderer, taps, the minimap, the advisor and the inbound warnings
  don't see it, and neither do a Mender's heal beam, a rank-up pulse or a
  promotion title. Splash still hurts it.
- **Veterancy.** Units earn XP from kills (in scrap value); three ranks,
  each +15% damage, rank 3 self-repairs (not a Goliath: only Menders
  repair it). Shown as gold chevrons. Ranked units become heroes (see
  *Veteran heroes* below).
- **Fights you can play.** Combat units carry 1.5× their original HP
  (Hornets 1.3×, so Flak still beats them; Harvesters, Scouts and
  buildings unchanged): half of an 8-v-8 Stinger brawl now dies in 7.5 s
  instead of 5, Wasps vs Flak 4.7 s instead of 2.4 — time to select, retreat
  or focus-fire on a phone. The duel matrix keeps the counter web below.
- **Retaliation.** Idle units hit by something out of reach go after the
  attacker, and nearby idle allies join in (not a Goliath dug in or on a
  lift: its guns answer from where it is).
- Auto-acquire targets in range; attack-move is the default command, with
  a "Move only" chip for retreats.
- **Menders are shot first.** Auto-targeting (units and turrets alike)
  reckons an enemy Mender 2.5 tiles nearer than it is, and a unit that can
  hit one drops whatever it was auto-targeting for a Mender that comes into
  weapon range (back to the next best once it's down). An explicit attack
  order is never overridden. Otherwise a Mender parked behind a push kept
  it alive while everything around it shot the tanks. Each of a Goliath's
  weapon systems does the same. Menders, for their part, favour a Goliath
  with a weapon down or about to come back (`repairUrgency` counts as up
  to 3 tiles nearer), and can't mend one under an EMP.

### Combat readability & feedback ("juice")

Fights must read at a glance on a phone (units die ~3.7 s after first
being hit), and kills, losses and income must each feel distinct. Rules in
`src/game/juice.ts` (engine-free, unit-tested), drawn by
`src/game/render/juice-view.ts`:

- **Hit flash:** a hit unit flashes a white silhouette (hull and turret)
  for 70 ms, at most once per 120 ms per unit; buildings get a warm
  additive glow (100 ms, once per 280 ms) so a siege flickers rather than
  strobes. Wall-clock timed, so pausing never freezes a unit white.
- **Health bars:** recently lost HP stays as a pale chunk for 300 ms, then
  drains at 1.5× max HP/s (a new burst only re-arms the hold once the trail
  has caught up). Enemy bars brighten as HP falls and blink at 2 Hz below
  25%. Bars snap to device pixels, keep a 22 CSS px minimum width, and stay
  4 CSS px tall at every zoom. A Goliath's is 60–120 px wide and 5 tall,
  notched at 75 / 50 / 25%, where its weapons go offline.
- **Team ground rings:** any unit that fired or was hit in the last 3 s
  sits on a thin blue/red ellipse (fading over its last second), so mixed
  clumps read even at the default zoom. Aircraft rings sit under the craft.
- **Deaths:** small hulls get a smaller fireball and glow (Mastodons and
  Hornets keep their big one); impacts are trimmed so explosions stop
  hiding the clump. An expanding ring in the victim's colour says whose
  unit just died. A robot squad has no fireball: its robots topple one at a
  time as it takes damage, each in a spray of sparks with a clank, and the
  last ones fall the same way. A Goliath has no hull fireball either: its
  reactor blows and it topples (see *3D view*), seen through any fog.
  Camera shake only for deaths the player can
  see inside the camera view, scaled by what died (stinger ≈ 1 px, HQ biggest).
- **Sound:** a bright two-note *kill* "ting" on enemy deaths you can see; a
  low *lost* power-down for your own units (quieter and throttled when off
  screen). Both may use two voices reserved above the 14-voice battle cap.
  Losing a building buzzes the phone (`navigator.vibrate(20)`, Android).
- **Economy:** each delivery pops a gold "+100" over the drop-off with a
  coin blip; deliveries within 2.5 s of each other climb a pentatonic
  scale (retuned into each biome's music key, `coinKey` in score.ts), and
  arrivals at one drop-off within 400 ms merge into one label.
  The scrap pill bumps on income and flashes red when you spend.
- Spectators get the visuals for both sides but no kill/loss/coin cues.

### Music & ambience (adaptive score)

The battle used to be silent half the time. A procedural score
(`src/game/music.ts`, rules in the engine-free, tested `src/game/score.ts`)
now follows it, scheduled 200 ms ahead on the AudioContext clock at 96 BPM
(menu 80), in 16th-note steps with one chord per two bars:

- **Layers**, each opened only on a bar line: a voice-led **pad** (always;
  four gliding voices, no muddy seconds or sevenths in the bass), a calm
  **melody** that plays call-and-answer phrases while you build, a **bass**
  groove once your units are in contact, **drums** (with a crash on entry
  and fills every fourth bar) when a fight is on screen, and a 16th-note
  **arp** when it gets big. While your base is under sustained attack
  (3+ building hits in 4 s; a hit on an anchored Goliath, or on any Goliath
  once the HQ has fallen, counts as one) the arp swaps in a tritone and the
  filters open — for at most 15 s per attack, so it stays a warning.
- **Biomes:** temperate D dorian (Dm7–Fmaj7–Cmaj7–G7, kalimba pluck),
  desert E phrygian dominant (E–F–Am–Dm, oud pluck, tresillo bass, tabla),
  arctic F lydian (Fmaj7–G7–Dm7–Am7, FM glass bells, half-time drums),
  volcanic C aeolian (Cm–Ab–Eb–Bb, marimba, driven chugging bass, toms),
  tropical G mixolydian (G–C–F–C island vamp, a reedy square/triangle pad,
  a steel-pan bell blooming down into pitch, calypso bass).
- **Intensity** (`BattleMood`, from the sim's fx stream):
  `I = audibleShots4s/32 + 0.5·(base under attack) + 0.25·min(1, losses10s/3) + strike`,
  floored at 0.3 while your units fought anywhere in the last 8 s; attack
  0.5 s, release 6 s. Calldowns are the loudest moments: `strike` is the
  biggest one still ringing — an impact adds Barrage 0.45 / EMP 0.3 / Drop
  Pod 0.3 / Sky Hammer 0.85 × its earshot, fading out over 6 s (public, so
  no fog check; three shells are one Barrage, they don't stack). A Sky
  Hammer counts at least half wherever it lands (its boom carries) and in
  full on or near your things; an enemy reticle over your things holds 0.35
  until it lands. In Last Stand a 0.35 floor holds from a wave's warning
  until a few seconds after it arrives. Shots count by the same earshot rule as the SFX and
  only if you can see them. Bass enters around I 0.15–0.35, drums 0.42–0.6,
  arp 0.72–0.9. Spectators hear on-screen combat from both sides (1.5× the
  shots for full) with no alarm. Measured over six AI-vs-AI matches with a
  follow-cam: calm 24% / bass 15% / drums 33% / arp 28% of match time
  (HQ-parked camera 24/42/23/11); first drums at 36–138 s.
- **Stingers** on the next beat: a I–IV–V–I fanfare (victory, which then
  holds the tonic major for a quiet coda), a descending minor lament
  (defeat), a sweet sting for a Robot Love draw (bells rising over a soft
  held sixth chord, no drums, then the same major coda; with music off its
  heart-burst chime stands in), and for `announce()` lines a rising call
  (`epic`: an enemy Goliath or HQ destroyed), two low stabs
  a semitone apart (`bad`, which also lifts the tension for 8 s), a light
  lift (`good`, priority ≤ 1) or a tom hit (keys matching `first-blood`).
  At most one per 3.5 s. When music is off, the old SFX jingles play instead.
- **Mix:** the score ducks 6 dB under big explosions and alarms (`sfx.duck`,
  also for announcer lines), is muffled to a 420 Hz lowpass while paused,
  and stops with the tab hidden (the AudioContext is suspended). Budget:
  8 persistent pad oscillators plus ≤ 10 transient voices (14 during a
  stinger), shared noise buffers; the scheduler costs ~0.07 ms per 25 ms
  tick. Offline renders: calm ≈ −34 dBFS RMS, intense ≈ −26, peaks ≤ 0.6.
- **Ambience** (`src/game/ambience.ts`): a quiet looped bed per biome —
  wind and birdsong, desert roar and sand hiss, a sliding arctic whistle, a
  volcanic rumble with crackles, surf rolling in every ten seconds under a
  trade wind with gull cries and nearer breaking waves — at about −44 dBFS,
  ducked by `1 − 0.7·I`. It plays under the Music switch.
- **Menu:** a gentle pad/melody/arp take on the selected map's biome,
  starting on the first touch (browsers block audio until a gesture).

### Voices & announcer

Every player action gets a voiced answer, and the big moments are called
out without eating screen space (C&C's EVA, arena-shooter streaks).

- **Unit chirp-voices** (`src/game/voices.ts`): each unit class has a
  synthesized robot voice: a carrier glides through two formant
  band-passes, plus a dry share so thin voices carry on phone speakers.
  Mastodons growl at 80 Hz, Hornets drone with FM buzz, Wasps buzz at 60 Hz,
  Lancers shimmer, Menders ring like bells and Harvesters go "boop-boop";
  Trooper Squads chirp high in a chorus, Rocket Squads bark gruff and
  buzzy, Sniper Teams murmur low and calm, the Condor drones like an
  engine under rotors, and the Goliath rumbles lowest and slowest of all,
  at 58 Hz with a slow mechanical shudder (it reports in with *ready* when
  it walks off the Gantry, and again when it has dug in where you can see
  it).
  Lines: *select* (two rising syllables), *move* (two short, then a fall),
  *attack* (a noise bark and three fast syllables), *ready* (three rising,
  replacing the generic chime), *rank* (four ascending with a sparkle,
  replacing the rank chime) and *death* (a falling wail with crackle, own
  units in view only). Pitch is jittered ±6% by unit id, so a group sounds
  like a chorus. A group answers in its majority kind's voice, with one
  echo voice 6 dB down. Every line is under 400 ms. Lines start at least
  250 ms apart; unprompted ones keep their own spacing (ready 2 s, rank
  1.5 s, death 2.5 s) and stay 600 ms clear of the player's chirps. Lines
  are balanced to about −30 dBFS RMS.
- **Radio announcer** (`announcer.ts`, rules in the engine-free, tested
  `callouts.ts`): a squelch and key-up beep on the voice bus, then
  `speechSynthesis` (pitch 0.6, rate 1.08, an English, preferably male,
  on-device voice), then an "over" click. The music ducks 5 dB under it.
  It reads every `announce()` banner (`Announcement.say` overrides the
  spoken text) plus its own lines from the fx stream:

  | Line | Priority | When / cooldown |
  |---|---|---|
  | Warning: our HQ is under attack | 0 | HQ hit; 30 s (60 s if it's on screen) |
  | Our base is under attack | 1 | other building hit off screen; 30 s |
  | Squad lost | 1 | 3 own deaths within 3 s; 20 s |
  | Enemy aircraft detected | 1 | first visible enemy combat aircraft; re-armed after 2 min unseen |
  | Structure lost: X | 1 | own building destroyed; 15 s |
  | Incoming artillery! / EMP inbound! / Enemy drop pod! | 1 | an enemy Barrage / EMP / Drop Pod aimed at our units or buildings (the siren's "threatened" rule); 20 s each; dropped if it can't start within 1.5 / 1 / 2.5 s (the Sky Hammer has its own spoken banner) |
  | Our units are under fire | 2 | own unit hit off screen; 60 s (not for the hits of an enemy strike just warned about) |
  | Harvester lost / Mastodon lost | 2 | off screen; expensive (≥ 350) or veteran units |
  | Condor down with N squads aboard / Condor down! Troops bailing out | 1 | own loaded Condor shot down, over water or rock / over land; 10 s |
  | Enemy troops landing! | 1 | an enemy Condor drop we can see; 20 s |
  | Troops deployed | 3 | our Condor drop lands; 20 s |
  | Enemy X destroyed | 2 | enemy building; 15 s |
  | Construction complete / X promoted (rank ≥ 2) / Insufficient scrap | 3 | |
  | Enemy Goliath nearly complete | 1 | an enemy Gantry's build passes 85% (`GOLIATH.nearlyDone`); 20 s |
  | Goliath ready | 1 | ours walks off the Gantry; 10 s |
  | Our Goliath is under attack | 1 (0 when it is the last life: no HQ, no other Goliath) | hit off screen, or on screen while it is part of the base (anchored, or the HQ gone); 30 s (60 s on screen) |
  | Enemy Goliath digging in / Enemy Goliath packing up | 2 / 3 | an enemy Goliath starts to anchor / to pack up; 20 / 30 s |
  | Goliath anchored | 3 | ours has dug in (captioned only off screen); 15 s |
  | Enemy Goliath: mortars down! / Enemy Goliath laser back online | 2 | its weapon systems going offline, or rebooted back ("mortars and laser down!" when they go together); 20 s per system |
  | Goliath mortars offline / Goliath cannons back online | 1 / 3 | ours, the same way; 20 s per system |
  | Goliath airborne / Enemy Goliath airborne | 3 / 2 | two Condors lift one; 20 s |
  | Goliath dropped! / Enemy Goliath dropped! | 1 / 2 | a lift's Condor shot down, and the Goliath survived the fall; 10 s |
  | Enemy HQ destroyed. Victory! / Our HQ has fallen. Mission failed. | 0 | last word; nothing after it ("Last enemy Goliath destroyed. Victory!" / "Our last Goliath has fallen. Mission failed." when a Goliath decided it; "They fell in love. The battle is a draw." for Robot Love) |

  Delivery goes through `RadioQueue`: most important first, ≥ 2.5 s between
  lines, at most two waiting, and lines dropped after waiting 3 s (6 s for
  P0). A chatter budget allows at most 3 routine (P2–P3) lines per 30 s;
  warnings always get through. Lines wait, without ageing, while the game
  is paused. Radio-only news also gets a small coloured **radio caption**
  (a slim toast; tap to jump there). Lines that already have a toast or
  banner get no caption. Speech
  must be unlocked inside a gesture on iOS (primed on the first tap). Where
  speech is missing, failing, or set to **Chirps**, a two-tone radio code
  stands in: falling for warnings, rising for good news.
- **Kill-streak banners** (through `announce()`, so they also get music
  stingers and are read out): *First blood* (the player's first kill),
  *Double kill* / *Triple kill* / *Rampage* for 2 / 3 / 5 kills within a
  4 s sliding window. The tier is called after a 0.6 s hold, so a fast
  third kill upgrades the line. Tier cooldowns are 30 / 30 / 45 s.
  Expensive kills get their own banner ("MASTODON DOWN", spoken "Enemy Mastodon
  destroyed"), or ride along under a streak. Kill banners are at least 6 s
  apart; a streak climbing a tier needs only 2 s.
- **Goliath banners.** A Gantry and its Goliath are always seen, so their
  news needs no fog check. An enemy Gantry starting one is a banner, "Enemy
  Goliath in production" (sub-line "Their Gantry has started one"), and so
  is its rollout, "Enemy Goliath on the field" with its counters ("Counter:
  Rocket Squads, Wasps, Lancers, Hornets"). A Goliath kill is always its
  own epic banner, "GOLIATH DOWN" (spoken "Enemy Goliath destroyed"; an
  elite's "ELITE GOLIATH DOWN"), never held back by the big-kill cooldowns
  or folded under a streak; its sub-line names a calldown, "Dropped from
  its lift", or, with that side's HQ gone, what is left ("One Goliath
  left"). Ours lost is "Goliath lost" (P0 once the HQ is gone: "Our last
  Goliath fights on", "Lost in the drop"). An HQ that falls while a
  Goliath stands doesn't end the match, so it gets a banner instead of the
  last word: "Our HQ has fallen / The Goliath fights on" (P0), or "Enemy HQ
  destroyed / Destroy their Goliath to win". The blow that decides the
  match is left to the last word and the finale.
- **Calldown kills count, and say so.** A calldown's kills are credited to
  its side's HQ in the sim; `calldown-credit.ts` (engine-free, tested) spots
  them — killed by the enemy HQ, next to one of that side's impacts in the
  same tick — so every presentation layer can name the strike. They count
  for first blood ("Enemy Stinger destroyed by a Barrage") and streaks; a
  streak mostly made by one calldown (≥ 2 kills and half of them) puts it on
  the sub-line ("TRIPLE KILL / Sky Hammer", spoken "Sky Hammer: triple
  kill") on its own 10 s cooldown, since strikes are rare. A building one of
  ours flattens gets "Direct hit!" ("Sky Hammer: enemy Turret destroyed"),
  or rides under that strike's streak banner. Our Drop Pod's crew reports
  in with the *ready* chirp as it steps out, and so do squads jumping out
  of our Condor.
- **Spectators** hear a neutral caster ("Red HQ under attack", "Double
  kill for Red", "Blue Fab Plant destroyed", "Blue troops landing", "Blue
  wins the battle"; for Goliaths "Red Goliath in production", "Blue
  Goliath on the field", "Red Goliath: mortars down", "Blue HQ destroyed /
  Blue's Goliath fights on", "Red's last Goliath destroyed. Blue wins the
  battle"), with full information.
- **Measured** over six AI-vs-AI matches (32 min,
  `callout-rates.ts`): 4.5 delivered lines/min (at most 9 in any 60 s, in
  end-game sieges), 1.2 banners/min (at most 5 in 60 s), and 9–13
  unprompted chirps/min with a follow-cam. Spectators: 3.1 lines/min and
  1.7 banners/min. The test suite replays a match and fails if this drifts.

### Battle awareness & tempo

On a 6" screen you can't see the fight you should react to, warnings used
to come after the damage, toasts covered the battlefield, and the build-up
dragged. Rules in `src/game/awareness.ts` (engine-free, tested), wired up
in `awareness-view.ts`, widgets in `src/ui/awareness.ts`. Everything is
fog-respecting: hits on your own things, shots your units fire, and only
enemies you can currently see.

- **Game speed:** a chip beside the clock cycles 1× → 1.5× → 2× (spectators
  also 4×), remembered per mode in `localStorage` (`battledrones.speed`);
  **press and hold the clock** for 3× while held; `.` cycles. At most 8 sim
  ticks run per frame and a backlog beyond that is dropped, so a slow phone
  slows down instead of spiralling. Weapon and impact sounds space out by
  the speed factor (`sfx.setTempo`) and get 11 voices instead of 14 above
  1×. Detection windows everywhere are sim seconds, so nothing else changes.
- **Tempo safety:** telegraphs are sim seconds too, so at 2× a Barrage's
  2.5 s warning is gone in 1.25 s. Above 1×, the game drops back to 1× by
  itself (`TempoGuard`) when something needs your hands: an enemy calldown
  aimed at your units or buildings (the same "threatened" rule as its
  siren), a spoken inbound warning, or the HQ coming under a new attack
  (first hit after 20 s without one, tracked at any speed, so speeding up
  mid-siege doesn't snap back) — and once the HQ has fallen, a Goliath
  coming under a new attack the same way, since losing the last one loses
  the match. A held fast-forward lets go too; the chip pulses red and one
  ticker note says why ("Speed 1× — enemy Barrage inbound", tap to look) —
  folded into the raid's own warning line, and replacing the off-screen
  "Enemy Barrage inbound!" / "HQ under attack!" / "Goliath under attack!"
  alerts, so it's still one line per event. The chosen speed stays stored
  for the next match. Spectators never slow down.
- **Inbound warning:** when visible armed enemies (anything that can hit a
  ground target, and Condors, loaded or not: the warning doesn't give away
  their cargo) come within 12 tiles of a building or harvester (or a
  Goliath that is part of the base: anchored, or any once the HQ has
  fallen), the group (single-link, 5 tiles) is warned once, with counter
  advice by domain and lead kind: "Enemy drones inbound — Flak, Raptors or
  a Turret", "Enemy Mastodons inbound — Rocket Squads, Lancers or Wasps",
  "Enemy Goliath inbound — Rocket Squads, Wasps, Lancers or Hornets",
  "Enemy troops inbound — Mortars, Turrets or Snipers", "Enemy dropships
  inbound — Flak, Raptors or a SAM"… (an enemy Goliath counts even in the
  fog: it can't hide). A group seen in the zone within 20 s isn't new; one that has been shooting your things for 1.5 s is
  a fight, not a raid; loud warnings are at least 12 s apart (quieter ones
  still get an arrow). The first raid of each kind per match is a banner
  ("DRONES INBOUND", sub-line with the counters, read out by the
  announcer); later ones are a ticker line plus the radio — unless an
  inbound banner is still up or waiting, which already says it. Each sounds a
  two-whoop siren and pulses the minimap with amber rings. An air raid
  stands in for "Enemy aircraft detected". An enemy Drop Pod's crew isn't
  a new raid: its reticle, siren and radio line already announced it. Measured over 8 AI-vs-AI matches
  (67 min, blue's view): 1.2 loud warnings/min; warning → that group's first
  hit median 3.8 s (p10 0.9, p90 8.0). Lead time is bounded by vision: a
  harvester sees 4 tiles and a Wasp shoots from 3, so the first raid on a
  mining line gets well under a second, while Radar, the HQ's 8.5-tile
  sight or units on watch buy several seconds.
- **Hotspots and edge arrows:** hits on your things (HQ 0.6, other
  buildings, anchored Goliaths and harvesters 0.45, units 0.35 heat), your
  losses (0.6), and shots/kills by your units (0.2/0.4, at the shooter; not your calldowns'
  kills, which the sim credits to your HQ — that was an "Attack" arrow
  pointing home) heat 6×6-tile cells
  that cool 15% per second; warm cells within 8 tiles cluster and a cluster
  over 1 heat is a hotspot, named by the most important thing hit (HQ! >
  Base > Harvesters > Units; only your own shots: Attack). Off-screen
  hotspots (by priority, then heat; at most 3, one per direction) become
  pulsing, tappable 46 px arrows at the edge of the visible battlefield,
  red when you're being hit (dashed for an inbound raid), amber when you're
  attacking. Each slides along the edge past HUD widgets (minimap, zoom
  stack, ticker, chips, banner, anything marked `data-edge-avoid`). Tapping
  one glides the camera there in 350 ms (ease-out) and flashes a ring. The
  **⚡ button** under the zoom buttons cycles through all hotspots, most
  urgent first (a red dot when something of yours is under threat).
  Spectators get amber "Fight" / "Red HQ" arrows for both sides. Measured:
  a camera parked on the HQ has at least one hotspot elsewhere 51% of the
  match.
- **Cinematic camera (AI vs AI):** on by default, toggled by the 🎥 button
  in the zoom stack (above ⚡) or C, remembered in `localStorage`
  (`battledrones.cinecam`). A director (`src/game/director.ts`, tested)
  heats 6-tile cells from both sides' shots (0.04), hits (0.12; buildings
  0.2, an HQ 0.45) and deaths (0.35 + 0.1 per 100 scrap), cooling 20% per
  sim second, and every 0.5 s picks the hottest 3×3-cell area, following
  it as the fight moves. It holds a subject at least 5 s and only switches
  to one 1.7× hotter; when nothing is hot it tours the armies, one side's
  densest knot then the other's every 9 s. Zoom follows how spread out the
  action is (58 tight, 30 sprawling), breathes ±7% over 23 s, and the look
  point drifts ~1.4 tiles so the camera never sits still; both ease on
  critically damped springs. Surprises take the camera at once: a calldown,
  a Goliath rolling out or falling, the first shot on an HQ after 30 s, a
  Goliath weapon knocked out, an Uplink changing hands, a veteran or a
  350+ scrap unit dying. Farther than 24 tiles away that's a hard cut (at
  most one per 12 s), nearer a glide, with a 1.25× push-in easing out over
  4 s. Panning, zooming, the minimap, a toast, an edge arrow or ⚡ hand the
  camera to the player; the director takes it back 8 s after the last
  touch (the 🎥 button goes dashed meanwhile), easing from wherever it was
  left. The HQ-kill finale still owns the camera at the end.
- **Battle meter:** while at least 2 of your armed units and 2 visible
  enemy ones are in view and shots were fired there in the last 3 s, a slim
  tug-of-war bar under the clock compares Σ cost × HP fraction (turrets and
  SAMs count, harvesters don't; an enemy Goliath in view counts, fog or
  not), easing over 300 ms and lingering 1.5 s. A
  swing of more than 20 points within 4 s flashes **Turning point!** (green
  toward you, red away; at most every 8 s; ignored when the camera jumps).
- **Ticker:** toasts left the battlefield's centre for a compact,
  left-aligned stack under the top band: 13 px, at most two lines each, at
  most two at once (the newest pushes the oldest out, but a 💡 hint
  outlives a burst of alerts), 2.2 s by default, still tappable. Big
  moments remain `announce()` banners. While a banner shows only the newest
  ticker line stays (see *HUD layout* for where each goes).

### Command UX: squads, build advisor, placement

Commanding on a phone shouldn't be a chore. Rules in engine-free, tested
modules (`src/game/squads.ts`, `src/game/advisor.ts`, `src/sim/placement.ts`);
widgets in `src/ui/command.ts` and `src/game/placement-view.ts`.

- **Squads** (control groups for thumbs): three 42 px chips at the head of
  the chip row. Hold one (400 ms, with a fill, a buzz and a chirp) to save
  the selection; tap to select it; tap twice within 400 ms to glide the
  camera to the member nearest the squad's middle. Each chip shows the most
  common unit's icon (ties: the pricier kind), a count and a health bar
  (Σ HP / Σ max), and glows red for 1 s whenever a member is hit. A unit is
  in at most one squad; holding a chip with nothing selected clears it. A
  one-time hint teaches the gesture the first time two or more combat
  units are selected. A member riding in a Condor stays in the chip and in
  its count; selecting the chip selects the Condor carrying it.
- **Counter advisor:** remembers the enemy units you have actually seen
  (standing on tiles you see right now, never a Sniper Team hidden in the
  woods; scouts and harvesters ignored),
  each for 60 s after its last sighting, plus enemy Turrets and SAM Sites
  from the fog memory. A build button whose counters (from the duel matrix:
  Flak → Wasps, Raptors, Hornets, Menders, Condors; Stingers → Flak,
  Mortars, Lancers, Troopers, Snipers; Mastodons → Stingers, Flak, Mortars;
  Lancers → Mastodons, Goliaths; Wasps → Stingers, Mortars, Mastodons,
  Lancers, Goliaths; Raptors → Wasps, Hornets, Menders, Condors; Hornets →
  Mastodons, Mortars, Goliaths and all three infantry squads; Mortars →
  Turrets, SAMs and all three squads; Troopers → Rocket Squads; Rocket
  Squads → Mastodons, Hornets, Goliaths; Sniper Teams and Turrets → all
  three squads; SAM Site → Hornets, Wasps, Condors) have been seen at
  least twice (one sighting of anything costing 800 or more counts once
  more per 800, `ADVISOR.heavyValue`, so a lone Goliath lights its
  counters by itself) gets an amber ⚔ corner (pulsing for
  its first 6 s), and its tab a ⚔ dot, until your own force of that kind
  (built + queued, squads riding in Condors included) is worth 75% of what
  it counters. The long-press card
  says "Counters Wasps (seen ×4)". It is advisory: the same fog-limited
  knowledge the AI adapts its production to.
- **Idle factories:** a Fab Plant, Assembly Bay or Airpad with an empty
  queue for 6 s while you can afford its cheapest combat unit puts a
  pulsing amber **IDLE** tag on the Vehicles, Infantry or Aircraft tab.
  The Gantry never does: it builds one Goliath at a time and sits idle
  between them by design (and the report's idle-factory tip leaves it out
  too).
- **Loading and dropping** (`src/game/controller.ts`): with infantry squads
  selected, tapping (or right-clicking) your own Condor sends them aboard,
  as many as it has seats not already promised, nearest first ("Room for 1
  squad only", "Condor full: unload it first"); with Condors selected,
  tapping one of your squads sends it to the nearest selected Condor with a
  seat. A Condor on its way somewhere stops to meet them. Each squad that
  climbs in hands its place in the selection to its Condor, so the
  selection that loaded it can fly it next. With loaded Condors selected, a
  **long-press released without dragging** on the map flies them there to
  drop (the rest of the selection attack-moves along, or moves under *Move
  only*) — unless a calldown is armed: the hold fires it there first, as a
  tap would; a hold cut short by a second finger (a pinch) or a cancelled
  touch orders nothing — and the **⇣ Unload N** chip (key U) drops the
  squads where the Condor is. A boarding squad draws a blue line to its
  craft, a drop a gold waypoint where the squads will land. One-time hints
  teach infantry and the Condor the first time you select them.
- **Goliaths** (`src/game/controller.ts`): the **⚓ Anchor** chip (key G)
  digs the selected walking Goliaths in where they stand (those the ground
  takes; where none can, the chip reads "⚠ Needs open ground" or the like,
  shakes with a buzz, and the ticker says "Can't anchor here: …"); with
  none walking, **⇡ Pack up** (G again) packs up the anchored ones, and
  while they dig in or pack up the chip shows the progress ("⚓ Anchoring
  40%"). An anchored Goliath stays put: a tap on the ground with it alone
  selected sets the rally point for the squads it trains ("Rally point
  set: pack up first (G) to move the Goliath"), and in a group the rest go
  without it ("The anchored Goliath stays put: pack up first (G)"); a tap
  on an enemy its guns reach from where it stands gives it an attack order
  without packing it up (one out of reach: it stays dug in, "Out of reach:
  pack up first (G) to go after it", and the rest go). ⚔ Select
  army and 💤 Idle leave anchored Goliaths out (they are neither the army
  nor idle). The **lift**: with Condors selected, a tap
  (or right-click) on your own walking Goliath has the two nearest empty
  ones hook on, and the selection becomes the lift (see *The two-Condor
  lift*); a tap flies it and hovers, a long-press sets it down there,
  **⇣ Set down** (U) where it is. One-time hints teach anchoring the first
  time you select a Goliath, and the lift the first time you select two
  empty Condors with a walking Goliath on the field.
- **Placement on touch:** tapping a ready structure drops the ghost on the
  best valid spot near the middle of the view (closest to it, avoiding
  spots that would wall a lane shut), gliding there if it's off screen; the
  build-range zone is tinted and outlined, and takes in the build ring of
  every anchored Goliath for anything but an HQ (ring-only ground tinted
  team blue: what goes up there is an outpost). A tap on the map moves the ghost
  (snapping one tile onto a valid spot when that's all it takes), dragging
  the ghost slides it, and tapping the ghost or **✓ Place X** builds. A bad
  spot says why above the ghost and on the chip — *Too far from base*,
  *Blocked*, *Unit in the way*, *Not on water / rock / mud / lava…* — and
  trying to build there shakes the ghost with a low buzz and the radio's
  "Cannot build there". The ghost draws above the fog. A mouse keeps
  one-click placement.

### Commander calldowns

Once an army is sent, the commander still has moves: a **Command meter**
(⚡, 0–100) fills slowly on its own and mostly from *losses* (0.035/s;
0.008 per scrap of your own units and buildings destroyed, 0.002 per scrap
you destroy; +0.06/s per Uplink held), and pays for three map-targeted
calldowns, each on its own cooldown — about one meter power every two
minutes in a typical match. Numbers live in `POWERS` in `balance.ts`.

| Power | Charge / cooldown | Warning | Effect |
|---|---|---|---|
| **Barrage** | 60 / 45 s | 2.5 s | 3 shells over 0.6 s, seeded scatter ±0.9 tiles, 170 explosive splash r 2 each (ground units and buildings) |
| **EMP** | 40 / 40 s | 0.8 s | Enemy units and buildings within 3 tiles freeze for 4 s: no moving, firing, healing or production |
| **Drop Pod** | 70 / 60 s | 2 s | 2 Stingers + a Flak Crawler (2 Lancers + Flak with a Tech Lab) land on open ground you can *see*; a light 60-damage thump under the pod |
| **Sky Hammer** | — / 150 s | 3 s | Online for both sides at 6:00. Units within 2.5 tiles take 260 × (1 − 0.5·d/r), air included; buildings a flat 700 (an HQ loses 22%) |

- **Same rules for both sides.** One `calldown` command, validated by
  `calldownBlocker` (charge, cooldown, the HQ alive — or, with no HQ, a
  Goliath: "Calldowns need an HQ or a Goliath" — an *explored* target —
  a *visible*, ground-passable one for the pod) for the player and the AI
  alike. Calldowns only hurt the enemy; kills are credited to the firing
  side (its HQ is the killer, so faction stats count them; no unit XP;
  with no HQ standing, nobody is, and the faction stats still count them).
  The
  presentation layers name the strike instead of "defences" or the HQ (see
  *Calldown kills count* under Voices & announcer): first blood, streaks,
  hero toasts ("✝ Viper (Lancer, 9 kills) destroyed by an enemy Barrage"),
  the report's story, medals and tips; they never heat an "Attack" hotspot
  at your own HQ and never make the HQ an MVP.
- **Every calldown is telegraphed, publicly.** `World.powers.active` and the
  `calldown` FxEvent are visible to both sides through the fog: a reticle
  shrinks to the moment of impact, so landing one and dodging one are both
  skill moments. EMP + Barrage is a real combo (frozen units can't dodge).
- **Looks and sounds:** red reticles and an air-raid siren for the enemy's
  (loud when it threatens your stuff, with a tap-to-jump toast and a
  minimap ping if it's off-screen); gold / cyan / blue for yours, with a
  radio chirp. Shells streak in, the EMP throws a blue-white shockwave and
  leaves frozen things crackling, pods fall in a flame trail and burst open
  in a ring of dust, and the Sky Hammer charges a lance from orbit (rising
  hum) before a beam, a white-out flash and a rolling boom. The camera
  shakes when it lands on screen. Banners: "Sky Hammer online" at 6:00,
  "Enemy Sky Hammer inbound!" (tap to jump); what yours destroy is a kill
  streak named for the strike ("TRIPLE KILL / Sky Hammer"), or "Direct hit!"
  for a building. The radio warns of an enemy Barrage, EMP or Drop Pod aimed
  at your things ("Incoming artillery!"), the music swells with every
  impact, and the hits a warned strike lands don't also raise "Units under
  attack!" (one channel per event).
- **HUD:** four round 52 px buttons on the right edge (48 px on shorter
  phones; a 2×2 block of 44–46 px beside the sidebar on landscape phones,
  see *HUD layout*) with the ⚡ meter, each with a conic
  ring — charge in the power's colour, cooldown in white — and its cost,
  cooldown seconds or the Sky Hammer's unlock countdown. Tap a ready one to
  arm it ("Tap map: Barrage ✕" chip, radius preview under the pointer /
  finger, grey with ✕ where it can't go), tap the map to fire; an illegal
  tap explains why. Long-press for details (in the ticker's roomier tip
  line; the Drop Pod names the crew the match's rules really give, e.g.
  "2 Wasps + a Raptor" under Air War, "2 Trooper Squads + a Rocket Squad"
  under Infantry War). Reticles show on the minimap; the end
  screen counts calldowns per side.
- **Which modes have them:** skirmish, the Daily Op and Last Stand (the
  player's alone: the waves have no HQ, and the director copes — strikes kill
  wave units like any other, pod crews are just more defenders). Ops keep
  them except where the op's puzzle is a fixed force: Decapitation's strike
  group and Frozen Assets' 3,000-scrap budget (a free Drop Pod would break
  either) set `OpRules.calldowns: false` → `Rules.noCalldowns`, which blocks
  them for both sides (no buttons, no Sky Hammer at 6:00; the briefing says
  "⚡ No calldowns"). Sky Pirates bans ground units for the player too, so
  its Drop Pod lands 2 Wasps + a Raptor and the op stays an air raid.
- **AI:** a per-tick dodge reflex (before the decision gate) moves every
  unit inside an enemy reticle ~4 tiles out after 1.1 / 0.6 / 0.4 s
  (Easy / Normal / Hard) — if there's still time. It Barrages the best
  visible ground clump worth ≥ 800 (Easy never), answers a superior force
  at its base or mining line with a Drop Pod (else an EMP), EMPs turrets in
  front of an assault from surplus charge, pods in reinforcements only when
  a fight away from home hangs in the balance, and aims the Sky Hammer at a
  clump worth ≥ 700, else the best production-building hit, else the HQ.
- **Measured when it shipped** (before the balance pass cut the meter's
  income to about a third; AI-vs-AI round robin with openers, 5 maps × 30 pairings ×
  2 seeds, 300 games, before → after): 25-minute draws 17 → 1; median
  length 5.7 → 6.0 min, mean 7.8 → 7.3, p90 15.9 → 12.1; the side ahead by
  200+ value at 2:00 / 3:00 / 4:00 went on to win 84 / 88 / 90% → 80 / 84 /
  86%; games where a clear leader lost the lead 11 → 15. About 8.7
  calldowns per AI per match (median 7: Barrage 4.1, EMP 2.7, Sky Hammer
  1.3, Drop Pod 0.7), 56% fired by the side that was behind. The design
  panel's prototypes had burst powers *feeding* the snowball; here the
  meter is loss-weighted and damage telegraphed, and one rule mattered:
  free Drop Pod units for a wave that is already winning pushed the
  2:00–4:00 leader's win rate *up* 2–3 points, so the AI only reinforces a
  contested fight.

### Map objectives: Uplinks and supply drops

Without a reason to be there, 85% of the fighting happened at a base and
only 13% of unit deaths in the middle 40% of the HQ-to-HQ line. Two things
now pull armies into the middle (numbers in `OBJECTIVES` in `balance.ts`,
rules in `src/sim/objectives.ts`):

- **📡 Uplink relays**, 2–3 per map at contested, mirrored spots:
  Riverlands' centre bridge and both fords; the open flanks of Dune Sea
  and Proving Grounds; the two lanes round Frostbite's frozen sea; the outer
  plateaus of Ashlands. Units inside the 2.5-tile ring push its capture bar
  (−100…100) toward their side: 3.5 points/s per unit, aircraft half,
  robot infantry squads double (`INFANTRY.captureWeight`), harvesters not
  at all, capped at 4 units' worth (two squads reach it; neutral → held in
  ~7 s, a full flip ~14 s). With both sides inside the bar freezes;
  abandoned, it drifts back to its holder (or to neutral). The holder loses it the moment the
  bar is pushed back to neutral. Holding one pays **1.5 scrap/s** (× income
  multiplier), sees 7 tiles round it through the fog and adds **0.06/s** to
  the ⚡ meter. Uplinks are not buildings: nothing occupies their tiles or
  can shoot them (no building may be placed on the platform), so combat
  never sees them.
- **📦 Supply drops**: the first lands at 1:30, then one every 75 s, each a
  **mirrored pair** of crates (one per side of the map, same reward: fair)
  at one of three drop sites per map, chosen by the seeded RNG (never the
  same site twice running) and **announced to both sides 10 s ahead**. The
  first non-harvester unit within 0.8 tiles of a landed crate claims it
  (nearest wins); a crate nobody claims burns out after 45 s. Rewards,
  weighted: **+200 scrap** (38%), **Veterans** (+1 rank to the claimer and
  allies within 3, 20%), **Field Repair** (own units within 4 heal half
  their HP, a Goliath excepted, 15%), **+40 ⚡ charge** (17%) and the
  rare **free veteran Lancer** (10%). A kit that would do nothing (no one
  hurt, the meter full) is stripped for up to 150 scrap instead.
- **Looks:** a neutral relay platform (generated art) whose dish idles on a
  slow scan, turns for its holder and spins up while being taken; a dashed
  capture ring and a bar round the platform in team colours, shown through
  the fog (holders are public). A crate shows a gold landing marker and a
  light pillar the moment it's announced (through the fog), drops the last
  2.5 s under a striped parachute that sags away as it lands, then glints
  with a burn-out ring; claiming it pops the reward in gold ("VETERANS ×3",
  "+300", "FREE LANCER!"). Banners: "Supply drop inbound" / "Rare supply
  drop!" (tap to jump to your side's crate), "Uplink captured", "Uplink
  lost"; an "Uplink under attack!" toast when the enemy starts pushing one
  of yours off-screen. Sounds: a data-burst chime, a dying-signal fall, a
  transport drone and a reward fanfare.
- **AI** (`ai/objectives.ts`): from 0:20 it sends a squad worth ≥ 400 (or
  1.3× the visible enemy there) to the best Uplink it doesn't hold —
  nearest its own side first; mid-assault only if the army is 2.5× the
  squad — keeps the squad on the ring until the bar is full, then parks
  its cheapest unit there as a garrison. Capture squads take robot
  infantry first (candidates go by distance over capture weight, so a squad
  counts as half as far; never a Sniper Team), and a Trooper Squad, the
  cheapest combat unit, makes a natural garrison. Enemies near a held
  Uplink count as threats, so the threat response defends it. Every announced crate gets
  the nearest free units that can make it before it burns out (straight
  race while it's quiet, attack-move if enemies are there), never more
  than it'd feed and never drones into known anti-air. It never looks at
  what a crate holds before claiming it. Boom only contests its own
  flank, Ironclad leans to the centre; Easy takes neutral relays but never
  comes for yours, and only races crates near its own units.
- **Measured when it shipped** (with 3 scrap/s Uplinks and +300 crates,
  before the balance pass; AI-vs-AI, 5 maps × 6 personality pairings × 2 seeds,
  openers on, Normal, before → after): combat-unit deaths in the middle
  40% of the HQ-HQ line 13% → 27% (first 5 min 13% → 28%); draws 0 → 0 of
  60; median length 5.1 → 5.5 min, p90 12.1 → 7.6; about 3 Uplink captures
  and 8–10 crates claimed per match, objectives ≈ 9% of all scrap earned.
  The side ahead by 200+ assets at 2:00 / 3:00 / 4:00 went on to win
  92 / 93 / 92% → 86 / 96 / 98%: objectives open the early game up but pay
  whoever controls the field, so later leads hold. The full round robin
  (`tools/balance.ts matches`, 150 games) keeps the personality spread
  where it was (Ironclad 92 → 90%, Boom 72 → 78%, Rush 24 → 18%, Skyforce
  16 → 22%) with no draws. Before the mid-assault squads, the AI
  sat on its first relay (2.5 flips per match → 4.3 with them).

### Fog of war

- Unexplored (an opaque, biome-tinted shroud), explored-but-unseen (a
  greyed memory; remembers enemy buildings), visible. Rendered as a
  smoothly fading soft-edged overlay.
- A remembered enemy building is drawn as last seen: its damage look
  follows the health it had then, and it shows no smoke, hit flash, health
  bar, EMP crackle or turning turret while out of sight. One destroyed in
  the fog stays standing (as on the minimap) until its footprint is seen
  again. Enemy building blasts show only where seen; ours, a Gantry's, and
  the HQ that decides the match, always show.
- **The Gantry and every Goliath are always visible to the enemy**
  (`alwaysVisible`): they can't hide. An enemy Gantry is in the fog memory
  from the moment it goes up and is forgotten the moment it falls, and it
  is drawn live, not as a memory, with the Goliath taking shape on its
  cradle and a red progress bar under it. An enemy Goliath is seen through
  the fog and the shroud alike (`unitSeenBy`): on the minimap, by taps,
  the AI, the advisor, the inbound warnings and the battle meter, and its
  guns flash even from deep in the fog. Both are drawn with
  a fog-free twin of the model material (`clearOfFog`), so they show in
  full colour. Their news is public too (see *Voices & announcer*).
  A Goliath sees 10 tiles, further than any other unit (Radar 13).
- The AI does *not* cheat: it keeps its own visibility map and reacts only
  to what it has seen.
- A Sniper Team hidden in woods (see *Combat*) stays hidden even on a tile
  in sight: no unit, blip, tap target or AI sighting until it fires or an
  enemy comes within 3 tiles.

### AI opponent

A commander that runs a decision pass every 1.2–3.5 s (by difficulty) and
emits ordinary commands. Six personalities, picked at random each match:

| Strategy | Plan |
|---|---|
| Balanced | Factory, airpad, tech, then an Assembly Bay (a quarter of its army's value in infantry); steady macro; Condor drops |
| Rush | Two factories and an Assembly Bay second; Troopers (40% of army value) alongside Stinger raids in packs of five, five harvesters, the earliest and smallest waves; Condor drops |
| Air Swarm | Airpad first, wasp raids, bombers later; an Assembly Bay for Rocket Squads once it has seen heavy armour |
| Boom | Greedy economy, a turret and the Tech Lab before its forward depot, huge late push; an Assembly Bay for Rocket Squads once it has seen heavy armour |
| Skyforce | Air force first; the Fab Plant only guards home; Rocket Squads once it has seen heavy armour, like Air Swarm |
| Ironclad | Tech Lab right after its first turret, then an Assembly Bay: Mastodons, each with a Rocket Squad escort, Lancers and Mortars |

Behaviours: build orders with reactive SAM sites and extra factories when
scrap piles up; forward depots at distant fields; adaptive production
(flak/raptors vs air it has seen, mortars vs defences, air vs heavy
armour); defend-the-economy guard squads; threat response against
intruders; home defence (a force at the HQ that outguns the home guard
recalls the army from raids and waves — openers make 1:00 pushes real);
wasp raids that avoid remembered anti-air; staged assault waves —
launched once three quarters of the personality's assault threshold has
gathered at the staging point, so a big wave goes, then there is a lull
while the next gathers (the bar drops 6% a minute after 7:00) — that go
for harvesters, then production, then defences, then the HQ;
Menders that are never a wave, raid or guard post of their own
(`ai/menders.ts`): each pass a Mender goes to the worst-hurt unit close by
(under 85% HP, within 20 tiles), else tags along with the nearest unit on
the move, but never after a lone unit deep in enemy ground (within 16 tiles
of the enemy HQ with under 400 scrap of company): with nobody worth
following it flies home to the base's most battered building, instead of
hovering where the fight was; enemy Menders near its buildings, harvesters
or Uplinks count as intruders, so threat response sends anti-air at them;
wounded veterans (rank ≥ 2 under 35% HP) falling
back to a Mender behind them or to the HQ, with an idle Mender sent to patch
them up (`ai/veterans.ts`); commander calldowns and a reflex for
dodging the enemy's (see Commander calldowns); salvage sweeps once a fight near home is
over (idle ground units within 8 tiles — 5 while an assault gathers, so the
wave waiting at its staging point grabs what's close — go for visible,
cooled wrecks that no visible enemy or known turret covers, and harvesters
going about their work detour to a wreck within 5 tiles however full they
are, since a wreck's scrap goes straight to the bank — never into the enemy
for loot; a harvester sent back to work with a full hold unloads first);
map objectives (capture squads, Uplink garrisons, crate races — see Map objectives).

Robot infantry (`ai/intel.ts`, `ai/condor.ts`):

- **Eyes.** Everything the commander decides about enemy units goes
  through one helper that applies fog *and* Sniper concealment
  (`seenEnemies`), so it never reacts to a Sniper it couldn't see.
- **Anti-air in Flak.** Anti-air counts by how hard it really hits
  aircraft: DPS × air multiplier over a Flak Crawler's, capped at 1 —
  Flak, Raptors and SAMs 1, Rocket Squads 1, Turrets 0.8, Lancers 0.6, a
  Trooper Squad 0.2. A spot counts as covered at 0.5 or more, so one rifle
  squad doesn't call off a drone raid, and the AI's own anti-air only
  counts units worth 0.5 or more. A Condor seen counts 0.5 toward enemy
  air.
- **Counters.** It tallies the enemy infantry it sees (`seenInfantry`).
  Against an infantry-heavy army (3+ squads, at least 40% of its ground
  units) the Fab Plant builds a Mortar or a Stinger 65% of the time (Mortars
  capped at min(3, 1 + squads / 4): they die fast in a brawl); 5 squads
  seen add a Turret, 9 a second; Sniper Teams answer infantry (min(3,
  squads / 3), never on Easy), Rocket Squads answer Mastodons and Hornets
  (0.8 per heavy unit seen). Threat response and waves never send a unit
  whose damage multiplier against the target is below 0.45: no Sniper Team
  at a tank or a building. Infantry still marching up to the staging point
  goes with a launching wave.
- **Condor drops** (Rush and Balanced, and every personality under Airborne
  or Infantry War; never on Easy, in Last Stand, or
  under rules that ban the Condor): from 2:30 it picks a landing zone 2.5
  tiles short of the enemy harvesters with no anti-air it can see or
  remember and no ground defenders it knows of worth more than 0.8× the
  squads within 6 tiles, and a route in that flies round known anti-air by
  a flank waypoint. If every harvester line is covered but an assault is
  under way, it flies the squads up behind the wave instead (the biggest
  group of ours pushing out past 18 tiles from home, worth 500+, set down 3
  tiles behind it if that spot and a way there are clear of anti-air), and
  they follow the wave to where it's headed: squads walk at half a tank's
  speed, so this is how they keep up. Only when it has a way in does it
  start loading healthy squads (≥ 70% HP, within 16 tiles, idle or just
  walking to a post) at home: whoever is free boards at once and more are
  called aboard as they come free, and it flies when both seats are full,
  or after 40 s with whoever is aboard; while every way in is covered they
  stay on the ground. It calls the trip off if it loses 30% of its HP on
  the way in (on a straight run to the drop too, until the hover starts),
  or if the landing zone turns out held or under anti-air (it tries another
  way in first). A called-off trip flies home and sets its squads down
  there, the next boarding waits 45 s, and the guards and anti-air it ran
  into (within 8 tiles of the Condor or the landing zone) are remembered
  for 90 s where they were seen, so the next trip doesn't fly straight back
  into them. A landed drop's squads raid the harvester line for 50 s; the
  empty Condor flies home and goes again 45 s later. At most 3 Condors a
  match, a lost one rebuilt no sooner than 90 s after. Over 150 AI games
  the landed drops destroy about two thirds of what they and the Condors
  cost (see *Infantry pass*): a harassment option, not a match winner.

Goliaths (`ai/goliath.ts`; every threshold in `GOLIATH_AI`; what isn't
finished is in `AI-GOLIATH-NOTES.md`):

- **The Gantry.** Never on Easy, in Last Stand or an Op. From a
  personality's hour (Ironclad 3:30, Boom 4:00, Balanced 5:00, Air Swarm
  7:00, Skyforce 7:30, Rush 8:00; Hard 15% sooner, and sooner for anyone
  once an enemy Gantry or Goliath is seen), with the income, an army, no
  attack on the base, 2,000 scrap banked and 15,000 scrap of fields on its
  own half (the island maps are exempt). The prerequisites it lacks are
  built first; after two lost Gantries no third goes up.
- **Goliaths.** One at a time, at most 2 alive (1 on the island maps), at
  the escalating price; while one is wanted a share of each pass's income
  is set aside for it, but nothing while the army is thin or the base is
  threatened.
- **Sites.** It digs a Goliath in at a rich field no drop-off serves, an
  island relay, or (Balanced, Rush, Ironclad) a forward post, never under
  the enemy's known guns; there harvesters unload at it, a Depot, a Turret
  and a SAM site go up in its ring, and it trains squads. It packs up when
  the field is dry, when it is losing a fight, or for a much better site.
  Idle army worth part of its price (anti-air first if the enemy flies)
  walks with it; 2–3 Menders go to it first when a weapon is down.
- **Lifts.** Where it can't walk (an island, or a long way round), two
  free Condors fly it once a route clear of known anti-air exists; anti-air
  on the way sends it round or back, and a hurt Condor sets it down at once.
- **Siege.** Rush and Ironclad Goliaths, and from 12:00 one holding a
  forward post, fall in a few tiles behind a wave's lead, never alone into
  the enemy's base.
- **Hunts.** Idle units that can hurt an enemy Goliath strike when they
  outweigh what it can still fire (sooner while a weapon is down), its
  Menders first; anti-air goes for the Condors carrying one; an enemy Gantry
  with a Goliath on its cradle is a wave's first target. Seeing Goliaths
  tilts production toward Lancers, Rocket Squads and Hornets.
- **No HQ.** With its HQ gone (or under Nomads, from the start) the
  commander plays on: the Goliath digs in somewhere safe as the base, takes
  the scrap, trains squads (and Harvesters, under Nomads), buildings go up in
  its ring, and it moves the base on when the field runs dry. Under Robot
  Love its Goliaths keep clear of the enemy's, unless it is plainly losing,
  when it goes courting for the draw.

Difficulty: **Easy** (slow reactions, 75% income, no raids, no Sniper
Teams or Condor drops), **Normal**,
**Hard** (fast reactions, +30% income, an extra harvester — shown in the
menu, never hidden). Each difficulty also picks from its own pool of
personalities: AI-vs-AI tournaments (`tools/balance.ts matches`) show
Ironclad, Boom and Balanced are the strongest, so Easy draws from Balanced,
Rush and Air Swarm (Skyforce's all-air wave at ~3:00 was the one Easy
opponent a first-week player usually lost to; see *Difficulty on-ramp*), and
Hard from Balanced, Air Swarm, Boom and Ironclad. AI-vs-AI games settle in a
median of ~10½ minutes since robot infantry and the fixes after its review
(~9¾ when it first shipped, ~8¼ before it).

### Balance & pacing

With openers, longer fights, salvage, calldowns and objectives all in, one
pass retuned the numbers together against measured targets. Before it,
the AI sent a wave every time 500–1,200 scrap had gathered, so both sides
sat in assault mode from about 2:00 and a match was usually one unbroken
brawl from the first crate race to the last HQ; the side ahead at 4:00 won
90% of the time.

What changed (numbers only, plus AI thresholds):

- **AI waves** launch once 75% of the assault threshold has gathered at
  the staging point (was 60%): bigger waves with a lull between them. Assault
  thresholds: Balanced 1700, Rush 1400, Air Swarm 1700, Boom 2000,
  Skyforce 2000, Ironclad 1500 (were 1400 / 800 / 1200 / 2000 / 1300 / 1800;
  Ironclad's is 1400 since the *Infantry pass*);
  Ironclad builds a turret before its Tech Lab; Rush raids in packs of five
  (was three); the late-game discount on the threshold starts at 7:00
  (was 9:00).
- **Calldowns:** the meter earns 0.035/s, 0.008 per scrap lost and 0.002
  per scrap killed (was 0.1 / 0.02 / 0.007); the Sky Hammer recharges in
  150 s (was 120); the AI Barrages clumps worth ≥ 800 (was 450), which
  leaves charge for EMPs and Drop Pods.
- **Objectives:** an Uplink pays 1.5 scrap/s and 0.06 ⚡/s (was 3 / 0.1);
  a scrap crate holds 200 (was 300). Objectives pay whoever already holds the
  field. Single-lever tests showed they were the biggest snowball
  amplifier (switching them off took the 4:00 leader from 87% to 75%, but
  mid-map deaths fell from 26% to 13%), so they now pay less and still pull
  armies into the middle.
- Unit stats are unchanged. The duel matrix (`tools/balance.ts duels`)
  moved by a few hundredths with the final pass's fairness fix (red's units
  now path as blue's mirror image) and every counter in the web still holds
  (e.g. Stingers +0.66 vs Flak, Lancers +0.30 vs Mastodons, Mastodons +0.63 vs
  Stingers, Flak +0.66 / +0.65 / +0.21 vs Wasps / Raptors / Hornets).
- **Final pass** (every lane merged): the skirmish numbers above needed no
  re-tuning (the "Merged" column below, re-measured with lane C's
  wounded-veteran retreats and Air War rules in). The fixes were fairness
  (red's edge, below), Easy's personality pool (*Difficulty on-ramp*) and
  Last Stand, which salvage had broken (see Last Stand).

Measured with `tools/pacing.ts`: AI vs AI, Normal, each AI on its own
opener, Uplinks and drops on, every ordered pair of distinct personalities
on all 5 maps × 8 match seeds (1,200 matches per column, so the headline
shares are good to about ±3%), 25-minute cap. The original-game column is
the same measurement against a checkout of 187e23a (no openers or
objectives); "First pass" is this pass as it first shipped, before lane C.

| | Original (187e23a) | First pass | Merged | Final |
|---|---|---|---|---|
| 25-minute draws | 14% | 0.8% | 0.8% | 0.9% |
| Decided match length, median (p10–p90) | 5:51 (4:01–16:52) | 8:43 (5:22–17:18) | 8:33 (5:24–17:20) | **8:17** (5:23–17:17) |
| First combat-unit death, median | 1:47 | 1:18 | 1:18 | 1:17 |
| Big fights (≥ 1000 scrap destroyed) per decided match: median / mean / share with ≥ 3 | 2 / 3.0 / 34% | 3 / 3.5 / 51% | 2 / 3.5 / 49% | 2 / 3.4 / **47%** |
| Side ahead by > 200 value at 2:00 / 3:00 / 4:00 went on to win | 82 / 86 / 89% | 67 / 75 / 78% | 67 / 74 / 78% | **67 / 74 / 78%** |
| Lead changes per match (300 deadband), mean; winner had been 800+ behind | 1.6; 24% | 2.2; 46% | 2.2; 46% | 2.2; **46%** |
| Unit deaths in the middle 40% of the HQ–HQ line | 12% | 29% | 28% | **28%** |
| Calldowns per AI per match, median (mean) | — | 7 (7.5) | 6 (7.4) | 6 (7.3): Barrage 1.9, EMP 2.5, Drop Pod 0.7, Sky Hammer 2.2 |
| Matches where an Uplink changed hands; landed crates claimed | — | 84%; 99% | 83%; 99% | 83%; 99% |
| Personality win rates (Balanced / Rush / Air Swarm / Boom / Skyforce / Ironclad) | 55 / 16 / 28 / 69 / 7 / 83% | 54 / 30 / 35 / 71 / 37 / 71% | 53 / 31 / 36 / 68 / 37 / 73% | 51 / 27 / 41 / 68 / 38 / 73% |
| Red's share of decided games: Riverlands / Dune Sea / Frostbite / Ashlands / Proving Grounds | — | — | 51 / 51 / 55 / **65** / 48% | 47 / 49 / 48 / **51** / 48% |

Targets: draws ≤ 3%, decided median 7–10 min, the 4:00 leader winning
≤ 82%, ≥ 25% of deaths in the middle 40%, 3+ big fights in ≥ 45% of
decided matches, every personality within ~25–75%. All hold, and held
with robot infantry in; since the fixes from the infantry review the
decided median (10:25) sits just over its band, and the rest still hold
(*Infantry pass* below).

How to read it:

- Fighting is now nearly continuous from the first crate race. The
  big-fight count merges any run of 10 s windows with 300+ destroyed, so a
  three-minute brawl counts once. Short games, mostly the lopsided
  personality pairings, still show one or two.
- The long tail is the air-versus-anti-air pairings (Skyforce, Air Swarm),
  most often on Ashlands. The Sky Hammer and the 7:00 threshold discount
  keep draws under 1%.

**Side fairness.** Every map is exactly point-symmetric, yet red won about
70% of Ashlands mirror matches (same personality on both sides) and 65% of
its decided games above, and out-harvested blue by ~9% at 4:00 in AI
mirror games while plain harvesting was even. The player is always blue.
The cause was tie-breaks that went by scan order, which a 180° turn doesn't
preserve: units always rolled out of a factory's *south* side (away from
the enemy for blue, toward it for red); the harvesters' nearest-field BFS,
`nearestScrapTile` and A* took neighbours in a fixed order, and A* floored
a point on a tile edge (Riverlands' centre Uplink) to different tiles for
the two sides; the AI's building-placement, depot and Drop Pod scans, dock
ties, its guard point (a tile corner, not its centre) and priority targets
(sorted by footprint corner) all leaned one way; and the AI raced the first
crate of a drop's pair, which is blue's for both sides. Every such search
now runs in the side's own frame (`sideFrame` in `world.ts`: red's search
is blue's turned 180°). A mirror match with the same seeds stays an exact
mirror image through its opening (`tests/symmetry.test.ts`, every case of
which fails on the old code); later, fights between interleaved unit ids
drift it apart at float precision, which is noise, not bias.

| Riverlands / Dune Sea / Frostbite / Ashlands / Proving Grounds | Before | After |
|---|---|---|
| AI mirror matches (`tools/pacing.ts run --mirror --seeds 8`, ~46 decided a map, ±7%): red's share of decided games | 30 / 59 / 52 / **70** / 38% | 52 / 44 / 65 / **37** / 54% (all 51%) |
| …red's harvest by 4:00 vs blue's | −1 / **+9** / −2 / **+9** / +1% | +1 / −1 / +1 / 0 / +2% |
| The panel above (distinct personalities, ~238 decided a map, ±3%): red's share | 51 / 51 / 55 / **65** / 48% | 47 / 49 / 48 / **51** / 48% |

The harvest gap, the cleanest symptom, is gone on every map, and the big
panel puts every map within noise of 50%. The small mirror sample still
swings by up to ±15 points a map (about 2σ at this size; other seeds gave
Frostbite 44–63% and Ashlands 38–46%), as it did before the fix
(Riverlands 30%).

**Difficulty on-ramp** (`tools/beginner.ts`): a scripted blue player
against the AI on all 5 maps, every personality the difficulty draws and
each opener, Uplinks and drops on. None of the scripts touches calldowns,
Uplinks or crates:

- *novice*: looks at the battle every 4 s and gives one order per look,
  keeps 3 harvesters, builds Fab → Turret → Airpad and never techs, attacks
  at 8:00 with 12+ units;
- *beginner*: looks every 3 s with steady macro (Fab → Airpad → Turret →
  Tech Lab → Turret, 4 harvesters), answers attacks on its base, attacks
  late (from 7:00, 12+ units);
- *decent*: the beginner's macro, looking every second and attacking with
  8+ units from the start (close to the first pass's `human.ts`).

| Player wins | vs Easy (before → after) | vs Normal |
|---|---|---|
| novice | 72% → **89%** | 32% |
| beginner | 93% → **100%** | 84% |
| decent | — → **82%** | 37% |

(Measured before robot infantry; the re-run is in *Infantry pass* below.)

The AI got tougher, but not for a new player on Easy: the one Easy
opponent that beat the novice was Skyforce, whose all-air wave lands at
~3:00 (11 of 15 games won against a player still building Stingers; Air
Swarm, Easy's other air commander, lost 11 of 15), so Easy now draws only
Balanced, Rush and Air Swarm. Easy's income and wave knobs didn't help
there (income 75% → 65%: Skyforce still won 11 of 15; assault ×1.35 →
×1.6: 14 of 15). Normal stays a challenge: the novice and the decent
script win about a third of their games. The patient beginner wins most
(74% before the fairness fix, which also took away the AI's red-side
edge): the Normal AI keeps launching its waves into a turtled base with
two turrets and loses units two-for-one, then has nothing left when the
push comes. A real player who also takes Uplinks, crates and calldowns
should do better than any of these scripts; their win rates are floors.

**Infantry pass.** Robot infantry and every side's starting Trooper Squad
changed the field, so the skirmish was measured again with the same
harnesses and tuned until every target held. The duel matrix
(`tools/balance.ts duels`: cost-equal armies of 1,800 scrap, + means the
row army wins):

| | Stinger | Flak | Mortar | Mastodon | Lancer | Wasp | Raptor | Hornet | Trooper | Rocket | Sniper |
|---|---|---|---|---|---|---|---|---|---|---|---|
| **Stinger** | – | 0.66 | 0.39 | −0.63 | 0.40 | −0.29 | 0.03 | −0.41 | 0.15 | 0.48 | 0.87 |
| **Flak** | −0.66 | – | −1.07 | −0.88 | −0.68 | 0.66 | 0.65 | 0.21 | −0.38 | −0.52 | −0.40 |
| **Mortar** | −0.39 | 1.07 | – | −0.61 | −0.52 | −0.92 | 0.10 | −0.86 | 0.55 | 0.62 | 0.89 |
| **Mastodon** | 0.63 | 0.88 | 0.61 | – | −0.30 | −0.28 | 0.08 | −0.20 | 0.13 | −0.69 | 0.91 |
| **Lancer** | −0.40 | 0.68 | 0.52 | 0.30 | – | −0.41 | 0.26 | −0.10 | −0.43 | −0.33 | 0.89 |
| **Wasp** | 0.29 | −0.66 | 0.92 | 0.28 | 0.41 | – | −0.42 | −0.04 | −0.26 | −0.61 | 0.75 |
| **Raptor** | −0.03 | −0.65 | −0.10 | −0.08 | −0.26 | 0.42 | – | 0.41 | −0.13 | −0.63 | −0.03 |
| **Hornet** | 0.41 | −0.21 | 0.86 | 0.20 | 0.10 | 0.04 | −0.41 | – | 0.68 | −0.31 | 0.94 |
| **Trooper** | −0.15 | 0.38 | −0.55 | −0.13 | 0.43 | 0.26 | 0.13 | −0.68 | – | 0.79 | −0.37 |
| **Rocket** | −0.48 | 0.52 | −0.62 | 0.69 | 0.33 | 0.61 | 0.63 | 0.31 | −0.79 | – | −0.87 |
| **Sniper** | −0.87 | 0.40 | −0.89 | −0.91 | −0.89 | −0.75 | 0.03 | −0.94 | 0.37 | 0.87 | – |

The vehicle block is unchanged, and the whole matrix came out the same to
the hundredth when re-run after the review fixes. Outside the matrix, a
Turret (225 scrap) against two Trooper Squads (200) wins with 511 of its
650 HP left.

What changed, and why (win rates from `tools/pacing.ts` panels of one or
two seeds, `--with <personality>` for single-lever tests):

- **Trooper Squad 225 HP / 18 DPS → 190 / 15.** At the draft's numbers
  Troopers beat Stingers by 0.48 cost for cost, and Stingers are meant to
  handle infantry. Now Stingers win by 0.15, Snipers by 0.37 (was 0.15)
  and Mortars by 0.55; Lancers still lose to Troopers (−0.43).
- **Rocket Squad 180 HP / ×0.8 vs air → 210 / ×1.5.** At the draft's
  numbers they lost to Hornets by 0.59, because each bomb splashes several
  squads. Now they beat Hornets by 0.31 and Mastodons by 0.69 (was 0.33). HP
  stays at or below 225, so two Sniper shots still wipe a squad.
- **Cannon vs infantry ×0.6 → ×0.4.** With the draft's ×0.6, Mastodons beat
  Troopers by 0.41 cost for cost, and no Trooper buff could close that
  without Troopers beating Stingers again. At ×0.4 Mastodons only edge them
  out (+0.13), Rocket Squads beat Mastodons by 0.69 (was 0.52) and lose to
  Troopers by 0.79 (was 0.68); the rest of the matrix is unchanged.
  Re-measured with `tools/balance.ts matches` (one seed): Balanced 56,
  Rush 38, Air Swarm 48, Boom 52, Skyforce 42, Ironclad 64%, no draws;
  the beginner still wins 45/45 on Easy.
- **Rush keeps 5 harvesters** (was 4), builds its Assembly Bay second and
  keeps 40% of its army value in infantry. With infantry in, Rush won only
  16–26% (38% on its old build with no Bay); every side's starting squad
  blunts its opening raids, and the fifth harvester, which pays for the Bay
  and its Troopers, brought it to 36–40%. Raids of 4 with waves at
  1600 also reached 39%, but made the Glass Jaw op nearly unwinnable (the
  scripted general won 1 of 6 seeds). The two Rush ops, Bridgehead and Glass
  Jaw, keep the 4 harvesters they were tuned against.
- **Boom's Depot moves from 2nd to 4th**, after a Turret and the Tech Lab.
  Boom had risen to 74–76%; 3 harvesters gave 34%, waves at 2400 82%, at
  1700 61%; the later Depot gave 61% with more even pairings.
- **Ironclad's assault threshold 1500 → 1400**, plus an Assembly Bay after
  its Tech Lab and one Rocket Squad escort per Mastodon. It sat at 72–76%;
  1300 gave 58%, 1800 82%, and 0.6 escorts per Mastodon 77%.
- **Balanced** adds an Assembly Bay after its Tech Lab and keeps a quarter
  of its army value in infantry; **Air Swarm** and **Skyforce** build a Bay
  early once they have seen two heavy units, for Rocket Squads and Sniper
  Teams only, and since the review fixes so does **Boom** (before, it never
  answered Mastodons with Rocket Squads; it fields 1–3 now on 4 of 5 maps
  against Ironclad).
- **AI anti-air counted in Flak** (*AI opponent*). Before, any unit that
  could hit air counted as one anti-air unit, so blue's starting squad by
  its HQ kept calling off Air Swarm's opening Wasp raid.

Result on the pacing panel (`tools/pacing.ts`, as above but 4 match seeds:
600 matches, 200 a personality), against the *Final* column above. The
"Infantry pass" column was measured with cannon at ×0.6 vs infantry, before
the change to ×0.4; "Review fixes" is the same panel re-run on the shipped
code, with ×0.4 and the fixes from the infantry review in (squads shoulder
past parked vehicles, drops set down clear of the water's edge, the Condor
drop plan's caution and memory, Boom's reactive Assembly Bay; see *AI
opponent* and *Units*):

| | Final (8 seeds) | Infantry pass (4 seeds) | Review fixes (4 seeds) |
|---|---|---|---|
| 25-minute draws | 0.9% | 0.3% (2) | 1.5% (9) |
| Decided match length, median (p10–p90) | 8:17 (5:23–17:17) | **9:42** (5:52–17:14) | **10:25** (5:56–18:33) |
| First combat-unit death, median | 1:17 | 1:09 (squads now count as combat units) | 1:05 |
| Big fights per decided match: median / mean / share with ≥ 3 | 2 / 3.4 / 47% | 3 / 3.7 / **57%** | 3 / 4.1 / **62%** |
| Side ahead at 2:00 / 3:00 / 4:00 (/ 5:00) went on to win | 67 / 74 / 78% | 54 / 69 / **71%** (74%) | 54 / 64 / **70%** (72%) |
| Lead changes per match, mean; winner had been 800+ behind | 2.2; 46% | 3.0; **65%** | 3.2; **64%** |
| Unit deaths in the middle 40% of the HQ–HQ line | 28% | 29% (combat units 31%) | 29% (combat units 31%) |
| Calldowns per AI per match, median (mean) | 6 (7.3) | 7 (7.9) | 8 (8.5) |
| Matches where an Uplink changed hands; landed crates claimed | 83%; 99% | 91%; 99% | 90%; 99% |
| Personality win rates (Balanced / Rush / Air Swarm / Boom / Skyforce / Ironclad) | 51 / 27 / 41 / 68 / 38 / 73% | 53 / 38 / 47 / 59 / 41 / 63% | 53 / 41 / 40 / 63 / 39 / 62% |
| Red's share of decided games: Riverlands / Dune Sea / Frostbite / Ashlands / Proving Grounds | 47 / 49 / 48 / 51 / 48% | 55 / 47 / 44 / 57 / 53% (all 51%) | 56 / 45 / 48 / 45 / 57% (all 50%) |

At the Infantry pass every target held, with the decided median near the
top of its 7–10 minute band. After the review fixes every target still
holds but that one: personalities win 39–63%, draws are 1.5%, the side
ahead at 4:00 wins 70%, 62% of decided matches have three or more big
fights and 29% of deaths fall in the middle 40%, but the decided median is
**10:25**, just over the band. On the panel's first two seeds (the same
300 matches) the median went 9:42 at the Infantry pass → 10:09 with the
review fixes but cannon still ×0.6 (`--tune
'{"DAMAGE_VS.cannon.infantry":0.6}'`) → 10:33 shipped: about half from the
fixes and half from cannon ×0.4, each step near the noise. The games that
grew are those of the two infantry-heavy, Condor-flying personalities
(pairings with Balanced or Rush went from 9:38–9:53 to 11:03–11:13);
Ironclad's stay short (7:35), and 8 of the 9 draws involve Skyforce (7 are
on Ashlands). Nothing was retuned for it: cannon ×0.4 was a deliberate
call, and INFANTRY.md's "Done when" targets (every personality 25–75%, the
beginner ≥ 85% on Easy) hold.

The single-seed round robin (`tools/balance.ts matches`, 150 games) gave
56 / 42 / 36 / 50 / 48 / 66% at the Infantry pass with 1 draw, a mean
length of 10.8 min, 9,697 scrap salvaged per match (19.9% of income), 7.7
calldowns per AI, 4.5 Uplink captures and 15.7 crates claimed per match.
After the review fixes it gives **56 / 38 / 38 / 70 / 36 / 58%** with 2
draws, a mean length of 11.0 min, 9,836 scrap salvaged per match (20.2%),
7.8 calldowns per AI, 4.4 Uplink captures and 16.1 crates claimed. Boom's
70% is the highest any personality reaches in these runs, still inside
25–75% (63% on the panel; one seed is good to about ±7%). It isn't Boom's
new Bay: with `--tune '{"STRATEGIES.boom.bayVsArmour":false}'` the round
robin gives it 70% too, against 52% before the fixes at ×0.4; the gain is
spread over its opponents.

Infantry in AI hands (seed set 0 of the panel, 150 matches). At the
Infantry pass, Rush and Balanced made 216 Condor unloads carrying 430
squads, which destroyed 39,735 scrap of units and buildings (35 harvesters
among them) for 315 squads and 28 Condors lost: about break-even. That
count took in the unloads at home after a 40 s wait in the hold, and the
old plan kept flying back into the same anti-air. After the review fixes
the same count gives 140 unloads carrying 280 squads, which destroyed
18,665 scrap (37 harvesters) for 185 squads and 29 Condors. Of those, 87
were drops that landed away from home (174 squads; the other 53 set
their squads down at home: a trip called off, the base under attack, or no
way in within 40 s): the dropped squads destroyed 11,080 scrap (33
harvesters) for 100 squads (11,425 scrap), and 29 Condors were lost, only
one of them with squads aboard. The drops now cost about 1.5× what they
take, but they no longer feed loaded Condors to the same anti-air. Value
destroyed per value lost, after the fixes: Sniper Teams 1.41–3.04, Rocket
Squads 1.06–1.58, Troopers 0.82–0.90 (Balanced, Rush: the personalities
that train them), against Stingers' 0.93–1.66 (at the Infantry pass
1.63–2.9, 1.13–1.62, 0.81–0.82 and 0.95–1.54); Mortars trade at 0.57–0.68
for every personality, a weakness that predates infantry.

The on-ramp (`tools/beginner.ts`, 1 seed): the beginner still wins 100%
on Easy (45/45) and the novice 89% (40/45, all five losses to Air Swarm),
at the Infantry pass and again after the review fixes. The beginner on
Normal went from 84% before infantry to 80% (72/90) at the Infantry pass
and 83% (75/90) after the fixes (Balanced, Air Swarm and Skyforce won 4
games each, Boom 2, Ironclad 1, Rush none), each step within about one
standard error.

**Goliath pass.** The Goliath and the Gantry were measured with the same
harnesses; no unit number changed for them. A lone Goliath against 1,600
scrap of each unit (`tools/balance.ts goliath`, from both sides of the
field, + means the Goliath wins):

| Wasp | Lancer | Hornet | Rocket | Mastodon | Stinger | Trooper | Mortar | Raptor | Sniper | Flak |
|---|---|---|---|---|---|---|---|---|---|---|
| −0.84 | −0.61 | −0.54 | −0.39 | −0.09 | +0.22 | +0.41 | +0.50 | +0.61 | +0.89 | +0.96 |

So it is the counter GOLIATH.md wants: it crushes infantry, Snipers,
Mortars and the anti-air that can't touch a ground giant, is even with
Mastodons, and loses to its counters, Lancers, Rocket Squads, Hornets and
Wasps (which strip most of its weapons before it dies). With
two Menders (1,900 scrap against 1,900) the scores fall (Troopers −0.46,
Stingers −0.24): a 20–40 s brawl is too short for repairs to pay back
their price; the Menders earn it between fights, bringing weapons back.

AI-vs-AI round robins at the head (`tools/balance.ts matches <map>`, 30
matches a map, against `--no-goliath`):

| Map | Mean length, no Goliaths → with | Matches with a Goliath | First rollout (median) | Undecided at 25:00 |
|---|---|---|---|---|
| Proving Grounds | 9.4 → 9.3 min | 0/30 | – | 0 → 0 |
| Riverlands | 9.8 → 9.8 | 18/30 | 7:38 | 0 → 1 |
| Dune Sea | 10.9 → 12.6 | 26/30 | 7:38 | 1 → 2 |
| Frostbite | 10.4 → 11.6 | 22/30 | 6:34 | 0 → 0 |
| Ashlands | 12.8 → 13.0 | 23/30 | 7:56 | 1 → 0 |
| Archipelago | 16.0 → 16.7 | 24/30 | 9:08 | 1 → 2 |

The Proving Grounds has too few fields for the AI's Gantry gate (15,000
scrap of fields on its own half), so it doesn't build one there: in an
earlier run without that gate Goliaths stretched its matches from 9.4 to
11.8 minutes on average and left three of 30 level at 25:00. Elsewhere a Goliath that died lived 3–5 minutes after rollout,
having killed 1,400–2,700 scrap and taken in 1,200–2,500 of harvest first:
it pays its own list price back, mostly as a base. Outposts per match:
Dune Sea 5.2 (10,217 scrap unloaded at Goliaths), Ashlands 4.5 (7,050),
Riverlands 3.2 (5,147), Frostbite 1.8 (3,607), Archipelago 0.7, where 0.9
lifts a match fly Goliaths to islands. A beaten side outlived its HQ on a
Goliath once in 180 matches (by 5:24). Win rates by personality moved
within the noise of 10 games each a map (Boom gained on Frostbite and
Ashlands, Skyforce lost on Riverlands and gained on Dune Sea). Matches on
the land maps still average 9–13 minutes; the Archipelago's
two matches left level (against one without Goliaths) are the AI's open
problem, a side dug in behind a Goliath and static defences that the
winning side won't close out (`AI-GOLIATH-NOTES.md`).

Known gaps (re-checked after the review fixes):

- A Rocket Squad (range 4) can kill a Turret without being shot back,
  because units measure range to a building's edge but a Turret measures
  from its centre (the same old quirk lets Lancers at range 4.5 do it).
  A Turret still beats two Trooper Squads, with 511 of its 650 HP left,
  and Sniper Teams out-range it by design.
- The decided median, 10:25, is just over its 7–10 minute band (above).
- The Condor sees 6 tiles, so Flak waiting in the fog by a landing zone is
  often first seen 2.5–4 tiles out, once the hover has begun: that drop
  lands hurt. Once the 90 s memory runs out, the AI may try the same field
  again.
- A drop pressed into a one-tile pocket walled in by rock (six such tiles
  on Proving Grounds) or a one-tile strip in a map corner still lands
  there, where the squads can't walk out; avoiding it needs a reachability
  check on the drop point.
- A squad whose straight path runs exactly through a parked friendly
  vehicle's centre pushes it all the way to the squad's goal, as one
  vehicle does another; the slightest offset slides past instead.

### Match flow

1. Menu: pick a mode (Skirmish | Last Stand | Ops), a map, a difficulty and
   any mutators → Play (or watch the AI play), or play today's Daily Op; in
   Ops, pick an op card → briefing → Start op.
2. Skirmish (and the Daily Op): opener cards over the frozen battlefield
   (Blitz / Industry / Air Wing; tap, or keys 1–3; cards a mutator bans are
   greyed out). The camera already frames the HQ (under Nomads, the
   anchored Goliath), its home field, the
   factory site and the starting squad, clear of the HUD (the zoom buttons
   included). Spectated AIs pick instantly. Last Stand and Ops have their
   own set-ups and no cards.
3. The pick rolls out (factory, units, harvesters already mining) and the
   clock starts. Real-time play until a side has lost its HQ and every
   Goliath (or an op's goal is met, or under Robot Love two enemy Goliaths
   meet). A side whose HQ falls while a Goliath stands plays on: it can
   still build near an anchored Goliath and in range of its surviving
   buildings, but never a new HQ. Pause any time. Calldowns charge from the
   first losses; in a skirmish, Uplinks are there to take from the start
   and the first supply drop lands at 1:30; at 6:00 the Sky Hammer comes
   online for both sides, so a stalemate can't last.
4. The deciding kill (an HQ, or a side's last Goliath) plays as a short
   cinematic (Robot Love: the two Goliaths falling in love), then the
   after-action report → Rematch (back to the cards) or Menu.

First-time players get contextual hints (command your opener units — or
build a Fab on a classic start — then counters, tech; the tech hint is
skipped, and the tutorial finished, when a Tech Lab already stands), plus
one-time hints for squads, touch placement, robot infantry, the Condor,
the Goliath and its lift, calldowns and salvage. They all go through one
queue (`game/hints.ts`, tested) so a new player is never handed several at
once: at most one every 12 s of play (paused time and the opener cards
don't count), what you're doing right now first (placing a building, a
group selected), then the tutorial, calldowns, salvage; nothing new starts
while a banner is up or waiting; a hint that no longer applies or has
waited 30 s is dropped. Each keeps its own once-per-device flag, written
only when it is actually shown, so a dropped hint comes back next time.
Measured on a fresh profile (first minutes of a Blitz skirmish, scripted
taps at wall-clock pace): the seven hints landed at 0:05 (send your units),
0:17 (squads, a group selected at 0:09), 0:31 (counters), 1:01 (placement,
the moment the Turret's ghost went down), 1:21 (salvage), 2:12 (calldowns) and
2:31 (Tech Lab) — gaps of 12–51 s, none during the opener cards or any of the
seven banners in that stretch.

### Veteran heroes, the finale and the after-action report

Presentation only — the sim just counts `Unit.kills` and faction stats.

- **Callsigns** (`game/heroes.ts`): every unit has one of 48 callsigns,
  chosen by a hash of its id, skipping names its side already used this
  match (then "Viper II"). Shown from rank 2: selection panel "★★ Viper ·
  Lancer · 9 kills", toasts, the report.
- **Promotions** (`game/hero-fx.ts`): a gold VETERAN / HARDENED / ELITE title
  rises over the unit (enemies' only from rank 2, at most 8 at once) and the
  new chevron pops; rank 3 units get a pulsing gold shimmer. Your unit
  reaching rank 2 gets a "earned a callsign" toast; rank 3 an announcement.
  Your named unit dying gives "✝ Viper (Lancer, 9 kills) destroyed" (one
  toast per tick; "… destroyed by an enemy Barrage" when one strike got
  them); a visible enemy ace (rank 3 or ≥ 3 kills) dying gives "🎯 Enemy
  ace … down" ("… down to your Sky Hammer").
- **Finale** (`game/finale.ts`): when the match is decided — an HQ falls,
  or a side's last Goliath (when both go on the deciding tick, the HQ is
  what decided it) — the render clocks (tweens, particles, tracers, model
  animation) drop to 0.3×, the camera glides and zooms onto the wreck or
  the toppling Goliath (centred in the area the dock leaves free), five
  staged blasts roll across it (smaller for a Goliath), then a white
  flash, a shake, the result banner ("Enemy HQ destroyed / Victory", "Our
  last Goliath has fallen / Defeat", a spectator's "Red Goliath destroyed /
  Blue wins") and the stinger at 1.5 s; time eases back and the report
  appears at 2.8 s. Input and pause are locked meanwhile; everything runs
  on the real frame delta.
- **Robot Love's finale** (`LOVE_FINALE`, and `render/goliath.ts` for the
  pair): no slow motion and no blasts. The camera pushes in close where
  the two Goliaths meet. They turn to face each other, walk to meet
  (stopping a little short of the point between them), pause shyly with a
  little dip, then reach out to each other, their eyes glowing pink and
  hearts bubbling up out of them. At 4.3 s a burst of hearts and a sweet
  chime where their hands meet; at 4.7 s the banner "💘 They fell in love /
  It's a draw" (spoken "They fell in love. It's a draw.") and the draw's
  own sting (see *Music & ambience*); the report at 7.8 s.
- **After-action report** (`ui/report.ts`, data from `game/chronicle.ts`,
  which samples both armies every 5 s with full information and logs every
  death; squads riding in a Condor still count toward their army, and can
  still be the MVP): an army-strength timeline (SVG, both sides, tap or drag for
  values) with numbered markers for up to three moments — *first blood*,
  the *biggest battle* (most deaths within 20 s and 10 tiles, with each
  side's losses and where), and the *turning point* (the lead passing to the
  other side and holding 30 s) or, if it never changed hands, when the
  winner *pulled ahead* (≥ 1.5× and 400 up to the end) — plus, when there
  were Goliaths, the match's first Goliath to walk off a Gantry, an HQ
  that fell while its side's Goliath fought on ("Your HQ fell; your
  Goliath fought on for 3:12", for an HQ that fell 5 s or more before the
  end), and Robot Love's ending as the last beat. Calldowns are named
  in them: "Your Barrage took out their Stinger", "At your base: you lost 6
  (4 to their Barrage), they lost 5", "Your army overtook theirs after your
  Sky Hammer" (a strike by the new leader that killed 2+ units or 400 scrap
  in the 20 s before). Then the MVP card (most kills, fallen or alive — a
  unit, never the HQ that calldown kills are credited to) and the enemy's
  ace; stats with correct kill counts, *Goliaths fielded* (when anyone
  fielded one), *Scrap salvaged*, *Calldowns* fired
  per side (`World.powers.fired`), plus any numeric stats other features
  add to `FactionStats` (with friendly labels); and one rule-picked tip (no
  anti-air vs an air force, harvesters lost, idle factories, banked scrap,
  an enemy Goliath met with at most two Rocket Squads, Wasps, Lancers or
  Hornets ("…bring one down; shoot its Menders first"),
  Mastodons unanswered (Rocket Squads count as an answer), 8+ enemy infantry
  squads against at most one Mortar, Hornet, Sniper Team or Turret, 6+ units
  lost to enemy calldowns, …). Calldown kills
  never count as "your defences" (tips, Iron Wall). Spectators get both
  MVPs and a one-line story per commander instead of a tip. Buttons stay
  pinned at the bottom of the scrolling panel; landscape uses two columns.
  `addReportSection()` lets later features add blocks (career medals).
  The Last Stand end screen shows the run's MVP card too. A Robot Love
  draw heads the report **DRAW** (styled as neither a win nor a loss, with
  "💘 They fell in love" by the match line), for the player and spectators
  alike.

### Last Stand (survival mode)

A second mode for short, replayable sessions: no enemy base or economy, just
endless themed waves against your base. The score is **waves survived**; the
best per map and difficulty is saved on the device and shown on the menu
(selector line and map-card badges) and on the end screen ("New record!").
It is a base to hold: the run ends when the HQ falls, even with a Goliath
standing (`tickSurvival`).

- **Waves** (`src/sim/modes/survival.ts`, a pure, seeded wave director called
  from `step()` only when `World.survival` is set): the first lands at 1:35
  (Easy 1:50, Hard 1:25), then one every 50 s (60 s after a boss). Each block
  of five plays four of the five regular themes in a seeded order —
  **Air Raid** (wasps, then hornets and raptors), **Armour Column**
  (stingers, lancers, mastodons), **Artillery** (mortars with escorts),
  **Mixed Assault** and **Bot Swarm** (robot infantry, below) — then a
  **Boss** wave (Mastodon Spearhead, Bomber Wing or Elite Strike Force, in a
  seeded order). *(Before robot infantry each block was a shuffle of all
  four themes.)* The theme that sits a block out is benched by seeded
  rules: every theme exactly once in each run of five blocks, never twice
  in a row; never the theme the block's own boss grows out of (so an
  Armour Column comes before a Mastodon Spearhead, an Air Raid before a Bomber
  Wing, a Mixed Assault before an Elite Strike Force); and never Air Raid or Bot
  Swarm in the first block, so the two threats that need their own
  counter arrive while they are small. Wave 1 is always a small ground wave
  (Armour Column, Mixed Assault or Bot Swarm).
- **Bot Swarm** (🤖, counter tip "Mortars, Turrets, Hornets, Sniper
  Teams"): Trooper Squads (weight 5) and Rocket Squads (weight 2), with
  Sniper Teams (weight 1) from wave 6, held to 15% of the budget and 15% of
  the wave's unit cap. It overruns the nearest structure, like an Armour
  Column, and stops growing at **30 squads** (`SURVIVAL.swarmMaxUnits`;
  other themes 36): cheap squads would reach 34–36 from wave 8 on Normal,
  and a wave bigger than the live cap below stands at its edge waiting for
  the units the cap holds back until the 50 s march timeout. The bosses
  bring infantry too: a few Rocket Squads walk with the Mastodon Spearhead,
  and the Elite Strike Force adds Troopers and Rocket Squads (each held to
  15%; measured, they change nothing).
- **Budgets** grow as (240 + 228·n^1.4) scrap × difficulty (0.7 / 1 / 1.3),
  boss waves ×1.1; units arrive at veterancy rank 1 from wave 6 and rank 2
  from wave 12, bosses one rank higher. They are ordinary units under the
  normal rules — no stat cheats.
- **Spawning**: waves enter from map-edge sites (corners and edge midpoints
  far from the HQ, each snapped to ground the HQ can be driven to from) picked
  per wave, never the same edge twice running. At most **30** wave units live
  at once (phone frame rate; a squad counts once, however many robots it
  draws); the rest queue off-map and stream in. Squads form up on ground
  they can walk; Troopers and Rocket Squads enter with the front line,
  Sniper Teams last.
- **Marching**: a wave moves as a formation — units more than 3 tiles ahead of
  its rear wait — until it is within 12 tiles of its objective, under fire,
  or 50 s old. Then each unit picks targets: air raids hunt harvesters,
  artillery shells turrets and SAMs, columns and bot swarms hit the nearest
  structure, mixed assaults go for production (Assembly Bays included),
  bosses go for the HQ. (Measured: strung-out waves were trivially farmed.)
  Once released, a wave's Sniper Teams drop a building for any defender
  ground unit they can see within sight + 2 tiles (squads first), and with
  nothing to shoot walk back to the nearest walking ally. A swarm's
  formation spreads 4–6 tiles, like a vehicle wave's; mid-size swarms are
  released in 22–45 s, big ones on Ashlands at the 50 s timeout, as Mastodon
  columns are.
- **Announcements**: the next wave's theme is in the top-bar pill from the
  start of its countdown ("Wave 8 · 0:42 / ✈ Air Raid"); 15 s ahead a banner
  names it, its edge and what beats it (so wave 1 says it too), the pill
  pulses red, a minimap arrow and an above-the-fog map marker point at the
  entry. Clearing the field pays
  60 × wave scrap ("Wave 7 cleared · +420") with a counter tip for the next
  theme, and brings the next wave within 30 s. With the field clear, the
  **Call wave** chip brings it now for (5 + n) scrap per second skipped.
- **AI**: a defending commander (spectator "Watch AI defend", and the tuning
  harness) never raids or assaults, adds turrets and SAMs to its build,
  holds a line toward the announced edge, engages wave units it can see near
  the base, and calls waves early when its army is ≥ 1.8× the next budget.
- **Salvage**: wave units leave wrecks worth just 5% of their cost
  (`SURVIVAL.waveWreckShare`, carried on the run's survival state, so
  skirmish wrecks keep their 30%; robot squads leave none, as everywhere);
  the defender's own losses salvage as
  usual. At 30% the waves were an economy: a defender salvaged 17–116k
  scrap a run, and the median run lasted 30 waves for the AI and 50 (the
  45-minute cap) for the scripted player.
- **Calldowns** stay the player's (the waves have none) and are worth
  about a wave: the scripted player below survives a median of 11 waves on
  Normal when it also fires Sky Hammers and Barrages at wave clumps near
  its base and a Drop Pod when outgunned, 10 without. The AI defender
  gets nothing measurable from its own (median 15 waves with or without;
  `--no-calldowns`), so they don't make the mode easier.
- **Tuning** (`npx vite-node tools/survival.ts both all all 4`): waves
  survived, median (min–max), over 5 maps; the AI defender is a Normal
  Balanced commander:

  | Defender | Easy | Normal | Hard |
  |---|---|---|---|
  | Scripted "decent phone player" | 14 (9–45) | **10 (8–15)** | 8 (7–11) |
  | Normal Balanced AI | 20 (14–41) | **15 (11–30)** | 15 (9–19) |
  | *Before robot infantry:* scripted | 15 (14–27) | 10 (8–15) | 8 (7–10) |
  | *Before robot infantry:* AI | 19 (14–30) | 15 (9–22) | 14 (9–29) |
  | *Before the wave-salvage fix (30% wrecks, n^1.3):* scripted / AI | | 50 (16–50) / 30 (14–51) | |
  | *After the review fixes (Normal only, `both all normal 4`):* scripted / AI | | **9 (9–25) / 17 (12–30)** | |

  The first two rows were measured with cannon at ×0.6 vs infantry.
  Re-run on the shipped code (cannon ×0.4, the review fixes in), the
  scripted player's median slips from 10 to 9 with its mean unchanged
  (10.7 → 10.8): the wave-10 boss ends 11 of its 20 runs, so the median
  sits right on that wall. The AI defender's rises from 15 to 17 (mean
  18.2 → 19.0).
  Nobody fell within the first three waves. Most Normal runs end at a
  boss (wave 10 or 15): the first boss is the wall a decent player learns
  to beat. Waves stop growing at 36 units (around wave 14 on Normal; a Bot
  Swarm at 30) and ranks top out at wave 12, so a defender that holds past
  ~20 can run long.

  The Bot Swarm on its own (same code with and without it, Normal, 12
  seeds, n = 60): the scripted player's median goes from 10 to 9 waves
  (mean 10.7 → 10.2) and the AI's from 18 to 16 (mean 18.9 → 18.0). The
  wave-10 boss is the wall either way: it ends 23 of 55 scripted runs
  without the swarm and 24 of 50 with it. Scrap the AI defender loses per
  wave puts the swarm mid-pack, so its pool weights were left alone: at
  waves 6–10 swarm 0.93k, armour 0.81k, mixed 0.84k, artillery 1.26k, air
  1.93k; at waves 11–15 1.94k against 1.85k / 2.35k / 2.08k / 4.41k. It is
  the gentlest theme at waves 1–5 (0.00–0.08k), so it is a safe opener; at
  waves 16–25 it ends a slightly larger share of AI runs (9 of 33 swarm
  waves) than armour or air.

  The edge stall stays for the other themes' late waves (about wave 13 on,
  Normal; from 10 on Hard), and the numbers above include it. Removing it
  for every theme made late waves much harder (the AI defender's Hard
  median fell from 15 to 10), so that waits for a rebalance; only the swarm
  is kept clear of it.

### Career, medals, mutators and the Daily Op

Reasons to come back between matches. Spectated games never count.

- **Medals** (`sim/awards.ts`, pure functions of an end-of-match recap built
  from the chronicle): ⚡ Lightning War (win < 5:00), 🛡️ Untouchable (win, no
  building lost), 🔄 Comeback (win after your army fell to ≤ ½ of theirs and
  800+ behind, after 1:30), 💎 Flawless (win losing ≤ 5 units), 💰 Tycoon (win
  harvesting 2× theirs), and — in defeat too — 🎖️ Ace (one unit, 9 kills),
  🗿 Giant Slayer (3 Mastodons), 🪨 Goliath Slayer (bring down one enemy
  Goliath: it takes a real army, or a clever drop), ✈️ Air Superiority (30
  aircraft), 🧱 Iron Wall
  (defences kill 30), ☠️ Exterminator (60 kills), 🏚 Wrecking Crew (12
  buildings); the battlefield's own feats, in defeat too — 🛰️ Orbital (one
  Sky Hammer destroys 1,000 scrap of units and buildings), ♻️ Scavenger
  (salvage 3,000 scrap from wrecks) and 💨 Steady Hands (dodge 3 enemy
  Barrages / Sky Hammers: at least 2 of your units under the reticle when it
  was called, nothing hit when it landed); Last Stand 🏰 Holdout (10 waves)
  and 🗼 Unbreakable (20). Thresholds were calibrated on 40 AI-vs-AI matches
  so a typical win earns one or two and the rest are goals. The chronicle
  records every calldown (`StrikeRec`: who, what, units exposed when called,
  hits and kills when it landed) for the battlefield medals, calibrated on
  120 more (60 to tune, 60 to check; % of sides): "any building" or "3 units"
  for one Sky Hammer were 44% and ~0% (its flat 700 flattens turrets and
  SAMs, while units get clear), so Orbital counts value — 22%; Scavenger at
  1,500 was 82% (AI sweeps; median 2,600–2,800 a side), at 3,000 42%;
  Steady Hands at 3 dodges 25–32%, with the AI's 0.6 s reflex. A human
  salvages and dodges by hand, so those two should land lower. Calldown
  kills no longer count toward Iron Wall. A Robot Love draw is no win, so
  it earns none of the victory medals, but the feats of arms count in it
  as they do in defeat.
- **Career** (`game/career.ts`, localStorage `battledrones.career`, pure math
  + try/catch storage): XP = win 100 / loss 30 (scaled down for losses under
  5:00) / a Robot Love draw 60 ("Draw · Normal": more than a loss, less
  than a win, and counted as neither in the W/L record) × difficulty
  (Easy 1, Normal 1.5, Hard 2.2), Last Stand 10 per wave × difficulty,
  +25 per medal, +100 for the day's first Daily Op win. Ten
  ranks — Cadet, Private, Corporal, Sergeant, Lieutenant, Captain, Major,
  Colonel, General, Marshal (100 … 6,000 XP) — with chevron / bar / star
  insignia. Three **stars** per map × difficulty: win, win under 8:00, win
  without losing a building (classic rules only). Wins/losses, medal counts,
  Last Stand totals (bests stay in `battledrones.laststand`) and the Daily
  streak. Banked once when the match is decided (`game/meta.ts
  settleCareer`).
- **Menu** (`ui/career.ts`): rank badge with XP bar under the logo (tap: the
  Career sheet — medals, star grid, Last Stand bests, rank ladder), the Daily
  Op card, a mutator picker, ☆☆☆ on each map card for the chosen difficulty.
  Landscape puts these in a column over the key art.
- **End screen**: a career block heads the after-action report (and the Last
  Stand screen): XP counts up and the bar fills, a promotion swaps the
  insignia with a PROMOTED ribbon and glow, medals pop in one by one (NEW on
  a first), new stars pop, the Daily streak shows. Spectators see each
  side's medals instead.
- **Mutators** (`sim/rules.ts`, `World.rules`, via `MatchOptions.mutators`;
  absent = classic, read through `rulesOf(w)`): ⚡ Blitz (3,000 starting
  scrap), 💰 Gold Rush (income ×1.5, multiplied on top of the AI's own
  `incomeMult`), 💥 Glass Cannons (damage ×2), 🔧 Rapid Fab (build progress ×2
  per tick), ✈️ Air War (no ground combat units — robot infantry and the
  Goliath included, though each side keeps its starting Trooper Squad —
  Condors to fly that squad into the fight, Fab Plants, Assembly Bays or
  SAM sites, and no Gantry, which builds nothing but Goliaths; measured:
  with SAMs every AI-vs-AI air war drew at 25:00), 🤖 Infantry War (robot
  infantry only: no combat vehicles (the Goliath, so the Gantry, among
  them), combat aircraft or Fab Plants; the
  Airpad stays for Condors, Scouts and Menders, Turrets and SAM sites stay,
  and Drop Pods carry 2 Trooper Squads + a Rocket Squad, 3 Rocket Squads
  with a Tech Lab; no opener survives it, so both sides start the classic
  way), 🪂 Airborne (a Condor, a Rocket Squad and a Sniper Team parked round
  each side's starting Trooper Squad, mirror-fair: one of each squad and a
  ride; `Rules.startUnits`, spawned by `createMapWorld`), 🎖️ Veterans
  (combat units roll out at rank 1, the starting squads too), ☀️ Clear
  Skies (no fog for either side; a Sniper Team in woods still hides), and
  the two Goliath mutators:
  - 🦿 **Nomads** ("Each side starts with a Goliath instead of a base";
    `Rules.nomads`, `nomadStart`): in a skirmish each side's HQ is replaced
    by a Goliath standing anchored where it stood; the starting Harvester
    and Trooper Squad stay. The base walks: anchored Goliaths also build
    Harvesters (`trainableAt`), and with no HQ to count as base every
    building goes up as an outpost in a Goliath's ring, the opener's
    factory included (the openers set up round the Goliath). There is no
    HQ trickle (the anchored Goliath's own, half an Uplink's, stands in),
    calldowns work with a Goliath and no HQ, the camera opens
    on the Goliath, and a side is beaten when its last Goliath falls. On
    the Archipelago `Rules.homeTiles` still marks each side's home land.
  - 💘 **Robot Love** ("Two enemy Goliaths that meet fall in love, and the
    battle ends in a draw"; `Rules.robotLove`, `tickLove`): the first tick
    a blue and a red Goliath stand within 5 tiles of each other, centre to
    centre (`GOLIATH.love.range`; the closest pair if there are several),
    the match ends there and then in a draw: `World.winner` is `"draw"`
    and `World.love` records who and where, for the presentation's love
    scene (see *Robot Love's finale* above). It runs after the tick's
    deaths, so a side beaten on that same tick stays beaten. A draw is a
    **DRAW** in the report, has its own sting and radio line, is neither a
    win nor a loss in the career (see *Career*), and ends a battle record
    (`AGENT-BATTLES.md`) with `{ winner: null, reason: "love" }`.
  - 🚁 **Goliath Armada** ("Each side starts with four Goliaths in the air,
    two Condors carrying each, and nothing else"; `Rules.armada`,
    `lift.ts armadaStart`): in a skirmish each side's HQ, Harvester and
    Trooper Squad are cleared, and four Goliaths hang on the corners of a
    square round where the HQ stood (`GOLIATH.armada.gap` either way of
    its centre, in the side's own frame: mirror-fair), facing the map
    centre, each already carried by two Condors (`GoliathLift` phase
    `"carrying"`). No map start units, and no opener (`openerBlocked`:
    "Disabled: Goliath Armada", so the player starts at once). As under
    Nomads (`goliathBase`), anchored Goliaths also build Harvesters, every
    building is an outpost and a side is beaten when its last Goliath
    falls. The AI (`ai/goliath.ts liftStep`: a carried Goliath with no
    site picks one before setting down) flies each to its own dig-in
    site, clear of the sites the others took, and sets it down there;
    with none worth it, it comes down where it hangs.

  Air War conflicts with both infantry mutators (it bans their units), and
  Air War and Infantry War each conflict with Nomads, Robot Love and
  Goliath Armada (they ban the Goliath; Armada also conflicts with Nomads
  and Airborne, which start a side another way): the picker switches the
  other off (`toggleMutator`),
  and `makeRules` keeps the first of a conflicting pair. Skirmish only;
  both sides obey them
  (`unitBlocker`/`buildingBlocker` say "Disabled: Air War", the HUD shows
  ⛔). The AI picks a personality whose plan survives the rules
  (`strategyFits`: no Rush/Ironclad in Air War; no Skyforce/Ironclad in
  Infantry War, where Ironclad playing from Bays won 20% of 100 AI-vs-AI
  games) and, in Air War, plays the air-only plan with more bombers and
  one big wave. In Infantry War (`infantryArmy`) it builds an Assembly Bay
  wherever its plan says Fab Plant (and for its extra production), keeps
  its whole army in infantry, adds a Rocket Squad per enemy turret or SAM it
  knows (up to 6) and up to 5 Snipers. Under Infantry War or Airborne every
  Normal/Hard personality flies Condor drops (not just Rush and Balanced);
  under Airborne the first may board at 1:00 (`CONDOR_AI.airborneFrom`),
  while the starting squads still wait at home (the Sniper stays behind),
  and every personality adds an Assembly Bay fourth in its build and keeps
  at least a quarter of its army's value in squads, so the free Condor has
  someone to fly (`flysGivenCondor`; Air Swarm, Boom and Skyforce otherwise
  raised none, and their Condors sat at home all match).
  Shown in an opening banner, the pause screen and the end screen.
- **Daily Op** (`game/daily.ts`): the local date hashes into a map, an AI
  personality, Normal or Hard, two compatible mutators and the match seed —
  the same match for everyone. The mutators come from a frozen list of the
  nine older ones (`DAILY_MUTATORS`, like the frozen map list), so adding
  a mutator never changes a day's op; Nomads, Robot Love and Goliath
  Armada stay menu picks. Its own rematch, +100 XP for the first win of
  the day, and a win streak that survives until a whole day passes without
  a win. No stars (it is always mutated).
- AI-vs-AI sanity (50 matches each, 25:00 cap): classic 48/50 decisive,
  median 5.6 min; Blitz 47, Gold Rush 46, Glass Cannons 43, Rapid Fab 48
  (median 4.2), Veterans 46, Clear Skies 47; Air War 13/20. The next 21
  Daily Ops all finished (median 4.7 min). The infantry mutators, measured
  later (Normal, no openers, every map pairing of the personalities that
  fit): Infantry War 56/60 decisive over all five maps, median 16.2 min,
  personalities 37–60% — infantry against Turrets and freshly built
  defenders grinds, so it plays about 2.5× as long as a classic match on
  the same harness (median 6.6 on Riverlands); Airborne 85/90 on Riverlands,
  Ashlands and Frostbite, median 12.4 min (classic 59/60 on the first two,
  median 8.6), personalities 37–70%.

### Ops (a short scenario campaign)

Eight handcrafted 3–7 minute missions on the existing maps and units, each
with a twist objective and three stars: ★ complete it, ★★ and ★★★ two harder
conditions. They teach the counter web through play and give the game a
completion goal.

- **Data, not code paths** (`sim/ops.ts`): an `OpDef` is a map, an enemy (an
  AI commander with a fixed personality and difficulty, optionally tweaked —
  e.g. one that never attacks — the Last Stand wave director, or nobody),
  rules (per-side bans, a frozen economy, mutators: `World.rules` gained
  `sideBans`, `sideIncome` and `banLabel`, so `unitBlocker`/`buildingBlocker`
  say "Disabled in this op" and bind the AI on its side too), a `setup` that
  pre-places buildings and units and tags what must be protected, primary
  goals and two star conditions. `createMapWorld(map, { op })` builds it.
- **Goals** are pure functions of the world, checked once a second by
  `tickOps()` (called from `step()` only when `World.ops` is set): destroy the
  HQ, destroy N of a kind, survive N seconds, survive N waves, deliver N
  scrap, protect a tagged group (or ≥ N of a kind), within N seconds, lose at
  most N units / of a kind / buildings. Meeting every achievement goal wins;
  breaking a condition (time, protected group, losses) loses; an HQ kill still
  ends it the classic way. An op is a base to hold: our HQ falling loses
  it even with a Goliath standing ("Our HQ has fallen"), and one won on the
  enemy's last Goliath, its HQ already gone, says "Enemy Goliath
  destroyed". The result sets `World.winner`, so the finale
  (without HQ blasts when no HQ died), report and career run unchanged.
- **The ops** (verified by `tests/ops.test.ts`: each sets up on legal ground,
  runs, is completed with ★★+ by at least one stand-in pilot — an AI
  commander or a scripted player from `tests/ops-pilots.ts` — and is *lost*
  by doing nothing; `npx vite-node tools/ops.ts` prints the numbers):

| # | Op | Map | Enemy | Objective | ★★ / ★★★ |
|---|---|---|---|---|---|
| 1 | 🌉 Bridgehead | Riverlands | Rush, Hard, bigger waves, 4 harvesters | Hold 4:00 with a bridge turret standing (forward outpost pre-placed) | lose ≤ 6 · both turrets |
| 2 | 🌙 Harvest Moon | Dune Sea | Air Swarm, Hard, early Wasps | Deliver 10,000 scrap by 5:00 | ≤ 1 harvester lost · by 4:00 |
| 3 | 🎯 Decapitation | Proving Grounds | Balanced, Easy, never attacks | Strike group, no production, no calldowns: HQ by 3:00 | lose ≤ 4 · under 2:00 |
| 4 | ❄ Frozen Assets | Frostbite | Boom, Normal | 3,000 scrap, no income (not even salvage) or harvesters, no calldowns: HQ by 6:00 | 4 harvesters killed · under 4:00 |
| 5 | 🏴‍☠️ Sky Pirates | Ashlands | Balanced, Easy, digs in on half income | No Fab Plants, Assembly Bays, ground units or Condors (air only; the Drop Pod lands Wasps; the starting squad is kept, with no Condor to fly it), pre-placed SAMs: HQ by 7:00 | lose ≤ 12 · under 4:30 |
| 6 | 💥 Glass Jaw | Dune Sea | Rush, Normal, 4 harvesters | Glass Cannons + Rapid Fab: HQ by 6:00 | lose no building · under 4:00 |
| 7 | 🛡 Iron Tide | Frostbite | Ironclad, Hard | Hold 6:00 (Fab Plant + Tech Lab given) | 2 Mastodons killed · ≤ 1 building lost |
| 8 | 🕯 Last Light | Riverlands | Last Stand waves (Easy budgets, first at 0:45, every 40 s) | Survive 10 waves from a dug-in base | ≤ 2 buildings lost · under 7:00 |

- **Measured** (stand-in pilots, `npx vite-node tools/ops.ts all 6`, after
  the final balance pass): idle play loses every op; the scripted pilots
  clear seven of the eight on every seed (Bridgehead ★★ at 4:00, Harvest
  Moon ★★ ~4:10, Decapitation ★★ 1:17, Frozen Assets ★★ 1:40, Sky Pirates
  ★★ 2:52, Iron Tide ★★★ in 5 of 6, Last Light ★–★★ ~7:40) and Glass Jaw
  ★★★ ~2:55 in 4 of 6 (Glass Cannons makes it swingy: 5 of 6 before the
  pass). A stock Balanced AI commander clears six of the eight at least
  once (Last Light every time, ★★) — it leaves the bridge to attack in
  Bridgehead and wastes its fixed budget in Frozen Assets. These numbers
  predate robot infantry; `tests/ops.test.ts` still passes with it in.
  Two Rush ops pin the enemy to the 4 harvesters they were tuned against
  (skirmish Rush now keeps 5; with 5, the scripted general lost Glass Jaw
  on seed 1), and the Frozen Assets pilot picks its build mix by counting
  only its vehicles, so the starting squad doesn't tip it into Raptors.
- **Campaign**: the first three ops are open; every op completed opens one
  more. Progress (best star mask, best time, attempts) lives in the career
  (`CareerData.ops`); XP: 60 per clear, +100 the first time, +40 per new star,
  a little for a failure. Ops award no medals, map stars or skirmish W/L.
- **Menu** (`ui/ops.ts`): a third mode, 🎖 Ops: progress line, op cards in
  the map-card style (number, icon, stars or 🔒), the picked op's tagline and
  enemy; tapping the picked card or Play opens the briefing sheet (brief,
  rules, objective, star conditions with your best, a tip, Start op; two
  columns in landscape).
- **In match**: a briefing banner (`op-start`); a goal pill under the clock
  in portrait (top-left corner under the pause button in landscape, where the
  top bar is a full row): the objective and its clock, the other conditions,
  and three live stars (gold while the condition holds, struck out when
  lost). Tapping it opens the objectives card. "★★ lost" / "★★★ secured"
  toasts, a one-minute call-out (`op-timer`), the camera opens on the action
  (`OpDef.focus`). No tutorial hints in ops. The pause screen lists the goals.
- **End screen**: "OP COMPLETE" / "OP FAILED" heads the after-action report,
  with the reason, big stars (new ones pop), the star conditions, your best,
  "New op unlocked", the op's tip after a failure, and Next op / Retry / Main
  menu. Rematch tokens are `op:<id>`.

## Controls & UI (mobile-first, full-screen)

### Full-screen behavior

The game owns the entire screen — no page chrome, no scrolling, no
accidental browser gestures:

- **Installed as PWA:** `display: "fullscreen"` in the manifest.
- **In-browser play:** the Play tap requests the Fullscreen API where
  available (Android); on iOS Safari we rely on `100dvh` layout.
- **Viewport hygiene:** `100dvh`/`100dvw` sizing, `viewport-fit=cover` +
  `env(safe-area-inset-*)` padding, `touch-action: none`,
  `overscroll-behavior: none`, `user-select: none`, context-menu and iOS
  gesture/page-zoom suppression (with a rescue button if iOS zooms anyway).
- **Hi-DPI:** the canvas renders at the device pixel ratio (capped at 2×)
  and is CSS-scaled down, so painted art is crisp on phones.

### Touch gesture spec

| Gesture | On | Action |
|---|---|---|
| Tap | Own unit | Select it |
| Tap | Own Condor, infantry squads selected | Board it (as many as it has seats, nearest first) |
| Tap | Own infantry squad, Condors selected | Board the nearest selected Condor with a seat |
| Tap | Own walking Goliath, two empty Condors selected | Hook the two nearest on to lift it (the selection becomes the lift) |
| Tap | Own building | Select it (production queue, sell, rally) |
| Tap | Enemy / ground / scrap | With selection: attack / attack-move / harvest |
| Tap | Ground, building selected | Set rally point |
| Tap | Ground, only an anchored Goliath selected | Set the rally point for the squads it trains (it stays dug in) |
| Tap | Ground, a lift selected | Fly the Goliath there and hover |
| Double-tap | Own unit | Select all on-screen units of that type |
| Drag (one finger) | Anywhere | Pan (with momentum) |
| Long-press then drag | Anywhere | Box-select (prefers combat units over harvesters) |
| Long-press, released without dragging | Map, loaded Condors selected | Fly there and drop the squads (the rest of the selection heads there too); with a calldown armed, fire it there instead |
| Long-press, released without dragging | Map, a lift selected | Fly there and set the Goliath down (on the nearest ground it can stand on) |
| Two-finger drag / pinch | Anywhere | Pan / zoom |
| Tap / drag | Minimap | Jump / scrub the camera |
| Long-press | Build button | Info card: stats, counters, cancel queued |
| Tap | Map, while placing | Move the ghost there (no build yet) |
| Tap / drag | The ghost | Build it / slide it |
| Long-press / tap / double-tap | Squad chip 1–3 | Save the selection / select the squad / fly the camera there |

Disambiguation: a touch is a *tap* if it moves < 8 px and lasts < 250 ms;
movement beyond the slop radius before the long-press timer fires commits
to *pan*; after the timer fires it commits to *box-select*. A box
released within the tap slop of where it began is a plain long-press: with
loaded Condors (or a lift) selected it orders the drop there, otherwise it
box-selects as usual; a box cut short by a second finger or a pointercancel is not a
release and does neither. Hit-testing
uses an enlarged (≥ 24 CSS px) radius, and aircraft are tested where they
are drawn (lifted above their shadows).

Context **chips** above the build bar, after the three squad chips: Stop /
Move only / deselect for units, plus **⇣ Unload N** while loaded Condors
are selected (**⇣ Set down** for a lift in the air), and with a Goliath
selected **⚓ Anchor** (or "⚠ …", why it can't here), **⇡ Pack up**, or
its progress while it digs in or packs up ("⚓ 40%" on a narrow phone)
(Stop shrinks to ■ on narrow screens to make room, and there an Unload or
anchor chip takes Move only's place; a selection of only Condors, lifts
or anchored Goliaths has no Move only, since it has no fights to skip);
Sell (+refund) for buildings (producers
show "Tap the map to set a rally point" in the selection panel instead of a
chip); "Select army" and "💤 Idle N" when nothing is selected (both
leave out harvesters and the unarmed Condor, which would outrun the army
and park alone in the enemy base, and anchored Goliaths, which stay put);
"✓ Place X" (or why not) + cancel while placing. Under 400 px wide the
labels shorten ("Move", "Army") so everything stays on one row down to
360 px.

### Mouse & keyboard

Left-click select (Shift+click adds or removes a unit), left-drag
box-select (Shift+drag adds the box to the selection), right-click
command, wheel zoom,
middle-drag or arrows/WASD pan, +/− zoom, P or Space pause, Q select army,
Delete sell, Esc cancel/deselect, `.` game speed, J jump to the action,
C cinematic camera (AI vs AI),
1–3 select a squad (twice quickly: fly there), Ctrl/Cmd/Shift+1–3 save
one (Shift for browsers that keep Ctrl+digit for tabs). While placing, the
ghost follows the mouse, a click builds and a right-click cancels. Hold
the clock to fast-forward. Right-click a build button for its card, or a
squad chip to save into it. Right-click your own Condor with infantry
selected (or one of your squads with Condors selected) to load them; U
unloads the selected Condors where they are. G anchors the selected
Goliaths, or packs them up; right-click your own walking Goliath with
two empty Condors selected to lift it, and U sets a lift down where it
hovers.

### HUD layout — portrait and landscape both first-class

DOM overlaid on the canvas, re-flowing by orientation:

- **Portrait:** a bottom dock — selection panel and chips above a tabbed
  build bar (Base / Vehicles / Infantry / Aircraft) with unit portraits,
  costs, lock icons, queue badges and progress fills. Minimap top-right;
  scrap, income rate and clock top-left. The selection panel shows a
  squad's robots still standing ("110 / 190 · 3/5 robots") and a Condor's
  seats: a portrait per squad aboard with its robots, dashed empty seats.
- **Goliath and Gantry:** the Gantry sits at the end of the Base tab and
  the Goliath on Vehicles, its button showing today's price ("Gantry
  busy" while one is on the cradle). The Goliath's card has a table of its
  four weapon systems (range, "offline below 75%", "air too"), "+25% for
  each Goliath you have" and "Repair: Menders only"; the Gantry's ticks off
  its four prerequisites as they stand and says "One per side". A
  selected Goliath's panel (also an enemy's, for information) shows its
  name, HP and mode ("Walking", "⚓ Anchoring 40%", "⚓ Anchored", "⇡
  Packing up 60%", "⇡ On a lift"; on one line on short landscape screens),
  a strip of its four systems — Mortars, Laser, Cannons, MG — each green
  while firing, dim while held on a lift, pulsing amber through a reboot
  and struck through in red when offline, and, ours anchored, its training
  queue (cancel buttons) or
  "Trains squads · tap the map to rally" ("Trains Harvesters and squads"
  under Nomads). Selecting an anchored Goliath opens the Infantry tab,
  whose buttons queue on it first (else on the shortest queue, Bays and
  Goliaths alike), and its queue badges count Goliaths' queues with the
  Bays'. A Condor on a lift shows the Goliath as its cargo ("Carrying a
  Goliath · Long-press the map to set it down"). An outpost's panel says
  "· Outpost" after its name and "Outpost: doesn't extend build range".
  On the map, a training bar sits under our anchored Goliaths, and a red
  progress bar under an enemy Gantry (its build is public).
- **Landscape:** the build bar becomes a right-edge sidebar with a 2-column
  grid; selection panel and chips sit bottom-right beside it.
- **The top band** grows by mode: pause + mute, the top bar (scrap; clock +
  speed chip; Last Stand's wave pill; an op's goal pill — in landscape the
  op pill takes the corner under the pause button; the spectator's
  two-line "● Blue · opener / ● Red · opener" pill), the battle meter's
  slot under it, and the minimap. `ui/layout.ts` measures what it really
  occupies on every layout change and places what sits below it: the
  **ticker** under the band in its column (the meter's slot is always
  reserved, so the ticker doesn't jump when a fight starts), and the
  **banner** centred over the battlefield (on the top bar's axis in
  landscape) under the band across its width, never wider than the gap to
  the landscape minimap. Portrait keeps one ticker line's slot between the
  two, so neither moves; landscape has no height to spare, so the banner
  sits right under the top bar and the ticker's newest line steps down
  under it (one text line) while it shows.
- **Objectives pill** beside the clock: a 📡 pip per Uplink in its
  holder's colour (yours nearest first; pulsing while it's being taken)
  and the 📦 drop timer (next drop, gold while one is inbound, then how
  long landed crates have left).
- **Calldown buttons:** the ⚡ meter and four round power buttons on the
  right edge in portrait, centred but kept under the banner's slot and
  above the chip row (the selection panel stays left of them); on
  landscape phones a 2×2 block under the minimap beside the sidebar, with
  the meter beside it so the block clears the selection panel. Edge arrows
  slide past them; spectators don't get them, and a match whose rules ban
  every Drop Pod crew has no Drop Pod button.
- **Zoom stack** (＋, −, 🎥 cinematic camera in AI vs AI, ⚡ jump to the action): left edge in portrait, the
  bottom-left corner in landscape (leaving the left column to the ticker).
- A ticker of short toasts for "building ready", attacks (tap to jump
  there) and hints; minimap pings where you're being hit (amber double
  rings for an inbound raid). The clock row carries the game-speed chip, a
  battle meter hangs under it during on-screen fights, edge arrows point at
  off-screen fights, and ⚡ jumps to the action. The scrap pill bumps when a
  harvester delivers and flashes red when scrap is spent. Touch targets are
  at least 40 CSS px (slim pills and tabs get a bigger invisible hit area).
- **Sound:** the top-left speaker (in game and on the menu) is a one-tap
  master mute. The pause menu has four toggles, persisted in
  `localStorage` (`battledrones.audio`): Sound (master), Music (score and
  ambience), Effects, and Voice. Voice cycles through Voice (announcer
  speech and unit chirps), Chirps (no speech: unit chirps and radio codes)
  and off, and plays a "radio check" sample.

### Minimap

Painted-map thumbnail under the fog, resource fields, salvageable wrecks
(gold dots), buildings and unit blips (fog-respecting; no blip for a
Sniper Team hidden in woods), Uplink diamonds in
their holder's colour and blinking supply crates (public), calldown reticles
(red = enemy, gold = yours, shown through the fog), attack pings and the
camera frame. Goliaths are big outlined diamonds drawn over the unit
blips (pale blue ours, red theirs), an anchored one ringed by its build
ring; an enemy Goliath and an enemy Gantry show through the fog.

## Art

See **ART.md** for the generation pipeline (prompts, processing, terrain
painting). Summary: the terrain materials, decorations, the key art and the
app icon were generated with OpenAI's `gpt-image-2.5-sunburst`; the
battlefield itself is 3D (below). The HUD portraits are shots of the
in-game 3D models (ICONS.md): `tools/model-portraits.mjs` shoots each from
the model gallery's `?icon=` view on black and on white (the pair gives the
alpha), in a ¾ view (a squad as one of its robots), finished with lifted
colour and a light rim for the dark HUD, blue and red.

## 3D view

The battle is drawn with three.js (`src/game/three/`, wired up by
`game/GameScene.ts`). World units are tiles: x east, z south (the sim's y),
y up.

- **Camera** (`three/camera.ts`): a perspective rig looking north and down
  at a ground point. Zoom is CSS px per tile at that point (18–110); the
  pitch eases from 62° zoomed out (a strategic, near top-down read) to 47°
  close in. Pan keeps the ground under the finger, pinch/wheel zoom keeps
  the point under the anchor, and every screen↔ground conversion (taps,
  edge arrows, the minimap's view trapezoid, earshot) goes through it.
  Shake is an offset in the camera plane.
- **Terrain** (`three/terrain.ts`, with `terrain-glsl.ts`, `terrain-props.ts`,
  `terrain-tex.ts` and `terrain-bridges.ts`): the map grid becomes a
  heightfield (3 samples per tile): each terrain type has a base height
  (rock +0.95, water and lava −0.55, fords −0.2) blended over about a tile,
  plus terrain-weighted fractal noise (craggy rock, lumpy rough ground). The
  painted terrain chunks are draped over it as the albedo, so the painted
  hillshade and the real lighting agree; a cheap unsharp mask and a fine
  grain embossed from the north-west keep the 48 px-per-tile paint crisp
  close in. The outcrops' steep **cliff walls** don't show the drape (it
  smears down a wall): the ground shader fades there to the biome's own
  painted rock material — granite, red sandstone, basalt with snow, obsidian
  (`public/assets/textures/rock-<biome>.webp`) — projected sideways in world
  space so desert strata run level, tinted per tile from the paint above
  and darkened toward the foot. Flat tops keep the paint. **Crags** on the
  outcrops (one merged mesh) are textured with the same stone, triplanar per
  facet, over their painted-rock tint, in a matte stone material; Frostbite's
  get frosted caps. Without the texture everything falls back to the
  untextured look. On top: a water/ice/lava surface whose opacity and colour
  come from the depth under it — water with soft sun glints and lapping
  foam; Frostbite's frozen sea an ice shelf over the fords breaking into
  drifting, cracked floes; Ashlands' lava a molten flow with yellow-hot
  veins under drifting crust plates that glow at their rims. The
  Archipelago's open sea sits deeper than any river (TILE_H −1.3), and past
  depth 0.5 the water shader mixes in the biome's **abyss** colour with a
  line of **reef-crest surf** where the lagoon shelf drops away, so every
  island sits in a ring of turquoise inside dark sapphire; there the skirt
  past the map's edge eases into open sea instead of land
  (`BiomeLook.farSea`). Tropical trees are leaning coconut palms, umbrella
  rainforest emergents, mangroves on stilt roots and banana clumps; its pale
  limestone crags wear caps of jungle. Each bridge is
  one deck laid along its crossing (timber planks, kerbs and rails;
  riveted steel with a truss on Ashlands) on piers and abutments. Instanced
  trees per biome, salvage heaps of hull plates, girders and drums, and
  crystal clusters (instance matrices shrink as they're mined). Woods thin
  around squads on show (`three/canopy.ts`): a tree whose canopy covers a
  shown squad, around it or between it and the camera, dissolves down to a
  trunk stump (cleared in 90 ms, regrown in 260 ms), so robots and their
  selection rings stay readable in cover; a hidden Sniper Team or a fogged
  squad never thins a tree, so the trees give nothing away. **Past the
  map's edge** the land carries on for 20 tiles as a skirt: the paint
  mirrored, dimmed and greyed at the boundary so the playable area reads,
  easing into the biome's open ground and then into the sky colour, so the
  world never ends in a void. Its fog lookup mirrors back into the map, so
  it never shows more than the map tile it reflects. Units ride the surface:
  ground vehicles pitch and roll with the slope, fords sink them a little,
  hover tanks ride over water.
- **Models** (`three/models.ts`, `three/builder.ts`): every unit, building
  and objective is built from primitives in code, merged into one
  vertex-coloured geometry per moving part (hull, turret/head, rotor,
  cargo) so a vehicle is a couple of draw calls. Units face −Z and are
  scaled to the sizes the painted sprites had (×1.12 for 3D readability).
  A per-vertex glow weight lights lamps, engines and crystals. The builder
  can bake shading into the vertex colours (each part darker toward its
  base, ground models darker near the ground) and has chamfered `block` /
  `drum` primitives whose lightened top bevel is the painted art's edge
  highlight. Every unit carries a solid team patch on top (turret roof,
  fenders, rotor ducts, wing bands) so red vs blue reads at phone zoom; the
  HQ's command cab, team bands and tower caps make it the base's
  centrepiece; rubble is a cracked, scorched foundation with wall stubs and
  bent girders. The **Assembly Bay** is an open assembly floor under a
  team gantry whose welding arms reach down to a half-built robot on its
  cradle, a hazard-edged belt carrying spare legs and an arm, finished
  Troopers charging in amber-lit alcoves along the parts hall behind, and
  a roll-out pad on the apron. A tapered, chamfered `fuselage` primitive
  builds the Condor's hull.
- **Robot infantry** (`three/infantry.ts`): small articulated bipeds in
  the vehicles' style — gunmetal limbs, chunky team shoulder pads and back
  plates that read from the tilted camera, amber visors (the Sniper's
  hooded cloak carries a big team mantle and crest) — drawn about 1.4× their
  modelled size and standing in a loose formation that turns with the
  unit. Each squad is one rigidly skinned mesh (one draw call) whose joints
  the rig poses every frame: a run whose feet stay planted while the body
  passes over them (two-bone leg IK; measured foot slide during contact
  0.000, cadence from each robot's own size and speed), an idle sway and
  head scan, a raise-and-aim firing pose with recoil, a topple outward,
  clear of the robots still standing, each time the squad's HP drops one, a
  step sideways out of any ground vehicle's hull (so a Mastodon grinding
  through a squad parts it, throwing sparks and scrap), hops into and out of a
  Condor, and a seated pose in its bay. A volley leaves every standing
  robot's own muzzle a beat apart: a crackle of rifle tracers, a ripple of
  shoulder rockets with backblast, or one white-hot rail streak with a
  glowing wake and a crack.
- **The Condor** (`three/models.ts`, `render/entities.ts`): a ducted-fan
  dropship about a Mastodon's length but much slimmer (the Hornet's size, 1.5):
  an armoured nose tapering to a point under an amber canopy, an
  open-roofed troop bay amidships with benches and team rims (you can see
  who's riding in your own: riders sit at 40% scale so two whole squads fit;
  an enemy Condor's bay looks empty, under Clear Skies too, so its cargo
  stays secret until the squads step off the ramp; a spectator sees every
  rider), short
  wings out to two lift fans, and a tail boom to a V-tail over a rear ramp.
  To drop, it descends to a hover high enough for its belly to clear the
  robots, opens the ramp, lights a warm floodlight pool on the ground under
  it and blows up downwash dust; the riders stand and turn to face the
  ramp, step off its lip and grow to full size as they jump, and it stays
  low with the ramp down a moment before it lifts. Boarding squads hop up
  into the ramp. (The fans don't yet tilt between flight and hover; the
  body pitches nose-down at speed.)
- **The Goliath** (`three/goliath.ts` builds and poses it,
  `render/goliath.ts` drives it from the sim; screenshots in
  `progress-shots/goliath/`): a two-legged mech in the vehicles' painted
  style, half again as tall as an HQ — gunmetal armour on dark joints, big
  team-colour pauldrons, shoulder mortar pods and a deck plate that read
  from the tilted camera, one amber cyclops eye (the laser), an arm cannon
  on each forearm, twin machine guns under the chest, and on its back a
  scrap hopper and a folding crane, with four stabiliser spikes hanging at
  its hips. Its joints are a plain scene graph posed each frame (a few
  draw calls each, no skinning): a heavy walk on planted feet (the
  infantry's two-bone leg IK) with dust at every footfall, a torso that
  twists to its target, each weapon kicking from its own muzzle. Anchoring,
  it sinks on its hydraulics, splays its legs and drives its spikes in
  (dust, a thump, a small camera shake), then unfolds the hopper and crane
  while its build ring pulses out in team colour; packing up runs it in
  reverse, with steam. Damage shows per weapon — a burning, smoking
  shoulder with the mortars down, a dark eye with the laser down, cannons
  hanging limp — and a reboot relights the eye in flickers and cycles the
  mortar tubes. Lifted, it hangs on four cables between its two Condors,
  legs dangling. Destroyed, its reactor blows, it staggers, topples and
  slams down in a cloud of dust and shards (flinging out its scrap piles),
  smoulders and sinks away. Under Robot Love its eye glows pink and hearts
  bubble up out of it. A Goliath, its Gantry and the mech on the cradle use
  fog-free twins of the model material, so the enemy sees them in full
  colour through any fog (`clearOfFog`).
- **The Gantry** (`three/models.ts`, staged by `GANTRY_STAGES`): a 3×3
  assembly pad open front and back, a cradle between two lattice scaffold
  towers whose welding arms reach in over it, a luffing crane, floor
  lights down the cradle and armour plates racked on the apron. Its build
  shows in six stages, to both sides: **empty** (bare scaffold, crane
  folded, lights off); **foundation**, 0–25% (legs bolted to the cradle
  under welding sparks, the crane starting work); **frame**, 25–50% (hips
  and torso skeleton, the crane lowering armour plates in); **armament**,
  50–75% (torso plated, cannons and mortars on); **finishing**, 75–99%
  (head on, eye still dark, team panels on, steam venting, beacons
  blinking); and **rollout**, where the eye lights, the scaffold arms
  swing clear and the Goliath walks off the cradle before they swing back
  and the Gantry is empty again. The half-built mech at each stage is the
  same parts the finished Goliath walks off with (`bake()`). The model
  gallery lines them up: `tools/models.html?only=goliath` (walking,
  standing, digging in, anchored, every weapon down, rebooting, lifted,
  toppled, in love) and `?only=gantry` (the six stages per side).
- **Materials** (`three/materials.ts`): one shared, flat-shaded model
  material with uniform variants — hit flash (warm light over the shaded
  model, barely bleaching the paint), building hit (fire light), damaged
  (greyed, sooty), burnt wreck (neutral charcoal, matte), elite (a gold edge
  light and a glint sweeping over the hull), and green/red placement ghosts
  — that share one shader program, so swapping is free. Walls darken near
  the ground (contact shading), with or without shadows. Every lit material
  is patched to sample the **fog of war** texture (a texel per tile, blurred
  on the CPU, smoothed in the shader) by world position: unexplored ground
  is an opaque, biome-tinted **shroud** with slow wisps (from the cloud
  texture, looked up where the view ray meets the ground, so nothing under
  the shroud shows a silhouette) and a faint mist band at its edge;
  explored ground is a greyed **memory** of the terrain. At every fog level
  the ground shows through no more than under a plain half-darkening. The
  ground also takes the drifting **cloud shadows**, tinted per biome.
- **Effects** (`three/particles.ts`, `render/fx.ts`): two instanced quad
  pools (additive light, alpha-blended matter) plus a ground pool for flat
  marks, drawing from a 4×4 procedural atlas (ragged flame, sun-lit smoke
  puffs, shock ring, muzzle burst, shards, a soft scorch) built once per
  session. Explosions are layered — a hot flash, a ragged fireball cooling
  from yellow to red, sun-lit smoke that outlives the fire, embers, a shock
  ring, kicked-up dust and a scorch (none on water or lava); buildings add a
  blast front and a smoke pillar. Muzzle bursts, gun smoke and back-blast,
  tracers held to a minimum screen size, trails laid by distance flown,
  beams with a white core in a coloured sheath, wrecks that smoulder with
  oily smoke leaning downwind, and damaged buildings that smoke (and below
  25% burn) from their real roof. Particle records are recycled; per-frame
  paths don't allocate.
- **Ground marks** (`three/ground-gfx.ts`): an immediate-mode API in the
  shape of Phaser's Graphics (rings, arcs, lines, discs, rectangles) that
  drapes thick lines over the terrain with widths in CSS px — selection and
  combat rings, order lines, reticles, capture rings, the build zone. Lines
  are indexed, mitred polylines with a feathered edge and a soft dark halo
  (weaker for fainter strokes; `halo` 0 turns it off), so marks read on
  snow, sand and lava alike. The hierarchy is selection (2.5 px, opaque,
  a faint fill under our own units) > combat rings (1.6 px) > ambient. A
  selection's orders share one waypoint ring per target. Three layers: under
  the fog, through the fog, and on top of everything.
- **Screen overlay** (`three/screen.ts`): a 2D canvas over the WebGL view
  for health, production and harvester-load bars (one framed style: a 1 px
  rim with cut corners round a dark trough, on the device pixel grid),
  chevrons with a soft dark copy beneath, a marching-dash box select, and
  floating labels ("+100", "VETERAN", placement reasons on a plate that
  slides clear of the HUD), re-projected every frame.
- **Quality** (`three/stage.ts`): shadows from a sun about 48° up in the
  north-west (the painted art's light) that gives about half the light on
  flat ground, so models read with form; the shadow box follows the view;
  1024² shadow maps on touch devices, 2048² on desktop. The clear colour
  past the world's edge is a deep shade of each biome's ground. Shaders
  compile during loading, including stand-ins for looks that first appear
  mid-battle (a skinned squad, tracer and beam glows, light pools, each kind
  of ground mark), and every program is linked before the match starts, so
  the first enemy squad in sight doesn't stall a frame.
  An adaptive controller watches the frame time and, when a device can't
  keep up, steps down in cost order — resolution to 1×, a smaller shadow
  map, no shadows, then resolution below 1× — and creeps back up when
  there's headroom. Software GL (a blocklisted GPU) starts at the cheap end.

## Architecture

```
src/
  sim/        # Pure TS, no engine. The authoritative game state.
    world.ts        # entities, tile grid, occupancy, passability
    balance.ts      # every tunable number: units, buildings, terrain, damage table
    maps.ts         # the 6 maps (seeded painter) + createMapWorld
    modes/survival.ts # Last Stand wave director (pure, seeded)
    rules.ts        # match mutators (World.rules) and their hooks
    ops.ts          # the Ops campaign: op definitions, goals, tickOps
    awards.ts       # medals from an end-of-match recap (pure)
    economy.ts      # scrap, harvesting, depots, tech rules, build queues, selling
    movement.ts     # terrain-weighted A* (ground/hover/air), region-aware goals, steering
    combat.ts       # targeting, armor, splash projectiles, healing, veterancy
    infantry.ts     # robot squads: robots standing, firepower, Sniper concealment (unitSeenBy), Mastodon crushing
    transport.ts    # the Condor: boarding, drop points and unloading, bail-outs
    goliath.ts      # the Goliath: walking ⇄ anchored, weapon systems offline/reboot, repair urgency, build ring, cost; Nomads, Robot Love
    lift.ts         # the two-Condor lift: hook on, carry, set down, drop
    lifeline.ts     # the island map's free replacement Condor
    fog.ts          # per-side visibility maps + building memory
    placement.ts    # why a spot can't be built on, and a suggested spot

    salvage.ts      # battlefield wrecks: spawn, cool, pick-up, burn-out
    powers.ts       # command meter, calldowns (Barrage/EMP/Drop Pod), Sky Hammer, EMP stuns
    objectives.ts   # Uplink capture bars and income (island relays: infantry only, paid while crewed), supply drops and crate rewards
    ai/commander.ts # the enemy commander: strategies, difficulty
    ai/veterans.ts  # wounded veterans fall back to a Mender or the HQ
    ai/menders.ts   # Menders follow whoever needs them, and come home when nobody does

    ai/salvage.ts   # the commander's wreck sweeps
    ai/powers.ts    # the commander's calldowns and its dodge reflex
    ai/objectives.ts # capture squads, Uplink garrisons, crate races
    ai/intel.ts     # what the commander sees (fog + concealment), anti-air in Flak, weapon effectiveness
    ai/condor.ts    # the commander's Condor drops on enemy harvesters (or behind its own wave)
    ai/airlift.ts   # island maps: Condors fly squads out to the relays, hold and retake them, intercept the enemy's
  game/       # three.js: scene, camera, input, rendering
    three/          # the 3D layer: stage (renderer, lights, adaptive quality), camera rig, builder + models,
                    #   robot infantry rigs (infantry.ts), the Goliath's rig and the Gantry's stages (goliath.ts),
                    #   terrain (heightfield, water, props, fog of war), materials, particles, ground-gfx,
                    #   screen overlay, tweens
    render/         # entities, fx, juice-view, wrecks, powers (reticles, strikes), objectives,
                    #   goliath (the Goliath and Gantry views: walk, anchor, damage, lift, topple, love; build stages)
    juice.ts        # hit flash / damage trail / combat ring / cue rules (tested)
    audio.ts        # AudioContext, sfx/music/voice buses, settings, procedural SFX
    score.ts        # music rules: harmony, patterns, stingers, battle mood (tested)
    music.ts        # adaptive score: lookahead scheduler + synth voices
    ambience.ts     # biome ambience beds
    voices.ts       # unit chirp-voices: formant synth, line plans, rate limits
    callouts.ts     # announcer moments, kill streaks, radio queue (tested)
    announcer.ts    # radio announcer: squelch + speechSynthesis / radio code
    awareness.ts    # game speed + tempo safety, hotspots, inbound warnings, battle meter rules (tested)
    awareness-view.ts # wires them to the camera, HUD, radio; camera glide
    squads.ts       # squad (control group) rules (tested)
    advisor.ts      # counter advisor + idle-factory watch (tested)
    placement-view.ts # placement ghost: suggested spot, touch move/drag/confirm
    hints.ts        # one-time hint queue: pacing, priority, staleness (tested)
    heroes.ts, hero-fx.ts  # callsigns; promotion titles and hero toasts
    chronicle.ts    # match recorder + story analysis for the report
    calldown-credit.ts # which deaths a calldown caused (kill credit for callouts, chronicle, toasts, hotspots; tested)
    finale.ts       # the cinematic end: an HQ or last-Goliath kill, or Robot Love's meeting
    career.ts, daily.ts, meta.ts  # XP/ranks/stars storage, the Daily Op, match glue
    ops.ts          # Ops narration: briefing banner, countdowns, star notices
  ui/         # DOM HUD (hud.ts; layout.ts: measured top band → ticker/banner/calldown placement; awareness.ts: speed chip, edge arrows, meter; command.ts: squad chips, advisor badges; objectives.ts: Uplink/drop pill; powers.ts: calldown buttons), after-action report (report.ts), career UI (career.ts), Ops UI (ops.ts), menu styles
art/          # image generation + processing pipeline (Python)
tools/        # map export, balance harness, pacing panel, smoke test, screenshot tour
```

- **Fixed-timestep simulation** (10 ticks/sec) decoupled from rendering
  (interpolated at display rate, driven by the raw frame delta so the game
  keeps real time even when the browser throttles its smoothed clock).
  Input produces **commands** applied at tick boundaries; the sim is
  deterministic and testable.
- One 2048² mipmapped sprite atlas (WebP, ~1.3 MB); painted terrain as
  1024 px chunks per map (48 px per tile).

## Explicitly out of scope (for now)

- Online multiplayer (the deterministic command-driven sim keeps the door
  open), a story campaign (Ops are standalone missions), map editor,
  replays, saves mid-match.
- Upgrades research, buildable superweapons (the Sky Hammer is a timed
  HQ power), walls.
