// -----------------------------------------------------------------------------
// The hub against the SDK's fake Gladys and a scripted Lyrion server: devices,
// states, self-polling (Gladys#3198, onPoll never called), the CLI, scene
// events, commands, announcements, connection status and quiet logs.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FakeLms, KITCHEN, SALON, SONGS } from './helpers/fakeLms.js';
import {
  createAll,
  createWorld,
  deviceId,
  deviceOf,
  featureId,
  featureOf,
  until,
} from './helpers/world.js';

const settle = (ms = 60) => new Promise((resolve) => setTimeout(resolve, ms));
const last = (gladys, key, player = KITCHEN) => gladys.fake.lastState(featureId(player, key));

async function ready(options) {
  const world = await createWorld(options);
  await until(() => world.gladys.fake.discoveredDevices?.length >= 2, 2000, 'discovery');
  await createAll(world.gladys);
  return world;
}

/** Capture the lines written at info and above from now on, at LOG_LEVEL=info. */
function captureLogs(t) {
  const previous = process.env.LOG_LEVEL;
  process.env.LOG_LEVEL = 'info';
  const lines = [];
  const keep = (...args) => lines.push(args.map(String).join(' '));
  t.mock.method(console, 'log', keep);
  t.mock.method(console, 'error', keep);
  t.after(() => {
    process.env.LOG_LEVEL = previous;
  });
  return lines;
}

test('one device per player, from its LMS id; states only once the device is added', async (t) => {
  const lms = new FakeLms();
  lms.load(KITCHEN, SONGS);
  const { gladys, app } = await createWorld({ lms });
  t.after(() => app.stop());
  await until(() => gladys.fake.discoveredDevices?.length === 2, 2000, 'discovery');
  const kitchen = deviceOf(gladys, KITCHEN);
  assert.equal(kitchen.name, 'Kitchen');
  assert.equal(kitchen.external_id, 'ext:test-integration:player:020000000001');
  assert.equal(kitchen.should_poll, false);
  assert.deepEqual(kitchen.params, [{ name: 'PLAYER_ID', value: KITCHEN }]);
  assert.equal(gladys.fake.states.length, 0, 'nothing published before "Add to Gladys"');

  await gladys.fake.deviceCreated(kitchen);
  assert.equal(last(gladys, 'title'), 'Morning Song');
  assert.equal(last(gladys, 'artist'), 'The Larks');
  assert.equal(last(gladys, 'playback_state'), 1);
  assert.equal(last(gladys, 'power'), 1);
  assert.equal(last(gladys, 'volume'), 50);
  assert.ok(gladys.fake.widgetRefreshes.length > 0, 'the widget is refreshed');
});

test('without the CLI, the container reads the players itself (never onPoll)', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  const world = await ready({ lms });
  t.after(() => world.app.stop());
  const { gladys } = world;
  assert.equal(last(gladys, 'title'), '—', 'nothing loaded');
  lms.load(KITCHEN, SONGS, { index: 2 });
  // gladys.fake.poll() is never called: the timer of the container did it.
  await until(() => last(gladys, 'title') === 'Night Theme', 2000, 'timer read');
});

test('with the CLI, an event triggers a read at once (the timer is slow)', async (t) => {
  const lms = new FakeLms();
  const world = await ready({ lms, timings: { fastPollMs: 60_000, slowPollMs: 60_000 } });
  t.after(() => world.app.stop());
  await until(() => world.hub.listener.up, 2000, 'CLI up');
  await settle(30); // the read that follows the subscription
  lms.player(KITCHEN).volume = 22;
  await settle(80);
  assert.equal(last(world.gladys, 'volume'), 50, 'no read without an event');
  lms.event(KITCHEN, 'mixer', 'volume', '22');
  await until(() => last(world.gladys, 'volume') === 22, 1000, 'read on event');
});

test('scene events: started, song changed, stopped with its reason; none at start', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  lms.load(KITCHEN, SONGS, { mode: 'pause' });
  const world = await ready({ lms });
  t.after(() => world.app.stop());
  const { gladys } = world;
  const events = () => gladys.fake.sceneEvents.map((e) => [e.key, e.data.title, e.data.state]);
  await settle();
  assert.deepEqual(events(), [], 'what was there at start fires nothing');

  lms.player(KITCHEN).mode = 'play'; // resume the same song
  await until(() => events().length === 1, 2000, 'started');
  lms.player(KITCHEN).index = 1;
  await until(() => events().length === 2, 2000, 'song changed');
  lms.player(KITCHEN).mode = 'pause';
  await until(() => events().length === 3, 2000, 'paused');
  lms.player(KITCHEN).mode = 'play';
  await until(() => events().length === 4, 2000, 'resumed');
  lms.player(KITCHEN).power = 0;
  await until(() => events().length === 5, 2000, 'off');
  assert.deepEqual(events(), [
    ['playback_started', 'Morning Song', undefined],
    ['track_changed', 'Evening Tune', undefined],
    ['playback_stopped', 'Evening Tune', 'paused'],
    ['playback_started', 'Evening Tune', undefined],
    ['playback_stopped', 'Evening Tune', 'off'],
  ]);
  const [started] = gladys.fake.sceneEvents;
  assert.deepEqual(started.data, {
    device: deviceId(KITCHEN),
    player: 'Kitchen',
    title: 'Morning Song',
    artist: 'The Larks',
    album: 'Daybreak',
  });
});

