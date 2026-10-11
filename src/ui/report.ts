import { UNITS } from "../sim/balance";
import { POWER_KINDS, POWER_NAMES } from "../sim/powers";
import type { Faction, FactionStats, World } from "../sim/types";
import {
  chronicleOf,
  commanderStory,
  fmtTime,
  moments as storyBeats,
  peakArmy,
  pickTip,
  type Chronicle,
  type HeroRec,
  type Moment,
  type Sample
} from "../game/chronicle";
import { callsignOf, killsLabel, stars } from "../game/heroes";

/**
 * The after-action report: the end screen of a skirmish. It tells the
 * match's story from the chronicle — an army-strength timeline with the key
 * moments marked on it, the MVP unit, the stats (correct kill counts), and
 * one tip for next time; in spectator mode, both commanders' stories.
 *
 * Extension point: addReportSection() lets later features (career medals…)
 * add a block without touching this file's layout code.
 */

export interface ReportOpts {
  world: World;
  winner: Faction;
  /** The local player's side (the report's point of view unless spectating). */
  pov: Faction;
  spectator: boolean;
  /** Match length in seconds. */
  secs: number;
  /** Spectator: both strategy names. */
  strategies: { blue: string; red: string } | null;
  enemy: { strategy: string; difficulty: string };
  onRematch(): void;
  onMenu(): void;
  /** Replace the VICTORY / DEFEAT headline (Ops: "OP COMPLETE", the op and its time). */
  head?: { title: string; cls: "win" | "lose"; sub: string };
  /** Extra buttons before Rematch (Ops: "Next op"), and Rematch's own label. */
  actions?: { id: string; label: string; cls?: string; on(): void }[];
  rematchLabel?: string;
}

export interface ReportContext extends ReportOpts {
  chronicle: Chronicle;
  won: boolean;
  mvp: Record<Faction, HeroRec | null>;
  moments: Moment[];
}

export interface ReportSection {
  id: string;
  /** Sort key: built-ins use head 0, chart 10, moments 20, MVP 30, stats 40, tip 50. */
  order: number;
  /** Which column in the two-column (landscape) layout. Default "right". */
  col?: "left" | "right";
  /** HTML for the section body, or null to skip it this match. */
  render(ctx: ReportContext): string | null;
  /** Wire up listeners after the section is in the DOM. */
  mount?(el: HTMLElement, ctx: ReportContext): void;
}

const extraSections: ReportSection[] = [];

/** Register an extra report block (e.g. a medal row). Returns an unregister function. */
export function addReportSection(s: ReportSection): () => void {
  extraSections.push(s);
  return () => {
    const i = extraSections.indexOf(s);
    if (i >= 0) extraSections.splice(i, 1);
  };
}

const icon = (kind: string) => `assets/icons/${kind}.webp`;
const short = (n: number) => (n >= 10000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n)));
const sideName = (f: Faction, ctx: ReportOpts) =>
  ctx.spectator ? (f === "blue" ? "Blue" : "Red") : f === ctx.pov ? "You" : "Enemy";

// ---------------------------------------------------------------- chart ---

const VB_W = 320;
const VB_H = 104;
const PLOT = { x0: 6, x1: 314, y0: 10, y1: 94 };

function valueAt(samples: Sample[], t: number, f: Faction): number {
  let best = samples[0]!;
  for (const s of samples) if (Math.abs(s.t - t) < Math.abs(best.t - t)) best = s;
  return best.army[f];
}

