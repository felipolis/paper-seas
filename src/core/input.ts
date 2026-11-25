/** Keyboard + wheel state, polled once per frame by the game loop. */
export class Input {
  private readonly down = new Set<string>();
  private readonly pressed = new Set<string>();
  private readonly tapped = new Set<string>();
  /** The key pressed with no other since (a lone tap, if it is let go before another goes down). */
  private alone: string | null = null;
  private wheel = 0;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      this.down.add(e.code);
      this.pressed.add(e.code);
      this.alone = this.down.size === 1 ? e.code : null;
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      if (this.alone === e.code) this.tapped.add(e.code);
      this.alone = null;
    });
    target.addEventListener('blur', () => this.down.clear());
    target.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); }, { passive: true });
  }

  isDown(...codes: string[]): boolean {
    return codes.some((c) => this.down.has(c));
  }

  wasPressed(...codes: string[]): boolean {
    return codes.some((c) => this.pressed.has(c));
  }

  /** A lone tap of one of these keys this frame: pressed and let go with no other key down meanwhile. */
  wasTapped(...codes: string[]): boolean {
    return codes.some((c) => this.tapped.has(c));
  }

  /** Wheel notches since the last frame (positive = zoom out). */
  takeWheel(): number {
    const w = this.wheel;
    this.wheel = 0;
    return w;
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.pressed.clear();
    this.tapped.clear();
  }
}