test('the device controls reach LMS', async (t) => {
  const lms = new FakeLms();
  lms.load(KITCHEN, SONGS, { mode: 'stop' });
  const world = await ready({ lms });
  t.after(() => world.app.stop());
  const { gladys } = world;
  const set = (key, value = 1) =>
    gladys.fake.setValue(deviceOf(gladys, KITCHEN), featureOf(gladys, KITCHEN, key), value);
  const player = lms.player(KITCHEN);

  assert.equal((await set('play')).success, true);
  assert.equal(player.mode, 'play');
  await set('next');
  assert.equal(player.index, 1);
  await set('previous');
  assert.equal(player.index, 0);
  await set('pause');
  assert.equal(player.mode, 'pause');
  await until(() => world.hub.players.get(KITCHEN).snapshot.mode === 'pause', 1000, 'read');
  await set('play');
  assert.equal(player.mode, 'play', 'play resumes a paused song');
  await set('volume', 35);
  assert.equal(player.volume, 35);
  await set('mute');
  assert.equal(player.muted, true);
  await set('stop');
  assert.equal(player.mode, 'stop');
  await set('power', 0);
  assert.equal(player.power, 0);
  assert.match((await set('volume', 140)).error, /0 to 100/);
  await until(() => last(gladys, 'power') === 0, 1000, 'power state');
});

test('an announcement plays, then gives back the queue, song, position, volume', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  lms.load(KITCHEN, SONGS, { index: 1, time: 42 });
  lms.player(KITCHEN).volume = 20;
  lms.player(KITCHEN).repeat = 1;
  const world = await ready({ lms });
  t.after(() => world.app.stop());
  const { gladys } = world;
  const player = lms.player(KITCHEN);
  const before = gladys.fake.sceneEvents.length;

  const ack = await gladys.fake.sceneAction('announce', {
    device: deviceId(KITCHEN),
    url: 'https://example.com/doorbell.mp3',
    volume: 70,
  });
  assert.equal(ack.success, true, ack.error);
  assert.equal(player.index, 2, 'inserted after the current song');
  assert.equal(player.queue[2].url, 'https://example.com/doorbell.mp3');
  assert.equal(player.volume, 70);
  assert.equal(player.repeat, 0, 'repeat-one would loop the announcement');
  const busy = await gladys.fake.sceneAction('announce', {
    device: deviceId(KITCHEN),
    url: 'https://example.com/doorbell.mp3',
  });
  assert.match(busy.error, /already/);

  await settle(50);
  player.index = 3; // the announcement ended: LMS moves to the next song
  await until(() => !world.hub.players.get(KITCHEN).announcing, 2000, 'restored');
  assert.deepEqual(
    player.queue.map((s) => s.id),
    [1, 2, 3],
  );
  assert.equal(player.index, 1);
  assert.equal(player.time, 42);
  assert.equal(player.mode, 'play');
  assert.equal(player.volume, 20);
  assert.equal(player.repeat, 1);
  await settle(100);
  assert.equal(gladys.fake.sceneEvents.length, before, 'no scene event for the announcement');
});

test('an announcement on an empty, stopped player clears the queue afterwards', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  lms.player(KITCHEN).power = 0;
  const world = await ready({ lms });
  t.after(() => world.app.stop());
  const { gladys } = world;
  const player = lms.player(KITCHEN);
  // The core "play a notification" action sends the URL to this feature.
  const ack = await gladys.fake.setValue(
    deviceOf(gladys, KITCHEN),
    featureOf(gladys, KITCHEN, 'notification'),
    'http://192.0.2.30/tts.mp3',
  );
  assert.equal(ack.success, true, ack.error);
  assert.equal(player.power, 1);
  assert.equal(player.mode, 'play');
  player.mode = 'stop'; // end of the stream
  await until(() => !world.hub.players.get(KITCHEN).announcing, 2000, 'restored');
  assert.deepEqual(player.queue, []);
  assert.equal(player.power, 0, 'turned off again');

  const bad = await gladys.fake.sceneAction('announce', {
    device: deviceId(KITCHEN),
    url: 'ftp://x',
  });
  assert.match(bad.error, /http/);
});

