// -----------------------------------------------------------------------------
// The CLI listener: login when there are credentials, `listen 1`, one event per
// line with the decoded player id, and a reconnection when LMS closes.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CliListener } from '../src/lms/listener.js';
import { FakeLms, KITCHEN, until } from './helpers/fakeLms.js';

const options = (lms, extra = {}) => ({
  host: '192.0.2.10',
  port: 9090,
  connect: lms.connect,
  settleMs: 10,
  reconnectMinMs: 10,
  reconnectMaxMs: 40,
  ...extra,
});

test('listens, and turns every line into a player event', async (t) => {
  const lms = new FakeLms();
  const listener = new CliListener(options(lms));
  t.after(() => listener.stop());
  const events = [];
  listener.on('event', (id, command) => events.push([id, command]));
  listener.start();
  await until(() => listener.up, 1000, 'up');
  const [socket] = lms.sockets;
  assert.deepEqual(socket.written, ['listen 1\n'], 'no login without credentials');
  lms.event(KITCHEN, 'mixer', 'volume', '40');
  lms.event(KITCHEN, 'playlist', 'newsong', 'Morning Song', '0');
  socket.emit('data', 'rescan done\n');
  await until(() => events.length === 3, 1000, 'events');
  assert.deepEqual(events, [
    [KITCHEN, 'mixer'],
    [KITCHEN, 'playlist'],
    [null, 'done'],
  ]);
});

test('logs in first, and is never "up" when LMS closes right after the echo', async (t) => {
  const lms = new FakeLms({ username: 'gladys', password: 's3cret' });
  const wrong = new CliListener(options(lms, { username: 'gladys', password: 'nope' }));
  t.after(() => wrong.stop());
  const ups = [];
  wrong.on('up', () => ups.push('up'));
  wrong.start();
  await new Promise((resolve) => setTimeout(resolve, 120));
  assert.deepEqual(ups, []);
  wrong.stop();

  const right = new CliListener(options(lms, { username: 'gladys', password: 's3cret' }));
  t.after(() => right.stop());
  right.start();
  await until(() => right.up, 1000, 'up');
  assert.match([...lms.sockets][0].written[0], /^login gladys s3cret\n/);
});

test('reconnects when the CLI closes, and reports down then up', async (t) => {
  const lms = new FakeLms();
  const listener = new CliListener(options(lms));
  t.after(() => listener.stop());
  const seen = [];
  listener.on('up', () => seen.push('up'));
  listener.on('down', () => seen.push('down'));
  listener.start();
  await until(() => listener.up, 1000, 'up');
  lms.closeCli();
  await until(() => seen.length === 3, 1000, 'back');
  assert.deepEqual(seen, ['up', 'down', 'up']);
});
