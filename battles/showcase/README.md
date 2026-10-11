# Showcase battles

Battle records from the first model battles (AGENT-BATTLES.md "First
battles"). The site publishes them beside the game, so each one replays from
its link (`/?replay=battles/showcase/<file>.json`) and opens in the record
viewer (`/record-viewer.html?replay=…`): the links are in the table below and
in the README. Or open the game, choose **🎬 Watch a replay** on the menu and
paste the file's contents (or pick the file). From a checkout:

```bash
npx vite-node tools/arena.ts replay battles/showcase/<file>.json   # re-run it, check the hash trail
npx vite-node tools/arena.ts watch battles/showcase/<file>.json    # open it in the dev viewer
npx vite-node tools/arena.ts stats battles/showcase/*.json --detail
```

| Record | Blue | Red | As played | Now (re-simulated) | |
|---|---|---|---|---|---|
| `2026-10-11-riverlands-42-gpt-6-luna-vs-gpt-6-luna.json` | GPT-6 Luna (Industry) | GPT-6 Luna (Industry) | blue wins at 4:31 | blue wins at 4:31 | [replay](https://simonw.github.io/battledrones/?replay=battles/showcase/2026-10-11-riverlands-42-gpt-6-luna-vs-gpt-6-luna.json) · [record](https://simonw.github.io/battledrones/record-viewer.html?replay=battles/showcase/2026-10-11-riverlands-42-gpt-6-luna-vs-gpt-6-luna.json) |
| `2026-10-11-dune-sea-7-gpt-6-luna-vs-gpt-6-luna.json` | GPT-6 Luna (Blitz) | GPT-6 Luna (Industry) | blue wins at 6:23 | blue wins at 7:52 | [replay](https://simonw.github.io/battledrones/?replay=battles/showcase/2026-10-11-dune-sea-7-gpt-6-luna-vs-gpt-6-luna.json) · [record](https://simonw.github.io/battledrones/record-viewer.html?replay=battles/showcase/2026-10-11-dune-sea-7-gpt-6-luna-vs-gpt-6-luna.json) |
| `2026-10-11-riverlands-42-gpt-6-luna-vs-gpt-6-astra.json` | GPT-6 Luna (Industry) | GPT-6 Astra (Industry) | red wins at 4:45 | red wins at 7:50 | [replay](https://simonw.github.io/battledrones/?replay=battles/showcase/2026-10-11-riverlands-42-gpt-6-luna-vs-gpt-6-astra.json) · [record](https://simonw.github.io/battledrones/record-viewer.html?replay=battles/showcase/2026-10-11-riverlands-42-gpt-6-luna-vs-gpt-6-astra.json) |

They were played on the sim before `src/sim/fmath.ts` made it give the same
results in every browser engine, and brought up to date with
`npx vite-node tools/arena.ts upgrade battles/showcase/*.json`: the same
commands, re-simulated. The models chose those commands against the old
world, so the re-simulated battles drift a little; in two of them the final
assault lands later, on the standing orders. The viewer shows the ending as
played when it differs, and each record keeps it under `upgraded`.

The first was played before unit ids were written `"#97"` in the order
reference, so many of its orders were refused. The third was played with
`-o reasoning_effort low` for both seats. The logs databases and tool
transcripts that went with them stayed local (a few MB each).
