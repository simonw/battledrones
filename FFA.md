# Four-player battles

## Status

Built. **Compass Rose** is a four-player map with four-way rotational
symmetry. On it you can:

- play a free-for-all against three AI commanders (**▶ Play**);
- watch four AIs fight it out (**🤖 Watch AI vs AI**);
- battle up to three friends online, over the same WebSocket relay the online
  duel uses (**🌐 Battle friends online (up to 4)**). Seats nobody takes go
  to AI commanders.

The sound duel stays two-player: on a four-player map its button is hidden.

Every two-player match plays exactly as before. Each generalisation in the
sim reduces to the old code for blue and red, and a hash-trail regression
run of 55 two-player scenarios (every map, AI pairings, mutators, Last Stand,
ops, openers) came out bit-identical before and after. Saved records and
replays are unaffected.

| Decision | Chosen | Alternatives considered |
|---|---|---|
| Mode | **Free-for-all**: last side standing wins | 2v2 teams (needs alliances, shared vision, team win rules) |
| Sides | **Blue, red, green and purple**, fixed colours on every screen | Gold (clashes with the neutral gold of Uplinks, crates and veterans) |
| Symmetry | **Rotational (90°)**: each corner is the same corner turned | Mirror symmetry (corners differ in handedness, so scan-order ties differ) |
| Online | **The host's page seals one turn log for everyone**, over the existing relay | Peer-to-peer lockstep among four (a full mesh: six rooms, four-way agreement on every turn); a new relay with rooms of four |
| Empty seats | **AI commanders run on every page**, from the same seed | The host runs them and logs their orders (more traffic, same result) |
| A friend who drops | **An AI stand-in plays their side until they're back** | Pause everyone; knock them out |

## Compass Rose

72×72, arctic. Each player starts in a corner: blue bottom left, green top
left, red top right, purple bottom right. Frozen streams run in from the
middle of each edge, offset like a pinwheel, so every quarter has a
neighbour on each side across a stream and the far corner across the open
centre. Each stream has a timber bridge and a shallow ford out by the edge.

The map is painted once, in blue's quarter, and the painter turns every
stroke onto the other three (`Painter` in `src/sim/maps.ts`), so the four
quarters are the same tiles turned. There are five 📡 Uplinks: one on the
centre plateau, ringed by four rich crystal fields, and one by each bridge,
between two neighbours. Supply drops land four crates at once, one in each
quarter's copy of a drop site.

Rules: Robot Love is banned (it needs exactly two sides), and the map offers
no Last Stand. Survival and op worlds stay two-sided.

## Sides and the sim

`src/sim/sides.ts` holds the sides: `FACTIONS` in canonical order (blue,
red, green, purple), `sidesOf(w)` (the sides a world is played by: two on
every older map, four here), each side's quarter turn (`QUARTER`), and
helpers that turn points, tiles and vectors by quarters. Everything that
used to loop over blue and red loops over `sidesOf(w)`, in canonical order,
so entity ids are handed out the same way on every page. `PerSide<T>` types
the per-side records.

A side's frame (`sideFrame`, `world.ts`) turns its view of the map so that
its base is in blue's corner. Every search whose ties go by scan order runs
in that frame, as it already did for red on a two-player map, so no corner
gets better tie-breaks than another.

**Free-for-all rules.** A side is knocked out when its HQ and every Goliath
are gone, or when it resigns. Everything it still has self-destructs (nobody
gets the kills), its Uplinks go neutral, and its player watches the rest
with the fog lifted (the build bar and ⚡ panel go). Kills and knockouts are
credited to whoever made them (`by` on death and knockout events), so the
report and the radio can say who took out whom. The last side standing wins;
if the last two go on the same tick, it's a draw.

**The AI against three rivals.** Each commander picks a focus rival, and its
waves, raids and calldowns go there (`pickFocus` in `ai/commander.ts`). A
side that raids its base hard earns a grudge and becomes the focus at once.
Otherwise the focus holds for 100 s, then moves to the rival that looks
easiest: near, and hurt if its HQ has been seen. A seeded shuffle keeps four
commanders from all piling onto the same one.

