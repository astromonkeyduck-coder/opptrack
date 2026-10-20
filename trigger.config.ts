import { defineConfig } from "@trigger.dev/sdk";

// Verified existing project. This nonsecret default also supports managed GitHub builds.
const project=process.env.TRIGGER_PROJECT_REF ?? "proj_wurjjfgxnzhkvcewuaci";
if(!/^proj_[A-Za-z0-9]+$/.test(project))throw new Error("Set TRIGGER_PROJECT_REF to a valid non-secret Trigger project reference");

export default defineConfig({
  project,
  runtime:"node",
  dirs:["./trigger"],
  maxDuration:300,
  retries:{enabledInDev:false,default:{maxAttempts:3,factor:2,minTimeoutInMs:600_000,maxTimeoutInMs:900_000,randomize:true}},
  logLevel:"warn",
});
