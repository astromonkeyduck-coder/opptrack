import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendIntakeFiles, clipboardIntakeFiles, IntakeSubmissionIdentity, intakeFailureMessage, readIntakeResponse, setIntakeFiles } from '../lib/intake/client';
import { IntakeValidationError, MAX_TOTAL_BYTES } from '../lib/intake/validation';

const id = '00000000-0000-4000-8000-000000000001';

// Client selection fixtures only; server validation still checks actual file bytes.
const selectedFile = (name: string, size = 10, type = 'image/png') => new File([new Uint8Array(size)], name, { type });

test('picker and clipboard additions preserve every file in order and multipart contains each once', () => {
  const first = selectedFile('first.png');
  const second = selectedFile('second.png');
  const third = selectedFile('third.png');
  const pdf = selectedFile('fourth.pdf', 10, 'application/pdf');
  let selected = appendIntakeFiles([], [first]);
  selected = appendIntakeFiles(selected, clipboardIntakeFiles({ files: { 0: second, 1: third, length: 2 } }));
  selected = appendIntakeFiles(selected, [pdf]);
  assert.deepEqual(selected, [first, second, third, pdf]);

  const data = new FormData();
  data.set('note', 'Keep these notes');
  data.append('files', first); // Even a residual native entry cannot double-submit.
  setIntakeFiles(data, selected);
  setIntakeFiles(data, selected); // Rebuilding an unchanged retry also replaces entries.
  const submitted = data.getAll('files') as File[];
  assert.deepEqual(submitted.map(file => file.name), ['first.png', 'second.png', 'third.png', 'fourth.pdf']);
  assert.deepEqual(submitted.map(file => file.size), [10, 10, 10, 10]);
  assert.equal(data.get('note'), 'Keep these notes');
});

test('ordinary text paste has no file selection or clipboard text side effects', () => {
  let textRead = false;
  const clipboard = { files: [] as File[], getData: () => { textRead = true; return 'Ordinary pasted notes'; } };
  assert.deepEqual(clipboardIntakeFiles(clipboard), []);
  assert.equal(textRead, false); // The form leaves this paste to its focused input.
});

test('mixed picker and paste enforce combined limits atomically without losing selected files', () => {
  const original = [selectedFile('picked.png', MAX_TOTAL_BYTES - 1)];
  assert.equal(appendIntakeFiles(original, [selectedFile('pasted.png', 1)]).length, 2);
  assert.throws(() => appendIntakeFiles(original, [selectedFile('too-large.png', 2)]), /combined files/);
  assert.equal(original.length, 1);
  const eight = Array.from({ length: 8 }, (_, index) => selectedFile(`slide-${index}.png`));
  assert.throws(() => appendIntakeFiles(eight, clipboardIntakeFiles({ files: [selectedFile('ninth.png')] })), /at most 8/);
  assert.equal(eight.length, 8);
  assert.throws(() => setIntakeFiles(new FormData(), [selectedFile('empty.png', 0)]), /nonempty/);
});

test('unchanged save retries retain identity while text or file edits require a fresh identity', () => {
  const identity = new IntakeSubmissionIdentity();
  let generated = 0;
  const createKey = () => `submission-${++generated}`;
  assert.equal(identity.forSubmission(createKey), 'submission-1');
  assert.equal(identity.forSubmission(createKey), 'submission-1'); // Unconfirmed response/transport retry.
  identity.edited(); // Link or note edit.
  assert.equal(identity.forSubmission(createKey), 'submission-2');
  assert.equal(identity.forSubmission(createKey), 'submission-2');
  identity.edited(); // File added, removed or replaced.
  assert.equal(identity.forSubmission(createKey), 'submission-3');
  assert.equal(generated, 3);
});

test('intake confirms a durable submission ID on new and idempotent responses', async () => {
  for (const status of [200, 201]) {
    assert.deepEqual(await readIntakeResponse(Response.json({ id }, { status })), { id });
  }
});

test('platform payload rejections have an actionable message without JSON parsing errors', async () => {
  const response = new Response('<html>Request Entity Too Large</html>', { status: 413 });
  await assert.rejects(readIntakeResponse(response), /each file and the combined files at or below 4 MiB/);
});

test('a confirmed upload can open only a same-app extraction UUID while a queue outage preserves its saved identity',async()=>{
  assert.deepEqual(await readIntakeResponse(Response.json({id,extractionJobId:id})),{id,extractionJobId:id});
  assert.deepEqual(await readIntakeResponse(Response.json({id,extractionJobId:'https://attacker.example/'})),{id});
  assert.deepEqual(await readIntakeResponse(Response.json({id,extractionState:'unavailable'})),{id,extractionUnavailable:true});
});

test('non-JSON platform failures and unconfirmed successes preserve safe retry guidance', async () => {
  for (const response of [
    new Response('Bad Gateway', { status: 502 }),
    new Response('<html>Function timeout</html>', { status: 200 }),
    Response.json({ id: 'not-a-durable-identity' }),
    Response.json({}),
  ]) {
    await assert.rejects(readIntakeResponse(response), /save could not be confirmed.*same submission/);
  }
});

test('known validation and authentication errors remain useful while arbitrary failures stay private', async () => {
  await assert.rejects(readIntakeResponse(Response.json({ error: 'Supported files must match their contents.' }, { status: 400 })), /Supported files must match/);
  await assert.rejects(readIntakeResponse(new Response('Unauthorized', { status: 401 })), /Sign in again/);
  assert.equal(intakeFailureMessage(new IntakeValidationError('Upload at most 8 files at a time.')), 'Upload at most 8 files at a time.');
  const message = intakeFailureMessage(new TypeError('Failed to fetch internal transport detail'));
  assert.match(message, /could not be reached.*same submission/);
  assert.equal(message.includes('internal transport detail'), false);
});