**Closing it out.** Three rivals can stall a side that has plainly won: four
AIs under the Goliath Armada once played on for an hour after 12:00, the
leader's walking Goliaths parked at its staging point while its waves
trickled into the rivals' Goliath rings. So from 12:00 a commander's
Goliaths that walk with the waves march on its focus's base (its base
Goliath, dug in first; its HQ when there is one and we know where), the army
gathered on the lead one, once together they outgun what holds it 1.5 to 1
(an edge that wears down to 1.05 as the match drags on), and the focus holds
until the march is over (`planPush` in `ai/goliath.ts`). From 12:00 too its
waves go at the focus's own buildings, a Goliath counts toward a wave only
when it walks with one, the escort a Goliath no longer needs stands down
(not one marching with the waves); a mined-out map gets no more Harvesters
or garrison squads, and fewer Scouts. `ai/ffa.ts` lists these tactics, with
the switches (`FFA_TACTICS`) tests and tools turn off to measure each, and
one that is off: aiming the Sky Hammer and the Barrage by the damage they'd
do, which slowed the close. None of it reaches a two-player match.

**Presentation.** Green and purple have their own model paint, minimap
colours and HUD portraits (`public/assets/icons/green/`, `…/purple/`). The
report shows the finishing order, a four-line chart and four stat columns;
the HUD's versus pill shows all four sides, struck through as they go. The
radio, the report's key moments and the finale name sides by colour ("Green
knocked out", "Red was knocked out by Purple").

## Getting in

The host picks Compass Rose on the Skirmish tab, with any mutators and an AI
difficulty, and taps **🌐 Battle friends online (up to 4)**. The lobby sheet
shows:

- the battle code;
- a row for each seat: the host's own (blue), then red, green and purple,
  each with **📤 Share**, **📋 Link** and **QR** for that seat's invite link,
  `…/battledrones/#ffa=<code>-<seat>`;
- who has joined, whether they're here now, and the opener they picked;
- the host's own opener and name;
- **▶ Start · 2 friends, 1 AI**.

A friend opens their link, gives a name and taps **⚔️ Join the battle**.
They see the lobby as the host does and pick an opener. When the host taps
Start, every seat nobody joined goes to an AI commander of the chosen
difficulty, with a personality that suits the mutators, and every page loads
the battle. A friend who opens a link after Start is told the battle started
without that seat.

The invite link stays in a friend's address bar while the battle is on, so
a reload brings them back to the join screen and into the battle (below).

## Protocol

The relay (`relay/README.md`) pairs exactly two sockets per room. A
four-player battle is a star of rooms: for battle code `K7QM2XP4`, the host
holds the host seat of rooms `K7QM2XP41`, `K7QM2XP42` and `K7QM2XP43`, and
the friend invited to seat *k* joins room `K7QM2XP4k` as its guest. The
relay needs no change, and each room carries one friend's traffic.

Every message is one JSON text, kept under 900 bytes (the relay's limit is
1 KB). Long unit lists are split into orders of at most 90 units each, with
a lifted Goliath kept in the same piece as its Condors. Long runs of log
events are split over several messages.

Friend → host (`GuestMsg` in `src/ffa/protocol.ts`):

| Message | When |
|---|---|
| `hello` | On every connection: protocol, build, name, and the match and log length it already holds |
| `pick` | Its opener, in the lobby |
| `cmd` | Its orders, numbered from `seq`, sent again until acknowledged |
| `at` | Twice a second: the log events it holds and the tick it has played to |
| `desync` | Its world hash differs from the host's at a check tick |
| `ping` / `bye` | The round trip; leaving |

Host → friend (`HostMsg`):

| Message | When |
|---|---|
| `lobby` | The seats, picks, map, mutators and AI difficulty, whenever they change |
| `start` | The match setup (`FfaSetup`): map, seed, mutators, openers, who plays each seat, the stand-in's seed. Again on a rejoin |
| `ev` | The turn log from index `from`, and the friend's last order seq the host holds |
| `over` | The battle is decided and the host's page still shows the report: wait for its Rematch |
| `end` | The host left, the battle went out of sync, the build differs, or the seat isn't free |
| `pong` | Answers `ping` |

