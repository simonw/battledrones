/**
 * The battle viewer (AGENT-BATTLES.md "Watching"): plays a battle record
 * from tools/arena.ts in the game's own 3D view, as an AI-vs-AI spectator
 * match fed by the record instead of the AI. main.ts loads this module only
 * when it's wanted, so it costs the menu nothing:
 *
 *   menu → 🎬 Watch a replay: paste a record, or pick its file (any build)
 *   /?replay=<record>: its link, relative to the game, any CORS-enabled URL, a GitHub file or a Gist (any build;
 *     npm run dev, then /?replay=battles/<file>.json reaches the project's own files: tools/arena.ts watch does this)
 *   /?replay=battles/<file>.json&follow                      (dev builds) a live battle: re-read every second
 *
 * It checks the world hash every 100 ticks as it plays, and says so if the
 * replay drifts from the battle; it keeps a copy of the world every 30 s so
 * the seek bar can jump back; the commanders' radio lines go to the ticker
 * and the announcer; a panel shows each side's orders and notes round by round.
 */
import { setupWorld, worldHash, type BattleRecord, type RoundLog } from "../arena/record";
import { TICK_RATE } from "../sim/balance";
import { MAPS } from "../sim/maps";
import type { Command, Faction, World } from "../sim/types";
import { replayPanel, type ReplayPanel } from "../ui/replay";
import type { GameScene, MatchFeed } from "./GameScene";

declare const __SIM_HASH__: string | undefined;
/** The sim this build plays (vite.config.ts; tools/arena/files.ts simHash), or null outside a Vite build. */
export const BUILD_SIM: string | null = typeof __SIM_HASH__ === "undefined" ? null : __SIM_HASH__;

/** A keyframe every 30 s of game time. */
const KEYFRAME_TICKS = 30 * TICK_RATE;

