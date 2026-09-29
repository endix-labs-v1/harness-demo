import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import type { BotDef } from "../bots/types";
import type { DemoConfig } from "../core/config";
import { botsDir } from "../core/paths";
import { nowSeoul } from "../core/time";
import type { EventMatch } from "../events/classify";
import { getIssue, type LinearFn } from "../clients/linear";
import { getPermalink, readThread } from "../clients/slack";
import type { WebClient } from "@slack/web-api";

const AuthorSchema = z.object({ name: z.string(), kind: z.string() });

export const PacketEventSchema = z.object({
  id: z.string(),
  channel: z.enum(["demo-lighthouse", "demo-questions", "demo-ideas"]).nullable(),
  ts: z.string().nullable(),
  thread_ts: z.string().nullable(),
  permalink: z.string().nullable(),
  author: AuthorSchema,
  text: z.string(),
});
export type PacketEvent = z.infer<typeof PacketEventSchema>;

const UmbrellaSchema = z.union([
  z.object({
    key: z.string(),
    title: z.string(),
    state: z.string().nullable(),
    labels: z.array(z.string()),
    description: z.string().nullable(),
    url: z.string().nullable(),
    due_date: z.string().nullable(),
    assignee: z.string().nullable(),
    children: z.array(z.object({ key: z.string(), title: z.string(), state: z.string().nullable() })),
  }),
  z.object({ key: z.string(), error: z.literal("not found") }),
]);

export const ContextPacketSchema = z.looseObject({
  bot: z.string(),
  now: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\+09:00$/),
  event: PacketEventSchema,
  thread: z.array(z.object({ ts: z.string(), author: AuthorSchema, text: z.string(), permalink: z.string() })),
  umbrellas: z.array(UmbrellaSchema),
  people: z.object({ Henry: z.object({ slack: z.string() }) }),
  steps: z.unknown(),
});
export type ContextPacket = z.infer<typeof ContextPacketSchema>;

const CHANNEL_NAMES = { lighthouse: "demo-lighthouse", questions: "demo-questions", ideas: "demo-ideas" } as const;

export function readSteps(): unknown {
  return JSON.parse(readFileSync(join(botsDir(), "data", "steps.json"), "utf8"));
}

export interface PacketDeps {
  def: BotDef;
  config: DemoConfig;
  slack: WebClient;
  /** The bot's own Linear token; the checker's read-only one for the doc manager. */
  linear?: LinearFn;
  botIds?: Record<string, string>;
  now?: () => Date;
}

function umbrellaOf(key: string, issue: any) {
  if (!issue) return { key, error: "not found" as const };
  return {
    key,
    title: issue.title ?? "",
    state: issue.state?.name ?? null,
    labels: (issue.labels?.nodes ?? []).map((l: any) => l.name),
    description: issue.description ?? null,
    url: issue.url ?? null,
    due_date: issue.dueDate ?? null,
    assignee: issue.assignee?.name ?? null,
    children: (issue.children?.nodes ?? []).map((c: any) => ({ key: c.identifier, title: c.title, state: c.state?.name ?? null })),
  };
}

/** The context packet (SYS §4.4, Req 11): everything the bot needs, fetched before the run. */
export async function buildPacket(match: EventMatch, deps: PacketDeps): Promise<ContextPacket> {
  const { def, config } = deps;
  const ctx = { slack: deps.slack, config, botIds: deps.botIds };
  let event: PacketEvent;
  let thread: ContextPacket["thread"] = [];
  if (match.id === "E16" || !match.channel || !match.ts) {
    event = {
      id: match.id,
      channel: null,
      ts: null,
      thread_ts: null,
      permalink: null,
      author: match.source === "schedule" ? { name: "schedule", kind: "schedule" } : { name: "npm run checker", kind: "manual" },
      text: "Checker pass",
    };
  } else {
    const permalink = match.permalink ?? (await getPermalink(ctx, match.channel, match.ts));
    event = {
      id: match.id,
      channel: match.role ? CHANNEL_NAMES[match.role] : null,
      ts: match.ts,
      thread_ts: match.thread_ts,
      permalink,
      author: { ...match.author },
      text: match.text,
    };
    thread = (await readThread(ctx, { channel: match.channel, ts: match.thread_ts ?? match.ts })).messages;
  }
  const keys = new Set<string>();
  for (const text of [event.text, ...thread.map((m) => m.text)]) for (const k of text.match(/END-\d+/g) ?? []) keys.add(k);
  const umbrellas: ContextPacket["umbrellas"] = [];
  for (const key of keys) {
    const issue = deps.linear ? await getIssue({ linear: deps.linear }, key).catch(() => null) : null;
    umbrellas.push(umbrellaOf(key, issue));
  }
  const packet: ContextPacket = {
    bot: def.name,
    now: nowSeoul(deps.now ? deps.now() : new Date()),
    event,
    thread,
    umbrellas,
    people: { Henry: { slack: config.people.henry.slack_user_id } },
    steps: readSteps(),
  };
  return packet;
}

/** The prompt: one line, an empty line, then the packet as a fenced JSON block (SYS §4.4). */
export function packetPrompt(packet: ContextPacket): string {
  return `Event for ${packet.bot}. Act only through your tools.\n\n\`\`\`json\n${JSON.stringify(packet, null, 2)}\n\`\`\``;
}
