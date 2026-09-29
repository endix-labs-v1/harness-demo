// start_task_thread (SYS §5.2, T6 Spec Req 8): one F7 task split from a post gets its own thread (OPS-F7-23).
import { z } from "zod";
import { defineTool } from "../define";
import { taskThreadText } from "./texts";
import { startThread } from "./threads";

export const startTaskThread = defineTool({
  name: "start_task_thread",
  description:
    "Start a new #demo-lighthouse thread for one F7 task split from a longer ask (OPS-F7-23): 'Task from <source_permalink>: <text>'. Queues nothing; the same run opens the task's umbrella with this thread. Holds W-12. Returns permalink and ts.",
  input: { text: z.string().min(1), source_permalink: z.string().min(1) },
  async handler(input, ctx) {
    return startThread(ctx, "lighthouse", taskThreadText(input.source_permalink, input.text));
  },
});
