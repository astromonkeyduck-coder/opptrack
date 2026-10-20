import { existsSync } from "node:fs";
import { dispatchDueSources } from "../lib/ingestion";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
try {
  console.log(JSON.stringify({ mode: "direct-local-worker; Trigger Cloud execution is separate", results: await dispatchDueSources() }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : "Dispatcher failed");
  process.exitCode = 2;
}
