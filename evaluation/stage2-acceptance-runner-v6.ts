/** Version6 candidate binding; v5 runner/control/protocol bytes remain archived unchanged. */
import { extractCandidates } from '../lib/extraction/text-v6';
import { createAcceptanceRunner } from './stage2-acceptance-runner-factory';
export const v6AcceptanceRunner=createAcceptanceRunner({
 candidateId:'native-v6-local-deterministic',runnerPath:'evaluation/stage2-acceptance-runner-v6.ts',cliPath:'scripts/stage2-acceptance-v6.ts',
 runtimeArtifacts:['lib/extraction/text-v5.ts','lib/extraction/text-v6.ts','lib/extraction/text-media-v6.ts','lib/extraction/structured-v6.ts','lib/extraction/text-media-v5.ts','lib/extraction/structured-v5.ts'],
 engine:'native-v6/source-only-text-v3/native-media-v2',extractCandidates:units=>extractCandidates(units,{}),
});
export const {candidateId:ACCEPTANCE_NATIVE_CANDIDATE,requiredArtifacts:ACCEPTANCE_REQUIRED_ARTIFACTS,bindingPaths:ACCEPTANCE_BINDING_PATHS,assertBinding:assertFinalAcceptanceBinding,assertProtocol:assertFinalAcceptanceProtocol,generate:generateAcceptancePredictionSeal,score:runFrozenAcceptance}=v6AcceptanceRunner;
