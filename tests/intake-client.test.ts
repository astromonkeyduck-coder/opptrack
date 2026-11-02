import assert from 'node:assert/strict';
import { test } from 'node:test';
import { intakeFailureMessage, readIntakeResponse } from '../lib/intake/client';
import { IntakeValidationError } from '../lib/intake/validation';

const id = '00000000-0000-4000-8000-000000000001';

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
