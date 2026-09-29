import type { ToolDef } from "../define";
import { close } from "./close";
import { comment } from "./comment";
import { createSteps } from "./create_steps";
import { fillDoneWhen } from "./fill_done_when";
import { link } from "./link";
import { postReply } from "./post_reply";
import { setFields } from "./set_fields";

/** The task manager's writes, in SYS §5.3 order (T7 Spec Req 14). */
export const taskManagerWriteTools: ToolDef[] = [createSteps, comment, setFields, link, fillDoneWhen, close, postReply] as unknown as ToolDef[];
