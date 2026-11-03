# Bounded local model comparison proposal

This is a proposal, not an enabled provider or completed comparison. Existing project instructions require separate model configuration authorization and prohibit model API spending. The November 2/3 continuation may finish engineering checks without changing those boundaries.

Use the public, ungated `onnx-community/Qwen2.5-0.5B-Instruct` model at revision `516c8d04add8a80c5228f32102b57953b8d421a9`, with its q4 ONNX file (786 MB, SHA-256 `09235a3b1c135cd04ef570e5053b5c079e028078a2cc5f76ba6a251e91bf3296`). Use pinned Transformers.js 3.8.1 and its regular Node CPU backend in a separate ignored private directory. Download only required model/tokenizer/config files; stop if the selected model assets exceed 900 MB. Do not load remote custom code or install a production dependency, daemon, cloud service or paid API.

Run two fixed, versioned prompts on the same ten already owner-reviewed development inputs: schema-first extraction and evidence-first extraction. Each must return typed event/action/resource facts and exact source quotations; unknown or disputed values stay null. Generated output is untrusted data, parsed and schema/evidence-validated, never tools or commands. No private user captures, browser credentials, account tokens or calendar data go to Hugging Face: only public model artifacts are downloaded, with inference local. Generation stays outside the deployed app/worker.

Bound each generation to 384 output tokens and 60 seconds, with at most 20 generations and a 20-minute total CPU-time attempt. Record exact artifact/prompt hashes, parse/schema/evidence failures, facts recovered, unscored predictions, omissions, wall time and bytes. Stop and report failure if the local backend is unsupported or too slow; do not switch to a paid provider. Existing platform builds/SQL/storage and local electricity remain unmeasured, so zero API charges is not zero total project cost.

This small development comparison cannot supply missing human labels, an independent holdout, semantic adjudication or a passing accuracy gate. It cannot authorize extraction promotion or Calendar additions.

Primary sources checked November 3, 2026: [pinned model artifact and size/hash](https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct/blob/516c8d04add8a80c5228f32102b57953b8d421a9/onnx/model_q4.onnx), [quantized inference](https://huggingface.co/docs/transformers.js/v3.8.1/en/guides/dtypes), [Node inference](https://huggingface.co/docs/transformers.js/v3.8.1/en/tutorials/node).
