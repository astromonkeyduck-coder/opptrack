import { task } from '@trigger.dev/sdk';
import { nativeMediaReadiness } from '../lib/extraction/media';
import { runExtractionDispatcher } from '../lib/extraction/worker';
import { publicPdfProbe } from '../lib/extraction/public-probe';
import { publicPdfProbeV6 } from '../lib/extraction/public-probe-v6';

/** Operator smoke/readiness only. Queued private work is claimed under the same SQL budgets. */
export const extractionDispatcher=task({id:'opportunity-extraction',queue:{name:'opportunity-extraction',concurrencyLimit:1},maxDuration:240,retry:{maxAttempts:1},
  run:async(payload:{readinessOnly?:boolean;publicPdfProbe?:boolean;publicPdfProbeV6?:boolean})=>payload?.readinessOnly?{readiness:await nativeMediaReadiness(),databaseCalls:0}:payload?.publicPdfProbeV6?publicPdfProbeV6():payload?.publicPdfProbe?publicPdfProbe():runExtractionDispatcher(),
});
