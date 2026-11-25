/** Tiny typed event bus: systems announce what happened, the sound and the HUD listen. */

/** What is underfoot, as the footsteps hear it. */
export type StepSurface = 'grass' | 'path' | 'bridge';

export interface GameEvents {
  /**
   * Paper pieces started to rise / fold somewhere (height: the piece's upright height, world units; delay: seconds
   * until it actually moves; key: the gesture it belongs to, its cell: one sound per gesture, its largest piece
   * speaking).
   */
  paper: { x: number; z: number; height: number; up: boolean; delay?: number; key: string };
  /** A rise of the gesture `key` was called off before it started: its flap, if still waiting, stays silent. */
  paperCancel: { key: string };
  /** The sails were set or furled. */
  sails: { level: number };
  /** The voyage chart was unfolded or folded away. */
  chart: { open: boolean };
  /** The sound was muted or unmuted. */
  sound: { muted: boolean };
  /** The hull hit a shore. */
  bump: { strength: number };
  /** A foot of the captain came down ashore (foot 0 / 1), on this ground. */
  step: { surface: StepSurface; foot: 0 | 1 };
  /** A creature did something audible. */
  creature: { kind: 'spout' | 'splash' | 'kraken'; x: number; z: number };
  /** An island (or a stretch of continent coast) was seen up close for the first time. */
  discovered: { name: string; coast: boolean };
  /** A treasure chest was found. */
  treasure: { name: string };
  /** Something rare was seen (an easter egg): a toast with a title and a line. */
  marvel: { title: string; line: string };
  /** A message in a bottle was picked up. */
  bottle: { message: string };
}

type Handler<K extends keyof GameEvents> = (payload: GameEvents[K]) => void;

class EventBus {
  private readonly handlers = new Map<keyof GameEvents, Set<Handler<keyof GameEvents>>>();

  on<K extends keyof GameEvents>(type: K, handler: Handler<K>): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<keyof GameEvents>);
    return () => set.delete(handler as Handler<keyof GameEvents>);
  }

  emit<K extends keyof GameEvents>(type: K, payload: GameEvents[K]): void {
    const set = this.handlers.get(type);
    if (set) for (const h of set) (h as Handler<K>)(payload);
  }
}

export const bus = new EventBus();