function chartHtml(ctx: ReportContext): string | null {
  const samples = ctx.chronicle.samples;
  if (samples.length < 3) return null;
  const T = Math.max(1, samples[samples.length - 1]!.t);
  const maxV = Math.max(1, ...samples.map((s) => Math.max(s.army.blue, s.army.red)));
  const x = (t: number) => PLOT.x0 + (t / T) * (PLOT.x1 - PLOT.x0);
  const y = (v: number) => PLOT.y1 - (v / maxV) * (PLOT.y1 - PLOT.y0);
  const pts = (f: Faction) => samples.map((s) => `${x(s.t).toFixed(1)},${y(s.army[f]).toFixed(1)}`).join(" ");
  const area = (f: Faction) => `M${x(0).toFixed(1)},${PLOT.y1} L${pts(f).replace(/ /g, " L")} L${x(T).toFixed(1)},${PLOT.y1} Z`;
  // the reader's side draws on top
  const order: Faction[] = !ctx.spectator && ctx.pov === "red" ? ["blue", "red"] : ["red", "blue"];
  const marks = ctx.moments
    .map((m, i) => {
      const mx = x(m.t);
      const top = Math.max(valueAt(samples, m.t, "blue"), valueAt(samples, m.t, "red"));
      const my = Math.max(PLOT.y0 + 2, y(top) - 9);
      return `<g class="mk ${m.tone}" data-i="${i}">
        <line x1="${mx.toFixed(1)}" y1="${(my + 7).toFixed(1)}" x2="${mx.toFixed(1)}" y2="${PLOT.y1}" class="mk-stem"/>
        <circle cx="${mx.toFixed(1)}" cy="${my.toFixed(1)}" r="7.5" class="mk-dot"/>
        <text x="${mx.toFixed(1)}" y="${(my + 3.4).toFixed(1)}" class="mk-n">${i + 1}</text>
      </g>`;
    })
    .join("");
  const mid = fmtTime(T / 2);
  // (a replay's labels are its players' names, from a record that may have come from anywhere: escaped)
  const label = (f: Faction) => (ctx.spectator ? `${sideName(f, ctx)} · ${escapeHtml(ctx.strategies?.[f] ?? "")}` : sideName(f, ctx));
  return `
    <div class="aar-legend">
      <span class="lk blue"><i></i>${label("blue")}</span>
      <span class="lk red"><i></i>${label("red")}</span>
      <span class="cap">Army strength</span>
    </div>
    <svg class="aar-svg" viewBox="0 0 ${VB_W} ${VB_H}" role="img"
      aria-label="Army strength over time for both sides, with ${ctx.moments.length} key moments marked">
      <defs>
        <linearGradient id="aar-gb" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#4c9dff" stop-opacity="0.32"/><stop offset="1" stop-color="#4c9dff" stop-opacity="0"/></linearGradient>
        <linearGradient id="aar-gr" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7a6a" stop-opacity="0.28"/><stop offset="1" stop-color="#ff7a6a" stop-opacity="0"/></linearGradient>
      </defs>
      <line x1="${PLOT.x0}" y1="${PLOT.y1}" x2="${PLOT.x1}" y2="${PLOT.y1}" class="base"/>
      <line x1="${x(T / 2).toFixed(1)}" y1="${PLOT.y0}" x2="${x(T / 2).toFixed(1)}" y2="${PLOT.y1}" class="grid"/>
      ${order.map((f) => `<path d="${area(f)}" fill="url(#aar-g${f === "blue" ? "b" : "r"})" class="area"/>`).join("")}
      ${order.map((f) => `<polyline points="${pts(f)}" class="ln ${f}" pathLength="1"/>`).join("")}
      <line class="xh" x1="0" y1="${PLOT.y0 - 4}" x2="0" y2="${PLOT.y1}" visibility="hidden"/>
      <circle class="xd blue" r="3.5" visibility="hidden"/><circle class="xd red" r="3.5" visibility="hidden"/>
      ${marks}
    </svg>
    <div class="aar-axis"><span>0:00</span><span>${mid}</span><span>${fmtTime(T)}</span></div>
    <p class="aar-readout">Tap or drag across the chart</p>`;
}

