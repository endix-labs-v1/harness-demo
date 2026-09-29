// Every test runs on a temp ENDIX_HOME and the fixture config: no test writes under ~/.endix-demo.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

process.env.ENDIX_HOME = mkdtempSync(join(tmpdir(), "endix-home-"));
process.env.DEMO_CONFIG = resolve(__dirname, "..", "fixtures", "demo.config.json");
process.env.ENDIX_SECRETS = join(process.env.ENDIX_HOME, "no-secrets.env");
