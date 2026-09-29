// The person-line guard (W-12, SYS §5.0). This file has no import statement at all,
// so endix-entry-slack can bundle it through its one-line re-export (T10).

export type PersonLineRefusal = { refused: true; wall: "W-12"; start: string; message: string };

export const W12_RULES = "OPS-F2-33, OPS-F4-10, OPS-F5-11, OPS-F6-11, OPS-F7-16";

// SYS §5.0 trim set: whitespace, ">", "&gt;", "*", "_", straight and curly quotes.
const LEAD = /^(?:\s|&gt;|[>*_"'“”‘’])+/;
const TRAIL = /(?:\s|&gt;|[>*_"'“”‘’])+$/;

const WHOLE = /^(go|no|ok|okay|approved?|lgtm)([.!]?)$/i;
const PREFIX = /^(go|later|no|answer|done|move|drop|stop|ok)\s*:/i;
const CLOSING = /^(answered|led to|parked|dropped|reopened)\s*:/i;

export function trimForGuard(text: string): string {
  let current = text;
  for (;;) {
    const next = current.replace(LEAD, "").replace(TRAIL, "");
    if (next === current) return next;
    current = next;
  }
}

export function personLineStart(text: string): string | null {
  const t = trimForGuard(text);
  const whole = WHOLE.exec(t);
  if (whole) return whole[1];
  const prefix = PREFIX.exec(t) ?? CLOSING.exec(t);
  if (prefix) return `${prefix[1]}:`;
  return null;
}

export function w12Message(start: string): string {
  return `Refused by the harness (W-12, ${W12_RULES}): only Henry or 서준 post "${start}". Ask them in the thread.`;
}

export function guardPersonLine(text: string): PersonLineRefusal | null {
  const start = personLineStart(text);
  if (start === null) return null;
  return { refused: true, wall: "W-12", start, message: w12Message(start) };
}

// DICT §4, the Slack closing lines: the only way a closing line passes the guard.
export const CLOSING_FORMATS: { close_thread: RegExp[] } = {
  close_thread: [
    /^Answered: \S.*$/,
    /^Led to: END-\d+(, END-\d+)*$/,
    /^Parked: \S.*$/,
    /^Later: END-\d+ · revisit \d{4}-\d{2}-\d{2} · Henry: https:\/\/\S+$/,
    /^Dropped: \S.* · Henry: https:\/\/\S+$/,
  ],
};

export function guardClosingLine(text: string, formats: RegExp[]): PersonLineRefusal | null {
  if (formats.some((f) => f.test(text))) return null;
  return guardPersonLine(text);
}
