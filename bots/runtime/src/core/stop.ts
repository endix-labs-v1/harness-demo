import { existsSync } from "node:fs";
import { stopFile } from "./paths";

/** SYS §4.3 step 2, SEC §7: `touch ~/.endix-demo/STOP` makes every bot ignore events. */
export function stopRequested(): boolean {
  return existsSync(stopFile());
}