function mountChart(el: HTMLElement, ctx: ReportContext, select: (i: number | null) => void): void {
  const svg = el.querySelector<SVGSVGElement>(".aar-svg");
  const readout = el.querySelector<HTMLElement>(".aar-readout");
  if (!svg || !readout) return;
  const samples = ctx.chronicle.samples;
  const T = Math.max(1, samples[samples.length - 1]!.t);
  const maxV = Math.max(1, ...samples.map((s) => Math.max(s.army.blue, s.army.red)));
  const xh = svg.querySelector<SVGLineElement>(".xh")!;
  const dots = { blue: svg.querySelector<SVGCircleElement>(".xd.blue")!, red: svg.querySelector<SVGCircleElement>(".xd.red")! };
  const toVb = (clientX: number) => {
    const r = svg.getBoundingClientRect();
    return ((clientX - r.left) / Math.max(1, r.width)) * VB_W;
  };
  const showSample = (vx: number) => {
    const t = ((vx - PLOT.x0) / (PLOT.x1 - PLOT.x0)) * T;
    let s = samples[0]!;
    for (const c of samples) if (Math.abs(c.t - t) < Math.abs(s.t - t)) s = c;
    const sx = PLOT.x0 + (s.t / T) * (PLOT.x1 - PLOT.x0);
    xh.setAttribute("x1", String(sx));
    xh.setAttribute("x2", String(sx));
    xh.setAttribute("visibility", "visible");
    for (const f of ["blue", "red"] as Faction[]) {
      dots[f].setAttribute("cx", String(sx));
      dots[f].setAttribute("cy", String(PLOT.y1 - (s.army[f] / maxV) * (PLOT.y1 - PLOT.y0)));
      dots[f].setAttribute("visibility", "visible");
    }
    readout.innerHTML = `<b>${fmtTime(s.t)}</b>${(["blue", "red"] as Faction[])
      .map((f) => `<span class="rk ${f}"><i></i><em>${short(s.army[f])}</em> ${sideName(f, ctx)}</span>`)
      .join("")}`;
    select(null);
  };
  const handle = (e: PointerEvent) => {
    const vx = toVb(e.clientX);
    // a moment marker within reach wins over the crosshair (≈ 40 px target)
    let hit: number | null = null;
    let bestD = 18;
    ctx.moments.forEach((m, i) => {
      const d = Math.abs(PLOT.x0 + (m.t / T) * (PLOT.x1 - PLOT.x0) - vx);
      if (d < bestD) {
        bestD = d;
        hit = i;
      }
    });
    if (hit !== null && e.type === "pointerdown") {
      xh.setAttribute("visibility", "hidden");
      dots.blue.setAttribute("visibility", "hidden");
      dots.red.setAttribute("visibility", "hidden");
      const m = ctx.moments[hit]!;
      readout.innerHTML = `<b>${fmtTime(m.t)}</b> `;
      readout.append(`${m.title}: ${m.text}`);
      select(hit);
      return;
    }
    showSample(vx);
  };
  let down = false;
  svg.addEventListener("pointerdown", (e) => {
    down = true;
    handle(e);
  });
  svg.addEventListener("pointermove", (e) => {
    if (down || e.pointerType === "mouse") handle(e);
  });
  const up = () => (down = false);
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);
  svg.addEventListener("pointerleave", up);
}

// ------------------------------------------------------------- sections ---

function headHtml(ctx: ReportContext): string {
  if (ctx.head) return `<h1 class="${ctx.head.cls}">${escapeHtml(ctx.head.title)}</h1><p class="time">${escapeHtml(ctx.head.sub)}</p>`;
  const spec = ctx.spectator;
  const title = spec ? `${ctx.winner.toUpperCase()} WINS` : ctx.won ? "VICTORY" : "DEFEAT";
  const cls = spec ? (ctx.winner === "blue" ? "win" : "lose") : ctx.won ? "win" : "lose";
  const vs = spec
    ? escapeHtml(`${ctx.strategies?.blue ?? "Blue"} vs ${ctx.strategies?.red ?? "Red"}`)
    : `vs ${ctx.enemy.strategy} AI (${ctx.enemy.difficulty})`;
  return `<h1 class="${cls}">${title}</h1><p class="time">${vs} · ${fmtTime(ctx.secs)}</p>`;
}

function momentsHtml(ctx: ReportContext): string | null {
  if (ctx.moments.length === 0) return null;
  return `<ol class="aar-moments">${ctx.moments
    .map(
      (m, i) => `<li class="${m.tone}" data-i="${i}"><b class="n">${i + 1}</b><div><span class="mt">${m.title} · ${fmtTime(m.t)}</span><span class="mx"></span></div></li>`
    )
    .join("")}</ol>`;
}

