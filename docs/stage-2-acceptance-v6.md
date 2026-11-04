# Version 6 acceptance controls

V5 was withdrawn after synthetic engineering review found native cross-pass title, clock and price/eligibility conflicts. No real holdout source prediction or gold score occurred. The original v5 freeze, template, protocol and entrypoints remain unchanged. All40 original artifact hashes reproduce at commit `0a72e71c8a1b3d7a36eee246747942a0275c1a43`; later shared contract/version updates mean the old freeze must not be presented as verified against the changed checkout. The separate withdrawal record preserves this history.

V6 uses a new runner factory and thin versioned CLI, reusing the unchanged guards, matcher, scorer, canonical projection, source transform3→2 and native-media2. Its binding includes text-v6, structured-v6, media-v6 and all reachable historical dependencies. The v5 protocol's candidate prose remains historical; the v6 freeze's explicit candidate ID and runner binding select v6. Thresholds and human requirements are unchanged.

```sh
node --import tsx scripts/stage2-acceptance-v6.ts freeze TEMPLATE.json evaluation/NEW-FREEZE-V6.json
node --import tsx scripts/stage2-acceptance-v6.ts check-freeze evaluation/NEW-FREEZE-V6.json
node --import tsx scripts/stage2-acceptance-v6.ts bind-confirmed-rules evaluation/NEW-FREEZE-V6.json private/stage2-acceptance-human-review/v6/CONFIRMED-RULES.json
```

The new template remains `templateOnly=true`. Its implementation-ready flag records synthetic control checks; it is not a real freeze or acceptance. Actual freeze creation reads only sealed integrity-manifest metadata plus code and version metadata. It neither opens source records/assets nor generates predictions. The six representation rules may bind to a new freeze using their original confirmation record and recorded time; no new human review time is invented.

Family/exposure review is separate. The existing v5 worksheet's100-case roster may support a later explicit binding if it is unchanged, but no future family approval or factual annotation carries automatically. Resolve rejected/uncertain groups and prior exposure before direct human annotation. No source-view export, candidate run, prediction or gold score is authorized by creating a freeze or binding the six rules.

After the required independent human family review, a curator may prepare authenticated source views for direct annotation. Independent human factual annotation precedes source-only prediction and the exclusive one-shot score. The CLI exposes these operations explicitly; none runs implicitly. It keeps exclusive private outputs, resolved credential/source-path restrictions, parse-error redaction and the original cohort-keyed claim boundary. Local native environment checks do not establish Cloud OCR equivalence.

All new control tests use synthetic data. Stage2 remains unaccepted; no paid upgrade, model inference, Meta repair, external delivery, later stage or Calendar action follows.