Every message is checked before anything acts on it. The host stamps each
order with the side of the seat it arrived on, whatever side the order
claims, and drops anything that isn't a well-formed order of a known kind.
The sim checks whether the order makes sense (whose units, what can be
built where) itself, as it does for every order.

### Build check

A friend's page joins only if it runs the same build as the host:
`__FFA_HASH__`, a hash of `src/sim`, `src/ffa` and `src/net`
(`ffaHash` in `tools/arena/files.ts`, defined by `vite.config.ts`). A page
on another build is told so ("reload both pages"), as the duel does.

## The turn log

The battle is a turn log that every page steps in order
(`src/ffa/match.ts`). Each event is one of:

- an order, stamped with its side;
- a control change, `{ ai: side, on }`: a stand-in commander takes that
  seat over, or gives it back;
- the host's world hash after a check tick, `{ h: [tick, hash] }`, every 100
  ticks;
- the end of tick *n* (the number *n*).

A page may step tick *n* once it holds tick *n*'s end. The tick's orders are
then every side's in canonical side order: a side played by a commander (an
AI seat, or a stand-in) gets its commander's orders, run right there on that
page with the same seed, and a person's side gets their logged orders.
Commanders aren't logged: every page runs them on the same world, so they
order the same things. Two pages that hold the same log step the same
orders on every tick, and their worlds stay the same.

The record (**📋 Copy replay JSON**) holds every side's orders as stepped,
commanders' too, the AI seats' income handicap and the hash trail, so it
replays in the viewer without the commanders. Every four-player match has
one, local ones too. Both viewers show all four sides: the game's replay
panel (each side's eyes, its notes) and `record-viewer.html` (the map, the
round cards, the totals, and a commands strip stacked by side). A record
with no agent log, as the game's own are, is read there in 5-second rounds.

## The host

The host's page (`src/ffa/host.ts`) holds the battle. Each tick it seals the
log: control changes first, then every order that has reached it for each
friend's seat, then its own, then the tick's end. It sends the log on to
each friend as it grows.

- **No edge for the host.** Its own orders land two ticks after they're
  given, about a friend's round trip through the relay.
- **A friend falling behind** (a slow phone, a weak link) by more than 40
  ticks makes the host wait, for at most 8 s at a time. Then the battle goes
  on, and they catch up by playing faster.
- **A friend not heard from for 12 s** gets a stand-in: an AI at Normal
  (no income handicap either way) plays their side from the next tick, on
  every page. Their late orders go nowhere. When they're back and within 12
  ticks of the host, they get the seat back, also through the log. The
  ticker says so on every page: "Ann (Red) dropped: an AI plays for them
  until they're back", then "Ann (Red) is back".
- **Sending pace.** The relay closes a socket that sends more than 50
  messages a second after a burst of 100, so the host sends each seat at
  most 30 a second. A rejoin's catch-up on a long log goes out at that pace.

The battle runs on the host's page: if it closes, the battle ends for
everyone, with no result. If its tab goes into the background its animation
frames stop, and so does the battle. The lobby says to keep the page open
and in front, and a host who is knocked out is reminded that the battle
still runs on their page.

## A friend

A friend's page (`src/ffa/guest.ts`) says hello on every connection, with
the match and how much of its log it holds, so the host sends on from
there. Its orders are numbered and sent again every 1.2 s until the host's
acknowledgement covers them, so orders lost while the socket was down still
arrive, once each.

It plays the log as it arrives, keeping a couple of ticks in hand: it runs a
little slow with one tick or none to spare, and up to 1.5× with more than
eight. More than 30 ticks behind (back from the background, or a rejoin) it
catches up at up to 60×, eight ticks a frame at most.

