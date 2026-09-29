import { App, LogLevel, SocketModeReceiver, type Logger } from "@slack/bolt";
import type { BotDef } from "../bots/types";
import type { DemoConfig } from "../core/config";
import { redact } from "../core/redact";
import { readThread } from "../clients/slack";
import { classify, type SlackMessage } from "./classify";
import type { Dispatcher } from "./dispatch";

function redactingLogger(values: string[]): Logger {
  let level = LogLevel.WARN;
  const w = (s: string) => (...msg: unknown[]) => process.stderr.write(`${s} ${redact(msg.map(String).join(" "), values)}\n`);
  return {
    debug: () => undefined,
    info: () => undefined,
    warn: w("[warn]"),
    error: w("[error]"),
    setLevel: (l: LogLevel) => {
      level = l;
    },
    getLevel: () => level,
    setName: () => undefined,
  };
}

function normalize(e: any): SlackMessage {
  return { channel: e.channel, ts: e.ts, thread_ts: e.thread_ts ?? null, user: e.user ?? null, bot_id: e.bot_id ?? null, subtype: e.subtype, text: e.text ?? "" };
}

/** One Bolt app per Socket Mode bot (Req 8); `connected` feeds the heartbeat (Req 32). */
export async function startSlackApp(
  def: BotDef,
  deps: {
    botToken: string;
    appToken: string;
    config: DemoConfig;
    botIds: Record<string, string>;
    dispatcher: Dispatcher;
    redactionValues: string[];
    issueLabels(key: string): Promise<string[]>;
    onConnected(v: boolean): void;
  },
) {
  const logger = redactingLogger(deps.redactionValues);
  const receiver = new SocketModeReceiver({ appToken: deps.appToken, logLevel: LogLevel.WARN, logger });
  const app = new App({ token: deps.botToken, receiver, logLevel: LogLevel.WARN, logger });
  const handle = async (event: any) => {
    const msg = normalize(event);
    const matches = await classify(msg, {
      config: deps.config,
      botIds: deps.botIds,
      bots: [def.name],
      threadOf: async (_bot, channel, ts) => (await readThread({ slack: app.client, config: deps.config, botIds: deps.botIds }, { channel, ts })).messages,
      issueLabels: deps.issueLabels,
    });
    for (const m of matches) void deps.dispatcher.enqueue(m).catch((e) => process.stderr.write(`${redact(String(e?.message ?? e), deps.redactionValues)}\n`));
  };
  app.event("app_mention", async ({ event }) => handle(event));
  if (def.name !== "doc-manager") app.event("message", async ({ event }) => handle(event));
  receiver.client.on("connected", () => deps.onConnected(true));
  receiver.client.on("disconnected", () => deps.onConnected(false));
  await app.start();
  deps.onConnected(true);
  return app;
}