/** One unit card: icon, callsign, rank, kills, fate. */
export function mvpCard(w: World, h: HeroRec, tag: string, cls: string): string {
  const name = callsignOf(w, h);
  const fate = h.alive ? `<span class="fate alive">Survived</span>` : `<span class="fate fell">✝ Fell at ${fmtTime(h.diedAt ?? 0)}</span>`;
  return `<div class="mvp ${h.faction} ${cls}">
    <span class="mvp-tag">${tag}</span>
    <img src="${icon(h.kind)}" alt="" draggable="false"/>
    <div class="mvp-t"><b>${h.rank > 0 ? `<span class="rank">${stars(h.rank)}</span> ` : ""}${name}</b>
      <span>${UNITS[h.kind].name} · ${killsLabel(h.kills)}</span>${fate}</div>
  </div>`;
}

/** The MVP row (also used by the Last Stand end screen). */
export function mvpRowHtml(w: World, mvp: Record<Faction, HeroRec | null>, pov: Faction, spectator: boolean): string | null {
  const me = spectator ? "blue" : pov;
  const them: Faction = me === "blue" ? "red" : "blue";
  const cards: string[] = [];
  const mine = mvp[me];
  const theirs = mvp[them];
  if (mine) cards.push(mvpCard(w, mine, spectator ? "Blue MVP" : "Your MVP", "main"));
  if (theirs) cards.push(mvpCard(w, theirs, spectator ? "Red MVP" : "Their ace", spectator ? "main" : "minor"));
  return cards.length ? `<div class="aar-mvps">${cards.join("")}</div>` : null;
}

const KNOWN_STATS = new Set(["unitsBuilt", "unitsLost", "unitsKilled", "buildingsLost", "buildingsKilled", "scrapHarvested", "scrapSalvaged"]);
/** Friendly labels for stats other features may add to FactionStats. */
const EXTRA_LABELS: Record<string, string> = {
  scrapSalvaged: "Scrap salvaged",
  salvaged: "Scrap salvaged",
  salvage: "Salvage",
  bounty: "Bounty earned",
  bountyEarned: "Bounty earned",
  calldowns: "Calldowns used",
  calldownsUsed: "Calldowns used",
  drops: "Supply drops taken",
  dropsCaptured: "Supply drops taken",
  uplinkSeconds: "Uplink time (s)",
  aircraftKilled: "Aircraft downed",
  titansKilled: "Titans destroyed",
  killsByBuildings: "Kills by defences"
};
const humanize = (k: string) => {
  const s = k.replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
};

/** Numeric FactionStats fields beyond the core set, read defensively. */
export function extraStatRows(blue: FactionStats, red: FactionStats, max = 4): { label: string; a: number; b: number }[] {
  const A = blue as unknown as Record<string, unknown>;
  const B = red as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(A), ...Object.keys(B)])].filter((k) => !KNOWN_STATS.has(k));
  const rows: { label: string; a: number; b: number }[] = [];
  const seen = new Set<string>();
  for (const k of keys) {
    const a = typeof A[k] === "number" ? (A[k] as number) : 0;
    const b = typeof B[k] === "number" ? (B[k] as number) : 0;
    if (typeof A[k] !== "number" && typeof B[k] !== "number") continue;
    if (!Number.isFinite(a) || !Number.isFinite(b) || (a === 0 && b === 0)) continue;
    const label = EXTRA_LABELS[k] ?? humanize(k);
    if (seen.has(label)) continue;
    seen.add(label);
    rows.push({ label, a, b });
  }
  // known extras first, in the table's preferred order
  const rank = (l: string) => {
    const i = Object.values(EXTRA_LABELS).indexOf(l);
    return i < 0 ? 99 : i;
  };
  rows.sort((p, q) => rank(p.label) - rank(q.label));
  return rows.slice(0, max);
}

