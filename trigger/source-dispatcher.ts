import { schedules } from "@trigger.dev/sdk";
import { runDispatcherHandler } from "../lib/collection/dispatcher";

/** One durable dispatcher. SQL atomically leases only enabled, due sources. */
export const sourceDispatcher=schedules.task({
  id:"opportunity-source-dispatcher",
  cron:{pattern:"*/15 * * * *",timezone:"UTC",environments:["DEVELOPMENT","PRODUCTION"]},
  queue:{name:"opportunity-source-dispatcher",concurrencyLimit:1},
  maxDuration:300,
  // Collection HTTP failures persist their own Retry-After/backoff in SQL. Only
  // infrastructure exceptions reach SDK retries, after the ten-minute lease expires.
  retry:{maxAttempts:3,factor:2,minTimeoutInMs:600_000,maxTimeoutInMs:900_000,randomize:true},
  run:async()=>runDispatcherHandler(),
});
