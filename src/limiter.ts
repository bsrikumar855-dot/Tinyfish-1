/** Agent: max 2 concurrent runs. Fetch: max 150 URLs per rolling minute. */
export class Semaphore {
  private q: (() => void)[] = [];
  private n = 0;
  constructor(private max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.n >= this.max) await new Promise<void>((r) => this.q.push(r));
    this.n++;
    try { return await fn(); } finally { this.n--; this.q.shift()?.(); }
  }
}

export class WindowLimiter {
  private stamps: number[] = [];
  constructor(private max: number, private windowMs: number) {}
  async take(count: number): Promise<void> {
    for (;;) {
      const now = Date.now();
      this.stamps = this.stamps.filter((t) => now - t < this.windowMs);
      if (this.stamps.length + count <= this.max) { for (let i = 0; i < count; i++) this.stamps.push(now); return; }
      await new Promise((r) => setTimeout(r, Math.max(250, this.windowMs - (now - this.stamps[0]))));
    }
  }
}
