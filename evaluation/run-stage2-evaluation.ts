/** Score an existing runtime output file. This command never calls a model or remote service. */
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { evaluatePredictions, type EvaluationCorpus, type Prediction, type SplitManifest } from './stage2-evaluator';

const args = new Map(process.argv.slice(2).map(argument => {
  const separator = argument.indexOf('=');
  return separator < 0 ? [argument, ''] : [argument.slice(0, separator), argument.slice(separator + 1)];
}));
if (args.has('--help')) {
  console.log('node --import tsx evaluation/run-stage2-evaluation.ts --predictions=private/runtime-predictions.json --candidate=identifier [--output=reports/stage-2-evaluation.json]');
  console.log('Input is a JSON Prediction[] using evaluation/stage2-evaluator.ts. No network or provider calls. Exit 0: regression checks pass; exit 1: invalid input or regression failures. Stage 2 acceptance is reported separately and cannot be established without human-reviewed ground truth.');
  process.exit(0);
}
for (const [name, value] of args) if (!['--predictions', '--candidate', '--output'].includes(name) || !value) throw new Error('Use the documented --name=value arguments.');
if (!args.get('--predictions') || !args.get('--candidate')) throw new Error('A runtime prediction file and candidate identifier are required.');
const inputPath = path.resolve(args.get('--predictions')!);
if (statSync(inputPath).size > 5 * 1024 * 1024) throw new Error('Prediction file exceeds the bounded 5 MiB evaluation input limit.');
const predictions = JSON.parse(readFileSync(inputPath, 'utf8')) as Prediction[];
if (!Array.isArray(predictions)) throw new Error('Prediction file must contain an array.');
const corpus = JSON.parse(readFileSync('evaluation/stage2-cases.json', 'utf8')) as EvaluationCorpus;
const manifest = JSON.parse(readFileSync('evaluation/stage2-split-manifest.json', 'utf8')) as SplitManifest;
const result = evaluatePredictions(corpus, manifest, predictions, args.get('--candidate')!);
const output = path.resolve(args.get('--output') || 'reports/stage-2-evaluation.json');
if (!['private', 'reports'].some(directory => output.startsWith(path.resolve(directory) + path.sep))) throw new Error('Write sanitized evaluation results inside reports/ or private/.');
mkdirSync(path.dirname(output), { recursive: true });
writeFileSync(output, JSON.stringify({ recordedAt: new Date().toISOString(), ...result }, null, 2) + '\n', { mode: 0o600 });
console.log(JSON.stringify({ candidate: result.candidateId, cases: result.counts, regressionPassed: result.allRegressionCases.passedCases,
  regressionTotal: result.allRegressionCases.cases, fieldPrecision: result.allRegressionCases.fields.precision,
  eventRecall: result.allRegressionCases.events.recall, actionRecall: result.allRegressionCases.actions.recall,
  acceptance: result.acceptance, cost: result.cost }, null, 2));
process.exitCode = result.allRegressionCases.passedCases === result.allRegressionCases.cases ? 0 : 1;
