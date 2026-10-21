/** Manual read-only diagnosis. Never changes tokens, grants, database state or monitors. */
import { readFile, writeFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { diagnoseInstagramAccess } from "../lib/instagram/access-diagnostic";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node --import tsx scripts/diagnose-instagram-access.ts [--env-file=.env.instagram.probe.local|.env.instagram.repair.local]");
    console.log("Two bounded read-only Meta requests. Sanitized report only; no token value or private identity is printed."); return;
  }
  const filename = args[0]?.replace(/^--env-file=/, "") ?? ".env.instagram.probe.local";
  if (args.length > 1 || (args.length && args[0] !== `--env-file=${filename}`) || ![".env.instagram.probe.local", ".env.instagram.repair.local"].includes(filename)) throw Error("Invalid credential file selector");
  const environment = parseEnv(await readFile(filename, "utf8"));
  const result = await diagnoseInstagramAccess({ environment });
  const report = { ...result, credentialSource: filename === ".env.instagram.probe.local" ? "local_test_credential_not_assumed_to_match_production" : "private_repair_credential_production_match_must_be_verified", automaticMonitoringRepaired: false };
  await writeFile("reports/instagram-access-repair.json", JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report)); process.exitCode = result.status === "success" ? 0 : 2;
}
main().catch(() => { console.log(JSON.stringify({ status: "failed", reason: "diagnostic_local_io_or_configuration_failure", credentialValuesLogged: false })); process.exitCode = 1; });
