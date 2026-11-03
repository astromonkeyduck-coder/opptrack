import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { test } from 'node:test';

test('deployed v1 extraction source stays byte-identical when the current implementation changes', async () => {
  const archived = await readFile(new URL('../lib/extraction/text-v1.ts', import.meta.url));
  assert.equal(createHash('sha256').update(archived).digest('hex'), '2dc5376957c301ff56bc302ec60efdef2e96061922a5a75e86b60749b9c79c4a');
});