export const clock = (tick: number) => {
  const s = Math.floor(tick / TICK_RATE);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export class ReplayFeed implements MatchFeed {
  readonly world: World;
  readonly labels: Record<Faction, string>;
  record: BattleRecord;
  /** The first tick whose hash didn't match, if any. */
  divergedAt: number | null = null;
  scene: GameScene | null = null;
  /** Wall-clock time (ms) the record last grew, for "thinking…" in follow mode. */
  grewAt = performance.now();
  private byTick = new Map<number, Command[]>();
  private hashes = new Map<number, string>();
  private keyframes = new Map<number, World>();
  private radioNext = 0;
  private panel: ReplayPanel | null = null;
  private fetchIn = 1000;
  private fetching = false;

  constructor(record: BattleRecord, readonly url: string | null, readonly follow: boolean) {
    this.record = record;
    this.world = setupWorld(record);
    this.keyframes.set(0, structuredClone(this.world));
    this.labels = { blue: this.label("blue"), red: this.label("red") };
    this.index();
  }

  private label(side: Faction): string {
    const opener = this.record.openers[side];
    return `${this.record.seats[side].player.replace(/^(openai|anthropic|llm):/, "")}${opener ? ` · ${opener}` : ""}`;
  }

  private index(): void {
    this.byTick.clear();
    for (const [tick, , cmds] of this.record.turns) this.byTick.set(tick, [...(this.byTick.get(tick) ?? []), ...cmds]);
    this.hashes = new Map(this.record.hashes);
  }

  /** How far the battle has been played (a live one grows). */
  get playedTo(): number {
    return this.record.end?.tick ?? this.record.tick ?? 0;
  }

  /** The round a tick falls in (round r starts at (r-1) × round ticks). */
  roundAt(tick: number): number {
    return Math.floor(tick / this.record.round) + 1;
  }

  /** A side's log entry for a round (null: it was waiting, or the round isn't played yet). */
  logFor(round: number, side: Faction): RoundLog | null {
    return this.record.log.find((l) => l.round === round && l.side === side) ?? null;
  }

  commands(tick: number): Command[] | null {
    if (tick >= this.playedTo) return null;
    return this.byTick.get(tick) ?? [];
  }

  attach(scene: GameScene): void {
    this.scene = scene;
    this.panel = replayPanel(this, scene);
    // (for tools/arena-viewer-check.mjs and the console)
    (window as unknown as Record<string, unknown>).__replay = this;
  }

  afterTick(w: World, seeking: boolean): void {
    const want = this.hashes.get(w.tick);
    if (want !== undefined && this.divergedAt === null && worldHash(w) !== want) {
      this.divergedAt = w.tick;
      this.scene?.alert(`⚠ This replay diverged at ${clock(w.tick)}`);
    }
    if (w.tick % KEYFRAME_TICKS === 0 && !this.keyframes.has(w.tick)) this.keyframes.set(w.tick, structuredClone(w));
    const radio = this.record.radio;
    while (this.radioNext < radio.length && radio[this.radioNext]![0] <= w.tick) {
      const [, side, text] = radio[this.radioNext++]!;
      if (!seeking) this.scene?.commanderRadio(side, text);
    }
  }

  frame(deltaMs: number): void {
    this.panel?.update();
    if (!this.follow || !this.url || this.record.end) return;
    this.fetchIn -= deltaMs;
    if (this.fetchIn > 0 || this.fetching) return;
    this.fetchIn = 1000;
    this.fetching = true;
    void fetchRecord(this.url)
      .then((r) => this.grow(r))
      .catch(() => {})
      .finally(() => (this.fetching = false));
  }

  /** A newer copy of a live record: same battle, more rounds. */
  private grow(r: BattleRecord): void {
    if (r.seed !== this.record.seed || r.map !== this.record.map || r.created !== this.record.created) return;
    if ((r.end?.tick ?? r.tick) === this.playedTo && !!r.end === !!this.record.end) return;
    this.record = r;
    this.grewAt = performance.now();
    this.index();
  }

  keyframe(tick: number): World | null {
    let best = -1;
    for (const k of this.keyframes.keys()) if (k <= tick && k > best) best = k;
    const kf = best >= 0 ? this.keyframes.get(best)! : null;
    if (kf) this.radioNext = this.record.radio.findIndex((x) => x[0] > kf.tick);
    if (this.radioNext < 0) this.radioNext = this.record.radio.length;
    return kf;
  }
}

/** Was this record played by other sim code than this build's? (A replay may then drift: the hash check says so if it does.) */
export const otherSim = (r: BattleRecord): boolean => !!r.sim && !!BUILD_SIM && r.sim !== BUILD_SIM;

/** A battle record from its JSON, checked enough to play: throws a message a person can act on. */
export function parseRecord(text: string): BattleRecord {
  let r: BattleRecord;
  try {
    r = JSON.parse(text) as BattleRecord;
  } catch {
    throw new Error("That isn't JSON: paste the whole .json file a battle wrote to battles/");
  }
  if (!r || typeof r !== "object" || r.v !== 1 || !Array.isArray(r.turns) || !Array.isArray(r.hashes) || !r.seats)
    throw new Error("That isn't a battle record (tools/arena.ts and llm battledrones write them to battles/)");
  if (!MAPS.some((m) => m.id === r.map)) throw new Error(`This battle was played on "${r.map}", a map this version of the game doesn't have`);
  if (!r.end && !r.tick) throw new Error("This battle hasn't been played past its first round yet");
  return r;
}

async function fetchRecord(url: string): Promise<BattleRecord> {
  const res = await fetch(url, { cache: "no-store" });
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return parseRecord(await res.text());
}

/** A pasted (or picked) record, ready for GameScene. */
export function replayFromJson(text: string): ReplayFeed {
  return new ReplayFeed(parseRecord(text), null, false);
}

/** A Gist's page, gist.github.com/[<owner>/]<id>[/<revision>]: its raw files are served with CORS, the page isn't. */
const GIST = /^https?:\/\/gist\.github\.com\/(?:([^/]+)\/)?([0-9a-f]+)(?:\/([0-9a-f]+))?$/i;
/** A file's page on GitHub, github.com/<owner>/<repo>/blob/<ref>/<path>: raw.githubusercontent.com serves it with CORS. */
const GITHUB_FILE = /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/blob\/(.+)$/i;

/**
 * The text of a battle record linked by URL: relative to the page or
 * absolute, from any server that sends CORS headers, a file's page on GitHub,
 * or a Gist (the record viewer, record-viewer.html, reads links the same way).
 * Throws a message a person can act on.
 */
export async function fetchLinkedRecord(ref: string, base = location.href): Promise<string> {
  let url: URL;
  try {
    url = new URL(ref.trim(), base);
  } catch {
    throw new Error(`"${ref}" isn't a URL`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error("Only http and https links can be loaded");
  const page = (url.origin + url.pathname).replace(/\/$/, "");
  const gist = GIST.exec(page);
  if (gist) {
    const [, owner, id, revision] = gist;
    // with the owner in the link, the raw file needs no API call (GitHub allows 60 an hour per address); it's the Gist's first file
    if (owner) return fetchText(`https://gist.githubusercontent.com/${owner}/${id}/raw/${revision ?? ""}`);
    const res = await fetch(`https://api.github.com/gists/${id}${revision ? `/${revision}` : ""}`).catch(() => null);
    if (!res?.ok) throw new Error(`Couldn't look up Gist ${id} with GitHub's API${res ? ` (${res.status})` : ""}`);
    const files = Object.values(((await res.json()) as { files?: Record<string, { filename: string; raw_url: string }> }).files ?? {});
    const file = files.find((f) => /\.json$/i.test(f.filename)) ?? files[0];
    if (!file) throw new Error(`Gist ${id} has no files`);
    return fetchText(file.raw_url);
  }
  const blob = GITHUB_FILE.exec(page);
  return fetchText(blob ? `https://raw.githubusercontent.com/${blob[1]}/${blob[2]}/${blob[3]}` : url.href);
}

async function fetchText(url: string): Promise<string> {
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    // (to a page, a server that doesn't allow cross-origin reads looks just like no network)
    throw new Error(`Couldn't fetch ${url}: no network, or its server doesn't allow other sites to read it (CORS)`);
  }
  if (!res.ok) throw new Error(`Couldn't fetch ${url}: ${res.status} ${res.statusText}`.trim());
  return res.text();
}

/**
 * Load `?replay=<record>` (any build: fetchLinkedRecord) into a feed for
 * GameScene. `follow` (dev builds, `&follow`) re-reads a live battle's file
 * every second as it grows.
 */
export async function loadReplay(ref: string, follow: boolean): Promise<ReplayFeed> {
  if (!follow) return new ReplayFeed(parseRecord(await fetchLinkedRecord(ref)), null, false);
  const url = new URL(ref, location.href).href;
  return new ReplayFeed(await fetchRecord(url), url, true);
}
