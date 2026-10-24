// One Euro filter (Casiez, Roussel and Vogel, CHI 2012): a low-pass filter
// whose cutoff rises with speed. A still hand gets heavy smoothing, so
// landmark jitter cannot fake a turnaround; a beating hand gets almost none,
// so the ictus is not delayed or flattened.

const alpha = (cutoffHz: number, dtSec: number): number => {
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / dtSec);
};

export class OneEuroFilter {
  private x: number | null = null;
  private dx = 0;
  private t = 0;

  /**
   * @param minCutoff Hz at rest. 1.5 Hz removes the 1 to 3 px wobble of a held hand.
   * @param beta How fast the cutoff opens with speed (per frame height per second).
   *   At conducting speeds (1 to 3 frame heights a second) the cutoff sits at
   *   8 to 20 Hz, well above the 1 to 2.5 Hz of a beat pattern.
   * @param dCutoff Hz for the speed estimate itself. The paper's 1 Hz suits a
   *   pointer; a beat pattern reverses two or three times a second, so the
   *   speed estimate has to follow faster than that.
   */
  constructor(
    private readonly minCutoff = 1.5,
    private readonly beta = 6,
    private readonly dCutoff = 4,
  ) {}

  /** `t` in ms */
  filter(value: number, t: number): number {
    if (this.x === null) {
      this.x = value;
      this.t = t;
      return value;
    }
    const dt = Math.max(1e-3, (t - this.t) / 1000);
    this.t = t;
    const rawDx = (value - this.x) / dt;
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx);
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx);
    this.x += alpha(cutoff, dt) * (value - this.x);
    return this.x;
  }

  reset(): void {
    this.x = null;
    this.dx = 0;
  }
}
