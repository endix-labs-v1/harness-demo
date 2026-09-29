/** `M H * * *` only (Req 25); anything else is a start error. */
export function parseDaily(schedule: string): { minute: number; hour: number } {
  const m = /^(\d{1,2}) (\d{1,2}) \* \* \*$/.exec(schedule.trim());
  if (!m || Number(m[1]) > 59 || Number(m[2]) > 23) throw new Error(`checker.schedule must be "M H * * *"; it is "${schedule}".`);
  return { minute: Number(m[1]), hour: Number(m[2]) };
}

const OFFSETS: Record<string, number> = { "Asia/Seoul": 9 * 60 };

/** The next time `M H * * *` comes in the timezone (Asia/Seoul: +09:00, no daylight saving). */
export function nextDailyRun(schedule: string, timezone = "Asia/Seoul", now: Date = new Date()): Date {
  const { minute, hour } = parseDaily(schedule);
  const offsetMin = OFFSETS[timezone];
  if (offsetMin === undefined) throw new Error(`timezone ${timezone} is not supported; the demo runs on Asia/Seoul.`);
  const local = new Date(now.getTime() + offsetMin * 60_000);
  const candidate = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hour, minute) - offsetMin * 60_000;
  return new Date(candidate > now.getTime() ? candidate : candidate + 24 * 60 * 60 * 1000);
}

/** Fires `run` at each next daily time until stopped. */
export function scheduleChecker(schedule: string, timezone: string, run: () => void | Promise<unknown>) {
  let timer: NodeJS.Timeout | null = null;
  const arm = () => {
    const ms = nextDailyRun(schedule, timezone).getTime() - Date.now();
    timer = setTimeout(async () => {
      try {
        await run();
      } finally {
        arm();
      }
    }, ms);
  };
  arm();
  return {
    stop() {
      if (timer) clearTimeout(timer);
    },
  };
}
