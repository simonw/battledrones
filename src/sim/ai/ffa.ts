import { isMulti } from "../sides";
import type { World } from "../types";

/**
 * The commander's free-for-all tactics (FFA.md "The AI against three
 * rivals"): what it does differently with three rivals, beyond picking a
 * focus. Four AIs on Compass Rose under the Goliath Armada played on for an
 * hour after one side had plainly won by 12:00 — its walking Goliaths parked
 * at the staging point, its army stood guard beside them or trickled into
 * the rivals' Goliath rings a few units at a time, and its income went on
 * garrison squads for a mined-out map — so a free-for-all commander:
 *
 * - PUSH: marches its walking Goliaths, its army behind the lead one, on the
 *   focus's base (its base Goliath; its HQ in a classic free-for-all) once
 *   they outgun what holds it (ai/goliath.ts planPush), and holds the focus
 *   while they do;
 * - COMPANY: counts its other walking Goliaths as the company a Goliath
 *   walking with the waves needs deep in their ground;
 * - WAVE HYGIENE: aims a wave at the focus's own buildings, never another
 *   rival's, and counts a Goliath toward a wave only when it walks with the
 *   waves and a real wave stands beside it;
 * - ESCORT TRIM: stands down the part of a Goliath's escort beyond what it
 *   wants (all of it once the Goliath is home), unless the Goliath walks
 *   with the waves;
 * - DRY ECONOMY: once the map is mined out, stops building Harvesters and
 *   garrison squads, and scouts less while it sees every rival's base;
 * - CALLDOWN AIM (off): aims the Sky Hammer and the Barrage by the damage
 *   they would do (a full-health Goliath shrugs off a Hammer), and at the
 *   push's target once its Goliaths are there. It reads well but plays
 *   worse: today's Hammers, aimed at the costliest clump, land on the same
 *   Goliath from every side and finish the hurt ones, and with the aim on
 *   the replay's lineup and four others took longer to close (18.7 min on
 *   average without it against 21.1 with it, faster in 14 of 20 paired
 *   games), so it stays off until it is tuned.
 *
 * The push, wave hygiene, the escort trim and the calldown aim wait for
 * GOLIATH_AI.lateSiege (12:00, ai/goliath.ts pastLateSiege): they are for
 * the stalemate, and the opening's four-way brawl plays as it always has.
 * (Turned on from 0:00, the last three reshuffled the brawl — every army
 * spent by the drain, no side with the edge to push — and the replay's
 * lineup and a mixed one, 11 seeds, went from 11 decided by 35:00 with the
 * push alone to 7; from 12:00, 11 of 11 again.)
 *
 * None of it touches a two-player match: each applies only in a world of
 * more than two sides (ffaTactic). The switches are for tests and tools,
 * which turn one off (or the calldown aim on) to measure what it does. Every page
 * of an online battle runs the commanders on the same world (FFA.md "The
 * turn log"), so nothing in the game may change them: a page with a switch
 * flipped would order different things and fall out of sync.
 */
export const FFA_TACTICS = {
  /** Walking Goliaths march on the focus's base Goliath once they and the army outgun what holds it (no-HQ rules: Armada, Nomads). */
  push: true,
  /**
   * …and in a free-for-all with HQs, on the focus's HQ (its base Goliath once its HQ is gone); `push`
   * must be on too. (Three classic seeds that ran to 40:00 undecided or nearly: all three decided with it, one without.)
   */
  pushHq: true,
  /** A Goliath walking with the waves counts our other walking Goliaths near it as company. */
  company: true,
  /** Waves go at the focus's own buildings; a Goliath counts toward a wave only when it walks with one. */
  waveHygiene: true,
  /** The escort of a Goliath not walking with the waves stands down beyond what it wants. */
  escortTrim: true,
  /** A mined-out map: no Harvesters, no garrison squads, fewer Scouts. */
  dryEconomy: true,
  /** The Sky Hammer and the Barrage aim by the damage they'd do, and at the push's target. (Off: it slowed the close.) */
  calldownAim: false
};

export type FfaTactic = keyof typeof FFA_TACTICS;

/** Is free-for-all tactic `t` in play: a world of more than two sides, and its switch on? */
export const ffaTactic = (w: World, t: FfaTactic): boolean => FFA_TACTICS[t] && isMulti(w);
