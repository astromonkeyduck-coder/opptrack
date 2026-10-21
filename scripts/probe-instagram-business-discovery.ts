/** Bounded, manual READ-ONLY preflight. Never enables a collector or schedule. */
import { readFile } from "node:fs/promises";
import { parseEnv } from "node:util";
import { initializeProbeEnvironment, preflightBusinessDiscovery, probeEnvironmentFilename, writePreflightEvidence } from "../lib/instagram/business-discovery-preflight";

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--help") {
    console.log("Usage: node --import tsx scripts/probe-instagram-business-discovery.ts --target=WATCHLIST_HANDLE [--max-pages=1] [--max-requests=1] [--page-size=5]");
    console.log("Or --initialize-env: exclusively create empty ignored credential placeholders; never reads existing values.");
    return;
  }
  if (args.length === 1 && args[0] === "--initialize-env") {
    const state = await initializeProbeEnvironment();
    console.log(JSON.stringify({ status: "setup_needed", environmentFile: state, requests: 0, credentialValuesRead: false }));
    return;
  }
  const values = new Map<string, string>();
  for (const argument of args) {
    const match = argument.match(/^--(target|max-pages|max-requests|page-size)=([^\s]+)$/);
    if (!match || values.has(match[1])) throw new Error("Invalid probe arguments");
    values.set(match[1], match[2]);
  }
  if (!values.has("target")) throw new Error("Select one handle from the user watchlist");
  const integer = (name: string) => { const value = values.get(name); if (value !== undefined && !/^\d+$/.test(value)) throw new Error("Invalid probe limit"); return value === undefined ? undefined : Number(value); };
  let environment: Record<string, string | undefined> = {};
  try { environment = parseEnv(await readFile(probeEnvironmentFilename, "utf8")); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw new Error("Private probe environment could not be read"); }
  const result = await preflightBusinessDiscovery({ target: values.get("target")!, environment, maxPages: integer("max-pages"), maxRequests: integer("max-requests"), pageSize: integer("page-size") });
  let files = 0;
  try { files = (await writePreflightEvidence(result)).filesWritten; }
  catch { console.log(JSON.stringify({ status: "failed", reasonCodes: ["private_diagnostic_write_failed"], requests: result.summary.requests })); process.exitCode = 1; return; }
  const { status, reasonCodes, missingVariables, requests, pages, responseBytes, httpStatuses, graphError, counts, accessSampleProven, paginationComplete } = result.summary;
  console.log(JSON.stringify({ status, reasonCodes, missingVariables, requests, pages, responseBytes, httpStatuses, graphError, counts, accessSampleProven, paginationComplete, sampleOnly: true, privateDiagnosticFilesWritten: files, automaticMonitoringEnabled: false }));
  process.exitCode = status === "success_sample" ? 0 : status === "setup_needed" ? 2 : status === "failed" ? 1 : 3;
}

main().catch(() => { console.log(JSON.stringify({ status: "failed", reasonCodes: ["probe_configuration_or_local_io_error"], credentialValuesLogged: false })); process.exitCode = 1; });