test('favorites by name (case and accents ignored) or by position', async (t) => {
  const favorites = [
    { id: 'f.0', name: 'Radio Café', isaudio: 1, hasitems: 0, url: 'https://example.com/a.mp3' },
    { id: 'f.1', name: 'My folder', isaudio: 0, hasitems: 1 },
    { id: 'f.2', name: 'Jazz', isaudio: 1, hasitems: 0, url: 'https://example.com/b.mp3' },
  ];
  const lms = new FakeLms({ favorites });
  lms.player(KITCHEN).power = 0;
  const world = await ready({ lms });
  t.after(() => world.app.stop());
  const play = (favorite) =>
    world.gladys.fake.sceneAction('play_favorite', { device: deviceId(KITCHEN), favorite });

  assert.deepEqual((await play('radio cafe')).data.outputs, { favorite: 'Radio Café' });
  assert.equal(lms.player(KITCHEN).power, 1, 'turned on first');
  assert.equal(lms.player(KITCHEN).queue[0].title, 'Radio Café');
  assert.deepEqual((await play('2')).data.outputs, { favorite: 'Jazz' }, 'folders do not count');
  assert.match((await play('Rock')).error, /No playable favorite/);
  assert.match((await play('  ')).error, /name or the position/);
  const offline = await world.gladys.fake.sceneAction('play_favorite', {
    device: 'ext:test-integration:player:nope',
    favorite: 'Jazz',
  });
  assert.match(offline.error, /not known/);
});

test('pause all, volume of every player, groups', async (t) => {
  const lms = new FakeLms();
  lms.load(KITCHEN, SONGS);
  lms.load(SALON, SONGS);
  const world = await ready({ lms });
  t.after(() => world.app.stop());
  const { gladys } = world;

  assert.deepEqual((await gladys.fake.sceneAction('pause_all', {})).data.outputs, { paused: 2 });
  assert.equal(lms.player(KITCHEN).mode, 'pause');
  assert.equal(lms.player(SALON).mode, 'pause');

  assert.equal((await gladys.fake.sceneAction('set_volume', { volume: 15 })).success, true);
  assert.equal(lms.player(KITCHEN).volume, 15);
  assert.equal(lms.player(SALON).volume, 15);
  await gladys.fake.sceneAction('set_volume', { device: deviceId(SALON), volume: 60 });
  assert.equal(lms.player(SALON).volume, 60);
  assert.equal(lms.player(KITCHEN).volume, 15);

  await gladys.fake.sceneAction('join_group', {
    device: deviceId(SALON),
    target: deviceId(KITCHEN),
  });
  assert.equal(lms.player(SALON).master, KITCHEN);
  const self = await gladys.fake.sceneAction('join_group', {
    device: deviceId(SALON),
    target: deviceId(SALON),
  });
  assert.match(self.error, /itself/);
  await gladys.fake.sceneAction('leave_group', { device: deviceId(SALON) });
  assert.equal(lms.player(SALON).master, null);
});

test('connection status: not configured, invalid address, unreachable then back', async (t) => {
  const empty = await createWorld({ config: { host: '' } });
  t.after(() => empty.app.stop());
  assert.equal(empty.gladys.fake.connectionStatus.connected, false);
  assert.match(empty.gladys.fake.connectionStatus.message.en, /Type the address/);
  const ack = await empty.gladys.fake.sceneAction('pause_all', {});
  assert.match(ack.error, /Type the address/);

  const invalid = await createWorld({ config: { host: 'http://user:pw@192.0.2.10' } });
  t.after(() => invalid.app.stop());
  assert.match(invalid.gladys.fake.connectionStatus.message.fr, /pas valide/);

  const lms = new FakeLms({ cliOpen: false });
  lms.down = true;
  const world = await createWorld({ lms });
  t.after(() => world.app.stop());
  assert.equal(world.gladys.fake.connectionStatus.connected, false);
  assert.match(world.gladys.fake.connectionStatus.message.en, /does not answer/);
  lms.down = false;
  await until(() => world.gladys.fake.connectionStatus.connected, 2000, 'back');
  await until(() => world.gladys.fake.discoveredDevices?.length === 2, 2000, 'devices');
});

test('logs: a normal session writes nothing at info; an outage one line each way', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  const world = await ready({ lms });
  t.after(() => world.app.stop());
  const lines = captureLogs(t);
  lms.load(KITCHEN, SONGS);
  await until(() => world.gladys.fake.sceneEvents.length >= 1, 2000, 'playing');
  lms.player(KITCHEN).index = 1;
  lms.player(KITCHEN).volume = 30;
  await settle(150);
  assert.deepEqual(lines, []);

  lms.down = true;
  await settle(200); // several failed reads
  lms.down = false;
  await until(() => lines.length === 2, 2000, 'back');
  assert.match(lines[0], /unavailable/);
  assert.match(lines[1], /Connected to Lyrion/);
  assert.ok(lines.every((line) => !line.includes('s3cret')));
});

test('a new language publishes the devices again with the new names', async (t) => {
  const world = await ready({ config: { language: 'fr' } });
  t.after(() => world.app.stop());
  assert.equal(featureOf(world.gladys, KITCHEN, 'previous').name, 'Précédent');
  await world.gladys.fake.configUpdated({ host: '192.0.2.10', language: 'de' });
  assert.equal(featureOf(world.gladys, KITCHEN, 'previous').name, 'Vorheriger Titel');
});
