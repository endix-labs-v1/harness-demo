import { messageAt, parsePermalink } from "../../clients/slack";
import type { ToolContext } from "../define";

// A person's line behind a permalink (T7 Spec Req 5): the W-15 check of close and set_fields.

export interface PersonLine {
  text: string;
  author_name: string;
  permalink: string;
}

type Ctx = Pick<ToolContext, "slack" | "config"> & { reads?: ToolContext["reads"] };

/** The Slack user IDs of the people in config (Henry; 서준 when set). */
export function peopleSlackIds(config: ToolContext["config"]): string[] {
  const people = config.people as Record<string, { slack_user_id?: string } | undefined>;
  return Object.values(people)
    .map((p) => p?.slack_user_id ?? "")
    .filter((id) => !!id);
}

/**
 * Reads the message the permalink points to and passes only when a person in config
 * wrote it, its trimmed text starts with one of `starts` (any case), and it sits in
 * `thread` (same channel, same thread root). Null otherwise; never throws.
 */
export async function verifyPersonLine(ctx: Ctx, permalink: string | undefined | null, opts: { starts: string[]; thread: string | null }): Promise<PersonLine | null> {
  if (!permalink || !opts.thread) return null;
  let at: ReturnType<typeof parsePermalink>;
  let root: ReturnType<typeof parsePermalink>;
  try {
    at = parsePermalink(permalink);
    root = parsePermalink(opts.thread);
  } catch {
    return null;
  }
  if (at.channel !== root.channel) return null;
  let msg: Awaited<ReturnType<typeof messageAt>>;
  try {
    msg = await messageAt(ctx, permalink);
  } catch {
    return null;
  }
  const ids = peopleSlackIds(ctx.config);
  if (!msg.author.user_id || !ids.includes(msg.author.user_id)) return null;
  const text = msg.text.trim();
  const lower = text.toLowerCase();
  if (!opts.starts.some((s) => lower.startsWith(s.toLowerCase()))) return null;
  const msgRoot = msg.thread_ts ?? msg.ts;
  const threadRoot = root.threadTs ?? root.ts;
  if (msgRoot !== threadRoot) return null;
  return { text, author_name: msg.author.name, permalink };
}
