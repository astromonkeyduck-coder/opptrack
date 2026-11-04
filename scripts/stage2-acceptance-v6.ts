/** Explicit v6-only CLI. Immutable v5 entrypoints remain available for historical checkouts. */
import { v6AcceptanceRunner } from '../evaluation/stage2-acceptance-runner-v6';
import { runAcceptanceCli } from '../evaluation/stage2-acceptance-versioned-cli';
process.env.TZ='UTC';process.env.LANG='C';process.env.LC_ALL='C';
process.exitCode=await runAcceptanceCli({runner:v6AcceptanceRunner,argv:process.argv.slice(2)});