function statsHtml(ctx: ReportContext): string {
  const st = (f: Faction) => ctx.world.factions[f].stats;
  const p: Faction = ctx.spectator ? "blue" : ctx.pov;
  const q: Faction = p === "blue" ? "red" : "blue";
  const row = (label: string, a: number, b: number) => {
    const A = Math.floor(a);
    const B = Math.floor(b);
    return `<tr><td>${label}</td><td>${A}</td><td>${B}</td></tr>`;
  };
  const rows = [
    row("Units destroyed", st(p).unitsKilled, st(q).unitsKilled),
    row("Buildings destroyed", st(p).buildingsKilled ?? 0, st(q).buildingsKilled ?? 0),
    row("Units built", st(p).unitsBuilt, st(q).unitsBuilt),
    row("Units lost", st(p).unitsLost, st(q).unitsLost),
    row("Scrap harvested", st(p).scrapHarvested, st(q).scrapHarvested)
  ];
  // battlefield salvage and calldowns (not every mode has them: rows only when something happened)
  const salv = (f: Faction) => st(f).scrapSalvaged ?? 0;
  if (salv(p) + salv(q) > 0) rows.push(row("Scrap salvaged", salv(p), salv(q)));
  const calls = calldownCounts(ctx.world);
  if (calls.blue.total + calls.red.total > 0)
    rows.push(
      `<tr title="${escapeHtml(`${calldownBreakdown(calls[p].by)} · ${calldownBreakdown(calls[q].by)}`)}"><td>Calldowns</td><td>${calls[p].total}</td><td>${calls[q].total}</td></tr>`
    );
  // map objectives (skirmish only): Uplinks captured, crates claimed, scrap they paid
  const obj = ctx.world.objectives;
  if (obj && obj.uplinks.length > 0) {
    const os = (f: Faction) => obj.stats[f];
    rows.push(row("Uplinks captured", os(p).captures, os(q).captures));
    rows.push(row("Crates claimed", os(p).crates, os(q).crates));
    rows.push(row("Objective scrap", os(p).uplinkScrap + os(p).crateScrap, os(q).uplinkScrap + os(q).crateScrap));
  }
  rows.push(row("Peak army", peakArmy(ctx.chronicle.samples, p), peakArmy(ctx.chronicle.samples, q)));
  const ex = extraStatRows(st("blue"), st("red"));
  for (const r of ex) rows.push(row(r.label, p === "blue" ? r.a : r.b, p === "blue" ? r.b : r.a));
  return `<table class="aar-stats">
    <tr><th></th><th class="hb"><i class="${p}"></i>${sideName(p, ctx)}</th><th class="hb"><i class="${q}"></i>${sideName(q, ctx)}</th></tr>
    ${rows.join("")}</table>`;
}

/** Calldowns fired per side (World.powers.fired), with the per-power counts. */
export function calldownCounts(w: World): Record<Faction, { total: number; by: [string, number][] }> {
  const one = (f: Faction) => {
    const fired = w.powers?.fired?.[f];
    const by = POWER_KINDS.map((k) => [POWER_NAMES[k], fired?.[k] ?? 0] as [string, number]).filter(([, n]) => n > 0);
    return { total: by.reduce((s, [, n]) => s + n, 0), by };
  };
  return { blue: one("blue"), red: one("red") };
}

const calldownBreakdown = (by: [string, number][]) => (by.length ? by.map(([k, n]) => `${n} ${k}`).join(", ") : "none");

function tipHtml(ctx: ReportContext): string | null {
  if (ctx.spectator) {
    // both commanders' story instead of a tip
    const line = (f: Faction) =>
      `<p><i class="${f}"></i><span>${escapeHtml(
        commanderStory(ctx.chronicle, ctx.world, f, `${f === "blue" ? "Blue" : "Red"} · ${ctx.strategies?.[f] ?? ""}`)
      )}</span></p>`;
    return `<div class="aar-story">${line("blue")}${line("red")}</div>`;
  }
  if (ctx.world.ops) return null; // an op's section shows its own tip and the stars still to earn
  const c = ctx.chronicle;
  const tip = pickTip({
    pov: ctx.pov, won: ctx.won, duration: ctx.secs, difficulty: ctx.enemy.difficulty.toLowerCase(),
    built: c.built, firstBuilt: c.firstBuilt, deaths: c.deaths, samples: c.samples, factories: c.factories
  });
  return `<p class="aar-tip"><b>Next time</b><span>${escapeHtml(tip)}</span></p>`;
}

const escapeHtml = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);

