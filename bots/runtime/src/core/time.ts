// Dates and times in Asia/Seoul (SYS §5.0). Seoul has no daylight saving: always +09:00.
const OFFSET_MS = 9 * 60 * 60 * 1000;

function shifted(d: Date): string {
  return new Date(d.getTime() + OFFSET_MS).toISOString();
}

export function nowSeoul(d: Date = new Date()): string {
  return `${shifted(d).slice(0, 19)}+09:00`;
}

export function todaySeoul(d: Date = new Date()): string {
  return shifted(d).slice(0, 10);
}

/** YYYYMMDDTHHmmss in Seoul, for run IDs. */
export function compactSeoul(d: Date = new Date()): string {
  return shifted(d).slice(0, 19).replace(/[-:]/g, "");
}

/** The instant of 00:00 on a YYYY-MM-DD day in Seoul. */
export function startOfDaySeoul(day: string): Date {
  return new Date(Date.parse(`${day}T00:00:00+09:00`));
}