**Rejoining.** A page that loses its connection reconnects by itself
(`RelaySocket`, as the online duel's does) and carries on from where it
was. A page that reloads comes back to the join screen through its invite
link; Join says hello with no match, and the host sends the setup and the
whole log again. The page sets the world up and replays it at catch-up
speed, then takes its seat back from the stand-in.

## In the battle

The feed (`src/ffa/feed.ts`) is the `MatchFeed` GameScene plays through, as
the duel's is. Each tick it drains this page's orders, hands them to the
host (or sends them to it) and hands the scene that tick's orders for every
side, or nothing while it waits.

- **The pause menu doesn't stop the battle**: three other people are still
  playing it. It opens over the battle with **🏳 Resign** and a way out. For
  a friend that's **Leave (an AI takes over)**; for the host it's **End the
  battle and leave**, which ends it for everyone.
- **Resign** knocks your side out on every page; the others play on, and
  you watch.
- The top bar names who plays each colour ("You", "Ann", "Rush AI"), and a
  status line says when a page waits: "Waiting for Ann (Red)…" on the
  host's, "Waiting for the host…", "The host's page has gone quiet…",
  "Reconnecting: an AI plays your side meanwhile" or "Catching up…" on a
  friend's.
- **Out of sync.** Every friend's page compares its world hash with the
  host's at every check tick. The first difference ends the battle on every
  page as no contest ("OUT OF SYNC"). If the host's page goes, a friend's
  page plays out whatever log it still holds, then ends with "HOST LEFT".
- The report is the free-for-all report, with "online" in its line and the
  players' names in the finishing order. Online battles earn no XP, medals
  or stars, as duels don't.

**Rematch.** The host's Rematch opens a new lobby with the same battle
code, so everyone's links still work. A friend's Rematch reloads into the
join screen through their link. If the host is still on the report, the
friend's page waits ("waiting for their Rematch…") instead of rejoining the
finished battle.

## Code

| Where | What |
|---|---|
| `src/sim/sides.ts` | The sides, their quarters and turns |
| `src/sim/maps.ts` | Compass Rose, the four-way painter, `setupFourCorners` |
| `src/sim/combat.ts` | Knockouts (`eliminate`, `isOut`, `sidesLeft`) and the free-for-all win |
| `src/sim/ai/commander.ts` | The focus rival |
| `src/sim/ai/ffa.ts` | The commander's free-for-all tactics and their switches (`FFA_TACTICS`); the push is `planPush` in `ai/goliath.ts` |
| `src/net/relay-socket.ts` | One seat of a relay room that reconnects by itself (shared with the online duel) |
| `src/ffa/protocol.ts` | Messages, the turn log's events, invite links, validation, message packing |
| `src/ffa/match.ts` | The battle as every page plays it: the world, the log, the commanders, the record |
| `src/ffa/host.ts`, `src/ffa/guest.ts` | The host's page and a friend's |
| `src/ffa/feed.ts` | The MatchFeed GameScene plays through |
| `src/ffa/lobby.ts` | The host's lobby and a friend's join screen |

Everything under `src/ffa` loads as one lazily loaded chunk, from main.ts's
one `import("./ffa/lobby")`; nothing outside it imports it except types, and
it imports neither the sound duel nor the battle viewer
(`tests/ffa.test.ts`).

## Testing

- `tests/ffa.test.ts`: the protocol; the host and three friends over a fake
  relay (two seats a room, latency, the 1 KB and rate limits) on fake
  timers, with commanders standing in for the people on their own pages, so
  orders really cross the wire. Every page's hash trail agrees over 1,500
  ticks; a friend who drops gets a stand-in on every page at the same tick
  and the seat back; a page that reloads rejoins and catches up; a drifted
  world is caught; a battle played to its end replays from its record to the
  same world. Then the feed with a real Controller: orders in flight, Resign,
  the host leaving, the stand-in notices.
- `tests/objectives.test.ts` and others: the four-way Uplinks and crates,
  quarter turns, free-for-all rules.
- `tests/ai-goliath.test.ts` ("a free-for-all"): the Goliath push (from
  12:00, only with the edge, the focus held, a target out of reach passed
  over, never in a duel), the mined-out economy and the Sky Hammer's aim
  (switched on for the test).
- `node tools/ffa-smoke.mjs` (after `npm run build`): three browser pages,
  the host and two friends, play a battle on Compass Rose through the
  deployed relay, with an AI on the fourth seat. It checks the lobby and the
  invite links, that the hash trails agree, the pause menu, three resigns,
  every page's report and placings, and the rematch lobby.