// ----------------------------------------------------------------- show ---

export function showReport(endEl: HTMLElement, o: ReportOpts): void {
  const chronicle = chronicleOf(o.world);
  chronicle.finish();
  const ctx: ReportContext = {
    ...o,
    chronicle,
    won: !o.spectator && o.winner === o.pov,
    mvp: chronicle.mvp(),
    moments: storyBeats(chronicle, o.spectator ? null : o.pov)
  };
  const builtIn: ReportSection[] = [
    { id: "chart", order: 10, col: "left", render: chartHtml },
    { id: "moments", order: 20, col: "left", render: momentsHtml },
    { id: "mvp", order: 30, render: (c: ReportContext) => mvpRowHtml(c.world, c.mvp, c.pov, c.spectator) },
    { id: "stats", order: 40, render: statsHtml },
    { id: "tip", order: 50, render: tipHtml }
  ];
  const sections = [...builtIn, ...extraSections].sort((a, b) => a.order - b.order);

  const rendered: { s: ReportSection; html: string }[] = [];
  for (const s of sections) {
    let html: string | null = null;
    try {
      html = s.render(ctx);
    } catch (e) {
      console.warn("report section failed:", s.id, e);
    }
    if (html) rendered.push({ s, html });
  }
  let delay = 120;
  const block = (r: { s: ReportSection; html: string }) => {
    delay += 110;
    return `<section class="aar-sec sec-${r.s.id}" data-id="${r.s.id}" style="--d:${delay}ms">${r.html}</section>`;
  };
  const left = rendered.filter((r) => r.s.col === "left").map(block).join("");
  const right = rendered.filter((r) => r.s.col !== "left").map(block).join("");
  endEl.hidden = false;
  endEl.innerHTML = `
    <div class="panel aar ${ctx.spectator ? "spec" : ctx.won ? "won" : "lost"}">
      <header class="aar-sec aar-head" style="--d:0ms">${headHtml(ctx)}</header>
      <div class="aar-cols"><div class="aar-col l">${left}</div><div class="aar-col r">${right}</div></div>
      <div class="aar-actions${o.actions?.length ? " more" : ""}">
        ${(o.actions ?? []).map((a) => `<button id="${a.id}" class="cta ${a.cls ?? ""}">${escapeHtml(a.label)}</button>`).join("")}
        <button id="again" class="cta${o.actions?.length ? " alt" : ""}">${escapeHtml(o.rematchLabel ?? "↻ Rematch")}</button>
        <button id="menu" class="cta alt">Main menu</button>
      </div>
    </div>`;
  // moment texts may carry callsigns or names: set as text, not markup
  endEl.querySelectorAll<HTMLElement>(".aar-moments li").forEach((li) => {
    const m = ctx.moments[Number(li.dataset.i)];
    const mx = li.querySelector<HTMLElement>(".mx");
    if (m && mx) mx.textContent = m.text;
  });
  const select = (i: number | null) => {
    endEl.querySelectorAll<HTMLElement>(".aar-moments li").forEach((li) => li.classList.toggle("on", Number(li.dataset.i) === i));
    endEl.querySelectorAll<SVGGElement>(".aar-svg .mk").forEach((g) => g.classList.toggle("on", Number(g.dataset.i) === i));
  };
  const chartEl = endEl.querySelector<HTMLElement>(".sec-chart");
  if (chartEl) mountChart(chartEl, ctx, select);
  endEl.querySelectorAll<HTMLElement>(".aar-moments li").forEach((li) =>
    li.addEventListener("click", () => {
      const i = Number(li.dataset.i);
      select(li.classList.contains("on") ? null : i);
    })
  );
  for (const r of rendered) {
    const el = endEl.querySelector<HTMLElement>(`.aar-sec[data-id="${r.s.id}"]`);
    if (el && r.s.mount) r.s.mount(el, ctx);
  }
  for (const a of o.actions ?? []) endEl.querySelector(`#${a.id}`)?.addEventListener("click", a.on);
  endEl.querySelector("#again")!.addEventListener("click", o.onRematch);
  endEl.querySelector("#menu")!.addEventListener("click", o.onMenu);
}
