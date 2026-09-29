/**
 * Per-thread queue (SYS §4.3 step 3): one run at a time per key, keys in parallel,
 * at most `cap` running per bot. A waiting run keeps its slot.
 */
export class ThreadQueue {
  private tails = new Map<string, Promise<void>>();
  private slots = new Map<string, number>();
  private waiters = new Map<string, Array<() => void>>();
  private counts = new Map<string, { queued: number; running: number }>();
  private pending = new Set<Promise<unknown>>();

  constructor(private cap = 3) {}

  stats(bot: string): { queued: number; running: number } {
    const c = this.counts.get(bot);
    return c ? { ...c } : { queued: 0, running: 0 };
  }

  private count(bot: string) {
    let c = this.counts.get(bot);
    if (!c) {
      c = { queued: 0, running: 0 };
      this.counts.set(bot, c);
    }
    return c;
  }

  private acquire(bot: string): Promise<void> {
    const used = this.slots.get(bot) ?? 0;
    if (used < this.cap) {
      this.slots.set(bot, used + 1);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const list = this.waiters.get(bot) ?? [];
      list.push(resolve);
      this.waiters.set(bot, list);
    });
  }

  private release(bot: string): void {
    const list = this.waiters.get(bot);
    const next = list?.shift();
    if (next) next(); // the slot passes on
    else this.slots.set(bot, Math.max(0, (this.slots.get(bot) ?? 1) - 1));
  }

  run<T>(bot: string, key: string, fn: () => Promise<T>): Promise<T> {
    const c = this.count(bot);
    c.queued++;
    const prev = this.tails.get(key) ?? Promise.resolve();
    const p = prev
      .then(() => this.acquire(bot))
      .then(async () => {
        c.queued--;
        c.running++;
        try {
          return await fn();
        } finally {
          c.running--;
          this.release(bot);
        }
      });
    const tail = p.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    this.pending.add(tail);
    void tail.then(() => {
      this.pending.delete(tail);
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return p;
  }

  /** Resolves when every queued run has ended, or after `ms`. */
  async drain(ms: number): Promise<void> {
    const all = Promise.all([...this.pending]);
    await Promise.race([all, new Promise((r) => setTimeout(r, ms).unref?.())]);
  }
}
