# Goliath — spec

## Status

Implemented (commits 137e290 and 86572c0 for the Titan → Mastodon rename,
6a64545…9b77538 for the Goliath, the Gantry and the two mutators below).
The rest of this file is the spec as written; **DESIGN.md** describes the
shipped game (Buildings, Units → *The Goliath* and *The two-Condor lift*,
Battlefield salvage, Combat, Voices & announcer, Command UX, Fog of war,
Match flow, the finale and the report, Career, medals, mutators and the
Daily Op, Controls & UI, 3D view). Where the code differs from the spec,
and why:

- **Every starting number shipped as written**, in `GOLIATH`,
  `UNITS.goliath` and `BUILDINGS.gantry` (`src/sim/balance.ts`): 1,600
  scrap and +25% per Goliath, 3,000 HP, 60 s, sight 10, weapons lost below
  75 / 50 / 25% and back 5% above after a 2.5 s reboot, 4 s to anchor and
  6 s to pack up, a 3-tile ring, half a Condor's speed, 25% of max HP on a
  drop, 6–8 piles; a 3×3 Gantry for 600 scrap, 25 s and 1,200 HP. What
  the table left open, and the one number tuned since:
- **Mortar splash 0.9** (a Mortar's is 1.1). At 1.1 a cost-equal group of
  Rocket Squads only edged a Goliath (−0.14 in `tools/balance.ts
  goliath`); at 0.9 they win by 0.39, a real answer like Lancers, Wasps
  and Hornets, and it still beats Troopers.
- **The weapons as built.** The two mortar tubes fire in turn, a shell
  every 1.5 s, and the two arm cannons alternate half-shells every 0.6 s:
  the DPS of two Mortars and a Mastodon. Each system has its own clock
  and picks its own target; the Goliath fires on the move, halts on
  attack-move once any weapon has a target, and turns its torso to the
  heaviest weapon's. An attack order counts only the weapons still up
  that can hit the target, so a Goliath with its mortars down gives up on
  one across the water.
- **Anchoring needs a 2×2 patch** (`GOLIATH.footprint`) of buildable
  ground with no building, Uplink platform, crate or ground unit on it.
  The Goliath settles onto its middle, and the 3-tile ring is measured
  from there to a building's footprint. Dug in (anchoring, anchored or
  packing up), the patch goes in the occupancy grid: paths go round it
  and nothing pushes it. (The spec tests found a dug-in Goliath jamming
  every path through it.)
- **Orders to an anchored Goliath.** A move or attack-move packs it up,
  and it walks off once it is free; an attack order doesn't, and a dug-in
  Goliath that is shot doesn't chase the shooter (its guns answer on their
  own). On touch, a tap with only an anchored Goliath selected sets the
  rally point for its squads instead of moving it; G (or the ⚓ chip)
  anchors and packs up.
- **The cost step counts Goliaths alive or on a Gantry's cradle**, so
  losing one makes the next cheaper again; the Gantry queues one at a
  time (`queueMax`), and "one per side" counts a Gantry still under
  construction.
- **"Nearly complete" is called at 85%** (`nearlyDone`), as a radio line;
  "in production" and "on the field" are banners.
- **Harvesters** only count a Goliath, or an outpost, that they can drive
  to. One bound for a Goliath reroutes when it packs up, and with nowhere
  left to unload a loaded harvester waits for a Goliath to dig in again
  (the review found Nomads idling every harvester whenever its only base
  moved).
- **The Mender preference is in every Mender's own pick** (`combat.ts`
  `tickHealer`, through `goliath.ts repairUrgency`), not in
  `ai/menders.ts`: the player's Menders favour a Goliath with a weapon
  down, rebooting or a few percent from coming back as much as the AI's
  do.
- **EMP** holds a reboot as well as repair, and pauses anchoring, packing
  up and a lift.
- **Salvage:** a dead Goliath scatters 30% of its list price over its
  6–8 piles, each up to 2.5 tiles out; a Gantry destroyed mid-build, 30%
  of what was paid × progress in up to 4 piles. Piles lie for 90 s
  (wrecks: 60 s).
- **The lift as built:** with the lift selected, a tap flies it there to
  hover, a long-press flies it there and sets it down, and ⇣ Set down (U)
  puts it down where it hovers. A set-down point a Goliath can't stand on
  drifts to the nearest ground within 6 tiles. In the air it is an air
  target. Dropped onto a building, it slides off to open ground close by,
  or is destroyed if there is none.
