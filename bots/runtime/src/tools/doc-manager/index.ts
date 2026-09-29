// The doc manager's write tools, in SYS §5.4 order (T8 Spec Requirement 19).
import type { ToolDef } from "../define";
import { createPage } from "./create_page";
import { replaceText } from "./replace_text";
import { addChangeLogLine } from "./add_change_log_line";
import { addCheckedAgainst } from "./add_checked_against";
import { setFields } from "./set_fields";
import { listFeeds } from "./list_feeds";
import { callLogCreate } from "./call_log_create";
import { callLogUpdate } from "./call_log_update";
import { postReply } from "./post_reply";

export const docManagerWriteTools: ToolDef[] = [
  createPage,
  replaceText,
  addChangeLogLine,
  addCheckedAgainst,
  setFields,
  listFeeds,
  callLogCreate,
  callLogUpdate,
  postReply,
] as ToolDef<any>[];
