/**
 * Full screen where the platform allows it (Android/desktop; iOS Safari has
 * no Fullscreen API for arbitrary elements — the dvh layout covers it).
 *
 * Browsers grant full screen only inside a user gesture, and a page reload
 * drops it. Rematch, Retry, ▶ Next op, the Daily rematch and every Menu
 * button reload the page, so a reload made while full screen leaves a note
 * (sessionStorage) and the next page asks again on the first tap or key.
 * Engine-free; the browser surface is injectable for tests.
 */

const KEY = "battledrones.fullscreen";

export interface FullscreenEnv {
  doc: {
    documentElement: { requestFullscreen?: (opts?: FullscreenOptions) => Promise<void> };
    fullscreenElement?: Element | null;
  };
  win: Pick<Window, "addEventListener" | "removeEventListener">;
  /** sessionStorage, or null where storage is blocked. */
  storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> | null;
  reload(): void;
}

function browserEnv(): FullscreenEnv {
  let storage: FullscreenEnv["storage"] = null;
  try {
    storage = window.sessionStorage;
  } catch {
    /* blocked: no restore after a reload */
  }
  return { doc: document, win: window, storage, reload: () => reloadWithoutLink(window.location) };
}

/** Reload, leaving a replay's `?replay=` link behind (main.ts watchLinked): its Menu buttons mean the menu. */
export function reloadWithoutLink(loc: Pick<Location, "href" | "reload" | "assign">): void {
  const url = new URL(loc.href);
  if (!url.searchParams.has("replay")) return loc.reload();
  url.searchParams.delete("replay");
  url.searchParams.delete("follow");
  loc.assign(url.href);
}

/** Gestures that let a page request full screen (a touch counts on release). */
const GESTURES = ["pointerup", "keydown"] as const;

export class Fullscreen {
  /** Armed to re-request on the next gesture, or a request is in flight. */
  private pending = false;

  constructor(private env: () => FullscreenEnv = browserEnv) {}

  /** Ask for full screen (call inside a user gesture); quietly does nothing where unsupported or declined. */
  async enter(): Promise<void> {
    const { doc } = this.env();
    if (doc.fullscreenElement || !doc.documentElement.requestFullscreen) return;
    this.pending = true;
    try {
      await doc.documentElement.requestFullscreen({ navigationUI: "hide" });
    } catch {
      /* declined or unsupported — fine */
    } finally {
      this.pending = false;
    }
  }

  /** Reload the page (a rematch or the menu), remembering whether the game was full screen. */
  reload(): void {
    const env = this.env();
    try {
      if (env.doc.fullscreenElement || this.pending) env.storage?.setItem(KEY, "1");
      else env.storage?.removeItem(KEY);
    } catch {
      /* ignore */
    }
    env.reload();
  }

  /** On page load: if the last page was full screen when it reloaded, ask again on the first tap or key. */
  restoreOnGesture(): void {
    const env = this.env();
    let wanted = false;
    try {
      wanted = env.storage?.getItem(KEY) === "1";
      env.storage?.removeItem(KEY);
    } catch {
      /* ignore */
    }
    if (!wanted || !env.doc.documentElement.requestFullscreen) return;
    this.pending = true;
    const onGesture = (e: Event) => {
      if (e.type === "keydown" && (e as KeyboardEvent).key === "Escape") return; // grants no activation
      for (const type of GESTURES) env.win.removeEventListener(type, onGesture, true);
      this.pending = false; // (enter() holds it again while its request is in flight)
      void this.enter();
    };
    // capture: runs before anything the gesture triggers (even a reload)
    for (const type of GESTURES) env.win.addEventListener(type, onGesture, true);
  }
}

/** The app's one full-screen keeper. */
export const fullscreen = new Fullscreen();
