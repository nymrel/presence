import { createServer } from 'node:http';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Presence } from '../src/client.js';

test('agents receive a rejected frame response instead of false completion', async (t) => {
  let accept = false;
  let updates = 0;
  const server = createServer((request, response) => {
    request.resume();
    updates++;
    response.writeHead(accept ? 204 : 409);
    response.end(accept ? undefined : 'gate no longer accepts frames');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const client = new Presence(`http://127.0.0.1:${server.address().port}`);
  await assert.rejects(client.pushFrame('test-gate', 'c3ludGhldGlj'), {
    message: 'frame update failed: gate no longer accepts frames',
  });
  accept = true;
  await client.pushFrame('test-gate', 'c3ludGhldGlj');
  assert.equal(updates, 2, 'recovery remains an explicit caller decision');
});
