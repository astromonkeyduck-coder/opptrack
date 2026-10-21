import { task } from "@trigger.dev/sdk";
import { diagnoseInstagramAccess } from "../lib/instagram/access-diagnostic";
import { collectInstagram } from "../lib/instagram/collector";

/** Manual only. Uses the worker's existing secret without returning it or private Graph payloads. */
export async function runInstagramAccessCheck(options: { environment?: Record<string, string | undefined>; fetch?: typeof fetch; now?: () => Date } = {}) {
  const environment = options.environment ?? process.env;
  const diagnostic = await diagnoseInstagramAccess({ environment, fetch: options.fetch, now: options.now });
  if (diagnostic.status !== "success") return { diagnostic, targetCheck: null, automaticMonitoringRepaired: false };
  const sample = await collectInstagram("instagram-clubdownunderfsu", { environment, fetch: options.fetch, now: options.now });
  return {
    diagnostic,
    targetCheck: {
      handle: "clubdownunderfsu", status: sample.status, failureCategory: sample.failureCategory,
      requests: sample.observations.requests, responseBytes: sample.observations.bytes,
      httpStatuses: sample.observations.httpStatuses, validatedParentPosts: sample.updates.length,
    },
    automaticMonitoringRepaired: false,
  };
}

// No cron, database mutation, token refresh, new scopes, paid connector or calendar action.
export const instagramAccessCheck = task({
  id: "instagram-access-check",
  queue: { name: "instagram-access-check", concurrencyLimit: 1 },
  maxDuration: 60,
  retry: { maxAttempts: 1 },
  run: async () => runInstagramAccessCheck(),
});