- **Islands:** no special rules for the Goliath, as specified, so its
  outposts may go up on an island too: the one exception to "nothing
  reaches an island but by Condor" on the Archipelago. The squads it
  trains and an island outpost's units roll out on that island. Home land
  is remembered after the HQ falls, so ordinary buildings and Drop Pods
  still stay off the islands.
- **Last Stand and Ops** still end when the HQ falls, Goliath or not:
  they are bases to hold (a Last Stand could otherwise stall with waves
  that have nothing left to attack). An op won on the enemy's last
  Goliath says "Enemy Goliath destroyed".
- **Calldowns** need an HQ or a Goliath; with no HQ, calldown kills are
  credited to no unit (crediting the Goliath would let it rank up on
  barrages).
- **A Goliath Slayer medal** (🪨, bring down one enemy Goliath) joined
  Giant Slayer, which still counts 3 Mastodons.
- **Agents**, out of scope as planned: the arena's briefing tables list
  the Goliath and the Gantry and agents can build them, but there is no
  order to anchor or lift, and AGENT-BATTLES.md doesn't teach them.
- **Done when:**
  - 183 tests: `tests/goliath.test.ts` (76, the sim against this spec),
    `goliath-feedback.test.ts` (42: radio, banners, awareness, advisor,
    music, report, voices), `ai-goliath.test.ts` (20: the commander's
    Gantry, Goliaths, sites, lifts, hunts, Nomads and Robot Love),
    `goliath-ui.test.ts` (14: taps, the lift, training, the build zone),
    `goliath-render.test.ts` (11), `goliath-mutators.test.ts` (13: Nomads,
    Robot Love, the draw) and `goliath-review.test.ts` (7: one per fix from
    the adversarial review). The whole suite passes (902).
  - Rocket Squads, Wasps, Lancers and Hornets are real answers: a Goliath
    loses to 1,600 scrap of each by 0.39–0.84 (`npm run balance goliath`;
    DESIGN.md's *Goliath pass* has every unit's margin).
  - The AI builds and uses them: in round robins of 30 AI-vs-AI matches a
    map, 18–26 of 30 have a Goliath on every map but the Proving Grounds
    (too few fields for the AI's Gantry), the first rolls out at a median
    6:34–9:08, and mean match lengths move from 9.8–16.0 to 9.8–16.7
    minutes. Not finished: on the Archipelago a side dug in behind a
    Goliath can hold out to 25:00 (`AI-GOLIATH-NOTES.md`).

**Additions**, asked for after this spec was written (DESIGN.md,
*Career, medals, mutators and the Daily Op*):

- **Nomads** 🦿 ("Each side starts with a Goliath instead of a base"): in
  a skirmish each side's HQ is replaced by a Goliath standing anchored
  where it stood, and there is no HQ. Anchored Goliaths then also build
  Harvesters, every building is an outpost, the openers set up round the
  Goliath, and calldowns work with a Goliath and no HQ.
- **Robot Love** 💘 ("Two enemy Goliaths that meet fall in love, and the
  battle ends in a draw"): a blue and a red Goliath within 5 tiles of each
  other (`GOLIATH.love.range`) end the match in a draw (`World.winner`
  `"draw"`), with a canned love scene — the two meet, eyes pink, hearts
  bubbling out, the banner "💘 They fell in love / It's a draw" and a
  sweet sting — a DRAW report, and a career result that is neither a win
  nor a loss, with its own XP (scaled down for a short match, as a loss
  is, so a quick meeting can't be farmed). Battle records end with no winner and the
  reason `"love"`.
- **Goliath Armada** 🚁 ("Each side starts with four Goliaths in the air,
  two Condors carrying each, and nothing else"): in a skirmish each side's
  start (HQ, Harvester and Trooper Squad) is cleared, and four Goliaths
  hang on the corners of a square round where the HQ stood
  (`GOLIATH.armada.gap` either way of its centre), facing the map centre,
  each already on a two-Condor lift (`lift.ts armadaStart`). No opener is
  dealt (every card reads "Disabled: Goliath Armada"). As under Nomads
  there is no HQ: anchored Goliaths also build Harvesters, every building
  is an outpost, and a side is beaten when its last Goliath falls. It
  also conflicts with Nomads and Airborne (each starts a side another way).
- All three conflict with Air War and Infantry War, which ban the Goliath, and
  the Daily Op draws its mutators from a frozen list that leaves them out.

## The spec as written

The Goliath is a giant walking mech that works as a **mobile base**: it
takes harvested scrap, lets you build far from home and trains infantry,
while fighting with weapons it loses one by one as it takes damage. It is
built at a new top-of-the-tree building, the **Gantry**.

> **Every number in this spec is a starting point, not a commitment.**
> Costs, HP, timings, ranges, thresholds, weapon strength and speeds all live
> in `src/sim/balance.ts` and are to be tuned for balance through automated
> playtesting (see *Balancing and playtesting*).

**Out of scope for now:**

- **LLM command.** Agent battles (`AGENT-BATTLES.md`) and the
  `llm-tools-battledrones` plugin don't need to know about Goliaths yet.
- **Replay compatibility.** Battle records made before the Titan → Mastodon
  rename may stop replaying correctly. Tying replays to tagged versions of
  the game will be solved separately.

## Naming

- **Goliath**: the giant mech.
- **Mastodon**: the old Titan tank, renamed so the two aren't confused. The
  rename is everywhere: UI, docs, AI, voice lines and the internal unit id.

## The Gantry

- **Prerequisites:** a Fab Plant, an Airpad, a Tech Lab **and** an Assembly
  Bay. A building's `requires` list means "any one of these" today
  (`src/sim/economy.ts`); the Gantry needs "all of these".
- **One Gantry per side.**
- **Always visible to the enemy**, through fog and on the minimap: it's a
  big building. That includes the Goliath taking shape on it.
- **Builds Goliaths**, which walk out when finished.
- **Visual stages** show the build's progress:
  1. **Empty:** bare scaffold, crane folded, floor lights off.
  2. **Foundation (0–25%):** feet and legs bolted to the cradle, welding
     sparks, the crane starts working.
  3. **Frame (25–50%):** hip and torso skeleton, armour plates lowered in by
     the crane.
  4. **Armament (50–75%):** torso plated, arm cannons and shoulder mortars
     mounted.
  5. **Finishing (75–99%):** head mounted, eye still dark, team panels on,
     steam venting, lights blinking.
  6. **Rollout:** the eye lights up, the scaffold arms swing clear and the
     Goliath walks out; the Gantry returns to Empty.
- **Warnings to the enemy:** "Enemy Goliath in production" when a build
  starts, "Enemy Goliath nearly complete" near the end, and "Enemy Goliath
  on the field" at rollout.
- **Destroyed mid-build:** the progress is lost, and scrap scatters around
  the Gantry in proportion to how far the build had got.

## Walking and anchored

The Goliath has two modes, and switching between them takes time.

- **Walking:** moves and fights. No scrap drop-off, no building nearby, no
  training.
- **Anchored:** a scrap drop-off for harvesters, building is allowed within
  3 tiles of it, and it trains infantry squads (only while anchored). It
  salvages 0.75 scrap a second on its own (half an Uplink's pay,
  `GOLIATH.trickle`, × the side's income like the HQ's trickle), so a side
  with no HQ isn't left with nothing once the fields run dry. It fires
  normally while anchored.
- **Where it can anchor:** anywhere a building could be placed (buildable
  ground, no building or unit in the way), with no build-range requirement.
- **Anchoring animation:** the body lowers on hydraulics, the legs splay and
  stabilizer spikes drive into the ground with dust and a small camera
  shake; a scrap hopper and crane arm unfold, and the build ring pulses out
  across the ground in team colour.
- **Packing up:** the same in reverse, with steam and the spikes pulling
  free, and a progress arc showing when it can move. Packing up is slower
  than anchoring, so leaving under fire is the risky moment.
- **Harvesters** bound for a Goliath reroute to the nearest other drop-off
  as soon as it starts packing up.

## Building near it: outposts

- Any building **except an HQ** can be placed within 3 tiles of an anchored
  Goliath, even far from your base.
- Buildings placed this way are **outposts**. They never count as base for
  build range (`inBuildRange` in `src/sim/placement.ts`), so nothing can be
  built off them unless a Goliath anchors nearby again.
- Outposts stay and keep working after the Goliath moves on: an outpost
  Depot still takes harvester scrap.
- A building placed inside normal base range is a normal building, even if
  a Goliath is nearby. This is decided when the building is placed.

## Weapons, damage and repair

- **Weapons:**
  - two shoulder **mortars** (explosive, like the Mortar)
  - an **eye laser** (laser, like the Lancer)
  - two **arm cannons** (cannon, like the Mastodon)
  - **machine guns** (kinetic, like a Trooper Squad, and they hit air too)
- **Damage stages:** as its health falls it loses the **mortars** first,
  then the **laser**, then the **arm cannons**. The **machine guns always
  work**, so it is never helpless against aircraft or infantry. Losing its
  long-range mortars first means a damaged Goliath can no longer shell a
  base, and its reach visibly shrinks as it weakens.
- **Repair:** only **Menders** repair a Goliath (no Field Repair crate, no
  veteran self-repair). Repairing it brings lost weapons back, each after a
  short reboot you can see (the eye relights, the mortar tubes cycle) and a
  little above the health where it went offline, so weapons don't flicker
  on and off at the line.
- **It takes 2–3 Menders working on it to make real progress.** That's
  intended: a cloud of Menders around a hurt Goliath, and an enemy trying to
  shoot them down. The Mender AI (`src/sim/ai/menders.ts`) favours a Goliath
  with a weapon offline or about to come back.
- **EMP** freezes Menders like anything else, and blocks repair on a Goliath
  while it lasts.
- **Readability:** threshold marks on its health bar; damage you can see per
  weapon (a smoking shoulder, a dark eye, drooping arms); a threat-range
  ring that shrinks as weapons go; radio lines like "Goliath anchored",
  "Enemy Goliath digging in" and "Enemy Goliath: mortars down!"

## Sight and visibility

- A Goliath sees further than any other unit.
- It is **always visible to the enemy**, through fog and on the minimap. It
  can't hide.

## Two-Condor lift

- **Two Condors** can carry a walking (not anchored) Goliath together.
- **Controls:** select two empty Condors and tap the Goliath to hook on,
  then long-press a destination.
- **In flight** they move slowly, and only the Goliath's machine guns fire.
- **If either Condor is shot down**, the Goliath drops: over land it lands
  heavily damaged; over water, sea, lava or rock it is destroyed (as squads
  in a downed Condor are today).
- **No special island rules:** on the Archipelago, a Goliath lifted onto an
  island can anchor and train squads there like anywhere else.

## Multiple Goliaths and defeat

- A side can have **several Goliaths**. Each costs **25% more for every
  Goliath that side already has**, so replacing a lost one isn't penalised.
- **Defeat:** today a side loses when its HQ falls (`src/sim/combat.ts`).
  With Goliaths, a side is defeated only when its **HQ and all its Goliaths**
  are destroyed.
- **After the HQ falls** you can still build, near an anchored Goliath and
  in range of your surviving buildings. You can't rebuild an HQ.

## Death

- A destroyed Goliath **topples** visibly. The fall deals no damage.
- It leaves its salvage **scattered over a wide area** in several scrap
  piles, not as one wreck, so collecting all of it means holding the ground.

## Starting numbers

All of these are expected to change in tuning.

| | Starting value |
|---|---|
| Goliath cost | ~1,600 scrap, +25% for each Goliath already owned |
| Goliath HP | ~3,000 (an HQ has 3,200) |
| Goliath build time | ~60 s |
| Goliath sight | 10 tiles (the best unit today has 9; Radar 13) |
| Weapon strength | mortars ≈ 2 Mortars, laser ≈ 1 Lancer, cannons ≈ 1 Mastodon, machine guns ≈ 1 Trooper Squad (≈ 1,400 scrap of firepower in all) |
| Weapons lost | mortars below 75% HP, laser below 50%, cannons below 25% |
| Weapons restored | ~5% above the threshold where each was lost, after a 2–3 s reboot |
| Anchor / pack up | ~4 s / ~6 s |
| Build ring | 3 tiles |
| Lift speed | ~½ Condor speed |
| Lift drop over land | ~25% of max HP |
| Death salvage | 6–8 piles across ~5 tiles |
| Gantry | 3×3, ~600 scrap, ~25 s to build, ~1,200 HP |

## Balancing and playtesting

**Every value above is flexible.** Tune them with the existing headless
harness, `tools/balance.ts`:

- `duels`: a Goliath against cost-equal groups of each unit. Rocket Squads,
  Wasps, Lancers and Hornets should all be real answers to it.
- `matches`: AI-vs-AI round robins on every map.
- `--tune '{...}'`: A/B runs that override any exported balance number.
- `tools/pacing-match.ts` for match pacing.

**The AI has to use Goliaths before automated playtesting means anything.**
The AI commander needs to:

- decide when to build the Gantry
- anchor Goliaths at distant fields and build outposts
- escort them with Menders and anti-air
- use the two-Condor lift
- hunt enemy Goliaths

**What to measure:**

- How much a Goliath shifts win rates, and on which maps.
- When the first Goliath appears in a match.
- Match length, and whether "not defeated while a Goliath lives" drags out
  games that are already lost.
- How often Goliaths die compared with what they earn and kill first.
- Whether outposts make distant crystal fields worth taking.
