import { defineConfig } from "@trigger.dev/sdk";

const project=process.env.TRIGGER_PROJECT_REF;
if(!project||!/^proj_[A-Za-z0-9]+$/.test(project))throw new Error("Setup needed: set the non-secret TRIGGER_PROJECT_REF from your Trigger project before running its CLI");

export default defineConfig({
  project,
  runtime:"node",
  dirs:["./trigger"],
  maxDuration:300,
  retries:{enabledInDev:false,default:{maxAttempts:3,factor:2,minTimeoutInMs:600_000,maxTimeoutInMs:900_000,randomize:true}},
  logLevel:"warn",
});
