// -----------------------------------------------------------------------------
// The JSON-RPC client: request shape, basic authentication, and the failures
// turned into coded errors (LMS never answers an unknown command: timeout).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LmsClient, LmsError, MAX_IMAGE_BYTES } from '../src/lms/client.js';
import { FakeLms, KITCHEN, SONGS } from './helpers/fakeLms.js';

const BASE = 'http://192.0.2.10:9000';

test('a command is a slim.request with the player id and string arguments', async () => {
  let sent;
  const client = new LmsClient({
    baseUrl: BASE,
    fetch: async (url, init) => {
      sent = { url, init };
      return Response.json({ id: 1, result: { _volume: '40' } });
    },
  });
  assert.deepEqual(await client.request(KITCHEN, ['mixer', 'volume', 40]), { _volume: '40' });
  assert.equal(sent.url, `${BASE}/jsonrpc.js`);
  assert.equal(sent.init.method, 'POST');
  assert.deepEqual(JSON.parse(sent.init.body).params, [KITCHEN, ['mixer', 'volume', '40']]);
  assert.equal(sent.init.headers.authorization, undefined, 'no credentials, no header');
});

test('basic authentication, and a 401 is an auth error', async () => {
  const lms = new FakeLms({ username: 'gladys', password: 's3cret' });
  const good = new LmsClient({
    baseUrl: BASE,
    username: 'gladys',
    password: 's3cret',
    fetch: lms.fetch,
  });
  assert.equal((await good.serverStatus()).version, '9.1.1');
  const bad = new LmsClient({
    baseUrl: BASE,
    username: 'gladys',
    password: 'nope',
    fetch: lms.fetch,
  });
  await assert.rejects(bad.serverStatus(), (err) => err instanceof LmsError && err.code === 'auth');
});

test('unreachable, timeout, HTTP error and non-JSON answers have their codes', async () => {
  const lms = new FakeLms();
  lms.down = true;
  await assert.rejects(
    new LmsClient({ baseUrl: BASE, fetch: lms.fetch }).serverStatus(),
    (err) => err.code === 'unreachable' && !err.message.includes('s3cret'),
  );
  lms.down = false;
  const quick = new LmsClient({ baseUrl: BASE, fetch: lms.fetch, timeoutMs: 30 });
  await assert.rejects(quick.request(KITCHEN, ['bogus']), (err) => err.code === 'timeout');
  const http = new LmsClient({
    baseUrl: BASE,
    fetch: async () => new Response('', { status: 500 }),
  });
  await assert.rejects(http.serverStatus(), (err) => err.code === 'protocol');
  const html = new LmsClient({ baseUrl: BASE, fetch: async () => new Response('<html>') });
  await assert.rejects(html.serverStatus(), (err) => err.code === 'protocol');
});

test('status reads again without the artist when LMS drops the song (seen on 9.1)', async () => {
  const lms = new FakeLms();
  lms.load(KITCHEN, SONGS);
  const calls = [];
  const client = new LmsClient({
    baseUrl: BASE,
    fetch: async (url, init) => {
      const [, command] = JSON.parse(init.body).params;
      calls.push(command.at(-1));
      const response = await lms.fetch(url, init);
      const body = await response.json();
      if (command.at(-1) === 'tags:acdjKlNu') {
        delete body.result.playlist_loop;
      }
      return Response.json(body);
    },
  });
  const result = await client.status(KITCHEN);
  assert.equal(result.playlist_loop[0].title, 'Morning Song');
  assert.deepEqual(calls, ['tags:acdjKlNu', 'tags:cdjKlNu']);
});

test('images are size-capped (the core refuses more than 300 KB)', async () => {
  const big = new LmsClient({
    baseUrl: BASE,
    fetch: async () => new Response(Buffer.alloc(MAX_IMAGE_BYTES + 1)),
  });
  await assert.rejects(big.image('/music/1/cover.jpg'), (err) => err.code === 'protocol');
});
