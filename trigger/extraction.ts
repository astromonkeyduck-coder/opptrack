import { task } from '@trigger.dev/sdk';
import { nativeMediaReadiness } from '../lib/extraction/media';
import { runExtractionDispatcher } from '../lib/extraction/worker';
import { publicPdfProbe } from '../lib/extraction/public-probe';

/** Operator smoke/readiness only. Queued private work is claimed under the same SQL budgets. */
export const extractionDispatcher=task({id:'opportunity-extraction',queue:{name:'opportunity-extraction',concurrencyLimit:1},maxDuration:240,retry:{maxAttempts:1},
  run:async(payload:{readinessOnly?:boolean;publicPdfProbe?:boolean})=>payload?.readinessOnly?{readiness:await nativeMediaReadiness(),databaseCalls:0}:payload?.publicPdfProbe?publicPdfProbe():runExtractionDispatcher(),
});
