// -----------------------------------------------------------------------------
// The music player of Gladys 5.3: the features, the "now playing" published
// through publishNowPlaying, the commands written by the Music box, the
// artwork, and the catalog (browse, search, play, queue) against answers
// recorded on a real Lyrion Music Server 9.1.1 (test/fixtures/lms/).
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEVICE_FEATURE_CATEGORIES,
  MUSIC_PLAYBACK_STATE,
  MUSIC_REPEAT_MODE,
  artworkKey,
  validateMediaItems,
} from '@gladysassistant/integration-sdk';
import { FEATURES, nowPlaying } from '../src/devices.js';
import { favoriteItem } from '../src/catalog.js';
import { artworkPath, parseQueue, parseStatus } from '../src/lms/model.js';
import { FakeLms, KITCHEN, SONGS, fixture } from './helpers/fakeLms.js';
import { createAll, createWorld, deviceOf, featureId, featureOf, until } from './helpers/world.js';

const BASE = 'http://192.0.2.10:9000';
const last = (gladys, key, player = KITCHEN) => gladys.fake.lastState(featureId(player, key));

async function ready(t, options = {}) {
  const lms = options.lms ?? new FakeLms({ cliOpen: false });
  const world = await createWorld({ lms, ...options });
  t.after(() => world.app.stop());
  await until(() => world.gladys.fake.discoveredDevices?.length >= 2, 2000, 'discovery');
  await createAll(world.gladys);
  const device = deviceOf(world.gladys, KITCHEN);
  const set = (key, value) =>
    world.gladys.fake.setValue(device, featureOf(world.gladys, KITCHEN, key), value);
  return { ...world, lms, device, set };
}

/** The ack data, failing the test on an error, with the MediaItems checked. */
function data(ack) {
  assert.equal(ack.success, true, ack.error);
  if (ack.data?.items) {
    assert.deepEqual(validateMediaItems(ack.data.items), [], 'what the core would drop');
  }
  return ack.data;
}

test('features: the music types of Gladys 5.3, writable ones with feedback', () => {
  const music = Object.entries(FEATURES).filter(
    ([, f]) => f.category === DEVICE_FEATURE_CATEGORIES.MUSIC,
  );
  for (const [key, feature] of music) {
    if (
      !feature.read_only &&
      !['play', 'pause', 'previous', 'next', 'notification'].includes(key)
    ) {
      assert.equal(feature.has_feedback, true, `${key}: writable, confirmed by LMS`);
    }
  }
  // The keys are the types: publishNowPlaying's default ids (`${device}:${type}`).
  for (const key of ['playback_state', 'title', 'artist', 'album', 'artwork', 'duration']) {
    assert.equal(FEATURES[key].type, key);
  }
  for (const key of ['position', 'shuffle', 'repeat', 'mute', 'volume']) {
    assert.equal(FEATURES[key].type, key);
  }
  assert.deepEqual(
    [FEATURES.playback_state.read_only, FEATURES.playback_state.min, FEATURES.playback_state.max],
    [false, 0, MUSIC_PLAYBACK_STATE.IDLE],
  );
  assert.equal(FEATURES.position.read_only, false, 'seek');
  assert.equal(FEATURES.repeat.max, MUSIC_REPEAT_MODE.ONE);
  // 1.0.x: text/text and television/volume_mute, converted in place (same ids).
  assert.equal(FEATURES.title.category, DEVICE_FEATURE_CATEGORIES.MUSIC);
  assert.equal(FEATURES.artist.category, DEVICE_FEATURE_CATEGORIES.MUSIC);
  assert.equal(FEATURES.mute.category, DEVICE_FEATURE_CATEGORIES.MUSIC);
});

test('now playing: one batch, artwork key, cleared when the queue is emptied', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  lms.load(KITCHEN, SONGS, { time: 12 });
  lms.player(KITCHEN).repeat = 2;
  const { gladys } = await ready(t, { lms });
  assert.equal(last(gladys, 'playback_state'), MUSIC_PLAYBACK_STATE.PLAYING);
  assert.equal(last(gladys, 'title'), 'Morning Song');
  assert.equal(last(gladys, 'artist'), 'The Larks');
  assert.equal(last(gladys, 'album'), 'Daybreak');
  assert.equal(
    last(gladys, 'artwork'),
    artworkKey(`${BASE}/music/a1b2c3d4/cover_300x300_o.jpg`),
    'LMS resizes the cover itself',
  );
  assert.equal(last(gladys, 'position'), 12);
  assert.equal(last(gladys, 'repeat'), MUSIC_REPEAT_MODE.ALL, 'LMS 2 = the playlist');
  assert.equal(last(gladys, 'shuffle'), 0);
  assert.equal(last(gladys, 'mute'), 0);
  assert.equal(last(gladys, 'volume'), 50);
  assert.equal(last(gladys, 'power'), 1);

  // Stopped with a queue: IDLE, the song stays shown, the position is 0.
  lms.player(KITCHEN).mode = 'stop';
  await until(() => last(gladys, 'playback_state') === MUSIC_PLAYBACK_STATE.IDLE, 2000, 'idle');
  assert.equal(last(gladys, 'title'), 'Morning Song');
  assert.equal(last(gladys, 'position'), 0);

  // A song without cover: no artwork.
  lms.load(KITCHEN, SONGS, { index: 2 });
  await until(() => last(gladys, 'title') === 'Night Theme', 2000, 'next song');
  assert.equal(last(gladys, 'artwork'), '');

  // Nothing loaded: every text cleared explicitly.
  lms.load(KITCHEN, [], { mode: 'stop' });
  await until(() => last(gladys, 'title') === '', 2000, 'cleared');
  assert.equal(last(gladys, 'artist'), '');
  assert.equal(last(gladys, 'album'), '');
  assert.equal(last(gladys, 'duration'), 0);
});

test('now playing: never a position per read, a seek republishes it', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  lms.load(
    KITCHEN,
    SONGS.map((s) => ({ ...s, duration: 200 })),
    { time: 10 },
  );
  const { gladys } = await ready(t, { lms });
  const positions = () =>
    gladys.fake.states.filter(
      (s) => s.device_feature_external_id === featureId(KITCHEN, 'position'),
    ).length;
  const before = positions();
  lms.player(KITCHEN).time = 10.4;
  await new Promise((resolve) => setTimeout(resolve, 200));
  assert.equal(positions(), before, 'the dashboard extrapolates the position');
  lms.player(KITCHEN).time = 150;
  await until(() => last(gladys, 'position') === 150, 2000, 'seek');
});

test('a radio: the song of the stream as title, the station as album, live', () => {
  const radio = parseStatus(fixture('status-radio').result);
  assert.equal(radio.remote, true);
  assert.equal(radio.title, '', 'fip-midfi.mp3 is the file of the URL, not a song');
  assert.equal(radio.station, 'FIP');
  const withSong = parseStatus({
    ...fixture('status-radio').result,
    current_title: 'Nina Simone - Sinnerman',
  });
  assert.equal(withSong.title, 'Sinnerman');
  assert.equal(withSong.artist, 'Nina Simone');
});

test('a radio, published: the station name, duration 0, no generic LMS icon', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  const song = fixture('status-radio').result.playlist_loop[0];
  lms.load(KITCHEN, [{ ...song, remote: '1' }]);
  const { gladys } = await ready(t, { lms });
  assert.equal(last(gladys, 'title'), 'FIP');
  assert.equal(last(gladys, 'album'), '');
  assert.equal(last(gladys, 'duration'), 0);
  assert.equal(last(gladys, 'artwork'), '', 'html/images/radio.png is a placeholder');
});

test('the Music box commands: play, pause, stop, seek, shuffle, repeat, mute', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  lms.load(KITCHEN, SONGS);
  const { set } = await ready(t, { lms });
  const player = lms.player(KITCHEN);
  assert.equal((await set('playback_state', 0)).success, true);
  assert.equal(player.mode, 'pause');
  await set('playback_state', 1);
  assert.equal(player.mode, 'play', 'resumed');
  await set('playback_state', 2);
  assert.equal(player.mode, 'stop');
  assert.equal((await set('playback_state', 3)).success, false, 'BUFFERING is reported only');
  await set('position', 42.4);
  assert.equal(player.time, 42);
  await set('shuffle', 1);
  assert.equal(player.shuffle, 1);
  await set('repeat', MUSIC_REPEAT_MODE.ONE);
  assert.equal(player.repeat, 1);
  await set('repeat', MUSIC_REPEAT_MODE.ALL);
  assert.equal(player.repeat, 2);
  await set('repeat', MUSIC_REPEAT_MODE.OFF);
  assert.equal(player.repeat, 0);
  await set('mute', 1);
  assert.equal(player.muted, true);
  await set('mute', 1);
  assert.equal(player.muted, true, 'a value, no more a toggle');
  await set('mute', 0);
  assert.equal(player.muted, false);
});

test('artwork: served by the LMS client, unknown keys refused', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  lms.load(KITCHEN, SONGS);
  const { gladys } = await ready(t, { lms });
  const ack = await gladys.fake.musicGetArtwork(last(gladys, 'artwork'));
  assert.equal(ack.success, true, ack.error);
  assert.equal(Buffer.from(ack.data.image, 'base64')[0], 0xff, 'a JPEG');
  assert.equal(lms.requests.at(-1).path, '/music/a1b2c3d4/cover_300x300_o.jpg');
  assert.equal((await gladys.fake.musicGetArtwork('art-000000000000')).success, false);
});

test('artwork paths: LMS resizes covers, proxied images and its own images', () => {
  assert.equal(artworkPath({ coverId: 'a1b2' }, 64), '/music/a1b2/cover_64x64_o.jpg');
  assert.equal(
    artworkPath({ artworkUrl: 'https://img.example.com/a.jpg' }, 300),
    '/imageproxy/https%3A%2F%2Fimg.example.com%2Fa.jpg/image_300x300_o.jpg',
  );
  assert.equal(artworkPath({ artworkUrl: 'music/4/cover.png' }, 64), '/music/4/cover_64x64_o.png');
  assert.equal(artworkPath({ artworkUrl: 'html/images/radio.png' }, 64), null);
  assert.equal(artworkPath({ artworkUrl: '0' }, 64), null, 'what 9.1.1 answers for no cover');
  assert.equal(artworkPath({}, 64), null);
});

test('an update from the Discover tab republishes everything', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  lms.load(KITCHEN, SONGS);
  const { gladys, device } = await ready(t, { lms });
  const count = gladys.fake.states.length;
  await gladys.fake.deviceUpdated(device);
  await until(() => gladys.fake.states.length > count, 2000, 'republished');
  const titles = gladys.fake.states.filter(
    (s) => s.device_feature_external_id === featureId(KITCHEN, 'title'),
  );
  assert.equal(titles.length, 2, 'the snapshot was forgotten by the SDK');
});

test('browse: the root folders, then the library, paged by LMS', async (t) => {
  const { gladys, device } = await ready(t);
  const root = data(await gladys.fake.musicBrowse(device));
  assert.deepEqual(
    root.items.map((i) => [i.id, i.type, i.browsable, i.playable]),
    [
      ['lms:favorites', 'folder', true, false],
      ['lms:playlists', 'folder', true, false],
      ['lms:artists', 'folder', true, false],
      ['lms:albums', 'folder', true, false],
    ],
  );
  assert.equal(root.items[1].title, 'Playlists', 'in the language of the configuration');

  const albums = data(await gladys.fake.musicBrowse(device, { parentId: 'lms:albums' }));
  assert.equal(albums.total, 4);
  const first = albums.items.find((i) => i.title === 'First Light');
  assert.equal(
    first.id,
    'album:1:db:album.title=First%20Light&contributor.name=Aurora%20Lane',
    'the id to browse, the URL to play',
  );
  assert.equal(first.subtitle, 'Aurora Lane');
  assert.equal(first.artwork_key, artworkKey(`${BASE}/music/3a3bf033/cover_64x64_o.jpg`));
  assert.equal(albums.items.find((i) => i.title === 'Loops').artwork_key, undefined);

  const artists = data(await gladys.fake.musicBrowse(device, { parentId: 'lms:artists' }));
  const aurora = artists.items.find((i) => i.title === 'Aurora Lane');
  const ofArtist = data(await gladys.fake.musicBrowse(device, { parentId: aurora.id }));
  assert.deepEqual(
    ofArtist.items.map((i) => i.title),
    ['First Light', 'Night Shift'],
  );

  const page = data(
    await gladys.fake.musicBrowse(device, { parentId: first.id, offset: 1, limit: 2 }),
  );
  assert.equal(page.total, 3, 'the size of the album, not of the page');
  assert.deepEqual(
    page.items.map((i) => [i.type, i.title, i.subtitle, i.duration]),
    [
      ['track', 'Blue Hour', 'Aurora Lane', 40],
      ['track', 'Long Shadows', 'Aurora Lane', 40],
    ],
  );

  const playlists = data(await gladys.fake.musicBrowse(device, { parentId: 'lms:playlists' }));
  const radios = playlists.items.find((i) => i.title === 'Radios');
  const stations = data(await gladys.fake.musicBrowse(device, { parentId: radios.id }));
  assert.deepEqual(
    stations.items.map((i) => [i.type, i.title, i.id]),
    [['radio', 'FIP', 'url:http://radio.example.com/fip-midfi.mp3']],
  );
  const mine = data(
    await gladys.fake.musicBrowse(device, {
      parentId: playlists.items.find((i) => i.title === 'Ma sélection').id,
    }),
  );
  // 9.1.1 answers `coverart: "1"` and `artwork_url: "0"` for a song without cover.
  assert.equal(mine.items.find((i) => i.title === 'Loop One').artwork_key, undefined);

  const unknown = data(await gladys.fake.musicBrowse(device, { parentId: 'nothing' }));
  assert.deepEqual(unknown, { items: [], total: 0 });
});

test('browse: the favorites, their folders by position (the session prefix dropped)', async (t) => {
  const { gladys, device } = await ready(t);
  const favorites = data(await gladys.fake.musicBrowse(device, { parentId: 'lms:favorites' }));
  assert.deepEqual(
    favorites.items.map((i) => [i.type, i.id, i.playable, i.browsable]),
    [
      ['radio', 'fav:http://radio.example.com/fip-midfi.mp3', true, false],
      ['track', 'fav:file:///music/Quiet%20Machines/Loops/02.flac', true, false],
      ['album', 'fav:db:album.title=First%20Light&contributor.name=Aurora%20Lane', true, false],
      ['folder', 'favdir:3', false, true],
    ],
  );
  assert.equal(favorites.items[0].artwork_key, undefined, 'the generic radio icon of LMS');
  const folder = data(await gladys.fake.musicBrowse(device, { parentId: 'favdir:3' }));
  assert.deepEqual(
    folder.items.map((i) => [i.title, i.id]),
    [['Neon Rain', 'fav:file:///music/Aurora%20Lane/Night%20Shift/01.flac']],
  );
  assert.equal(folder.items[0].artwork_key, artworkKey(`${BASE}/music/4/cover_64x64_o.png`));
});

test('search: favorites and library mixed, or one type', async (t) => {
  const { gladys, device } = await ready(t);
  const all = data(await gladys.fake.musicSearch(device, { query: 'aurora' }));
  assert.deepEqual(
    all.items.map((i) => i.type),
    ['playlist', 'artist', 'album', 'album', 'track', 'track', 'track', 'track', 'track'],
  );
  const radio = data(await gladys.fake.musicSearch(device, { query: 'fip', type: 'radio' }));
  assert.deepEqual(
    radio.items.map((i) => [i.type, i.title]),
    [['radio', 'FIP']],
  );
  const mixed = data(await gladys.fake.musicSearch(device, { query: 'fip' }));
  assert.deepEqual(
    mixed.items.map((i) => i.title),
    ['FIP'],
  );
  assert.deepEqual(data(await gladys.fake.musicSearch(device, { query: '  ' })).items, []);
});

test('play: by URL (survives a rescan), by id, a favorite with its title', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  lms.load(KITCHEN, SONGS);
  const { gladys, device } = await ready(t, { lms });
  const sent = () => lms.requests.filter((r) => r.playerId === KITCHEN).map((r) => r.command);
  const player = lms.player(KITCHEN);

  data(
    await gladys.fake.musicPlay(
      device,
      { id: 'album:1:db:album.title=First%20Light&contributor.name=Aurora%20Lane', type: 'album' },
      'replace',
    ),
  );
  assert.deepEqual(sent().at(-2), [
    'playlist',
    'play',
    'db:album.title=First%20Light&contributor.name=Aurora%20Lane',
  ]);

  lms.load(KITCHEN, SONGS);
  data(await gladys.fake.musicPlay(device, { id: 'track:8', type: 'track' }, 'next'));
  assert.deepEqual(sent().at(-1), ['playlistcontrol', 'cmd:insert', 'track_id:8']);
  assert.equal(player.queue[1].title, 'Loaded track_id:8', 'after the current song');

  data(
    await gladys.fake.musicPlay(
      device,
      { id: 'fav:http://radio.example.com/fip-midfi.mp3', type: 'radio' },
      'append',
    ),
  );
  assert.deepEqual(sent().at(-1), [
    'playlist',
    'add',
    'http://radio.example.com/fip-midfi.mp3',
    'FIP',
  ]);

  const folder = await gladys.fake.musicPlay(device, { id: 'lms:albums', type: 'folder' });
  assert.match(folder.error, /folder/);
  const unknownId = await gladys.fake.musicPlay(device, { id: 'album:9999', type: 'album' });
  assert.match(unknownId.error, /cannot play/);
  const unknownUrl = await gladys.fake.musicPlay(device, {
    id: 'album:1:db:album.title=Nope&contributor.name=Nobody',
    type: 'album',
  });
  assert.match(unknownUrl.error, /cannot play/, 'an empty queue after a replace');
  const garbage = await gladys.fake.musicPlay(device, { id: 'nothing', type: 'track' });
  assert.equal(garbage.success, false);
});

test('play: a player switched off is switched on first', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  lms.player(KITCHEN).power = 0;
  const { gladys, device, hub } = await ready(t, { lms });
  await until(() => hub.players.get(KITCHEN).snapshot?.power === false, 1000, 'off');
  data(await gladys.fake.musicPlay(device, { id: 'track:2', type: 'track' }));
  assert.equal(lms.player(KITCHEN).power, 1);
  assert.equal(lms.player(KITCHEN).mode, 'play');
});

test('queue: the page asked, current index and length of the whole queue, no row lost', async (t) => {
  const recorded = parseQueue(fixture('status-queue').result);
  assert.equal(recorded.total, 4);
  assert.equal(recorded.current, 1);
  const lms = new FakeLms({ cliOpen: false });
  lms.load(KITCHEN, [...recorded.songs, { title: 'Nameless', url: `file:///${'x'.repeat(600)}` }], {
    index: 1,
  });
  const { gladys, device } = await ready(t, { lms });
  const queue = data(await gladys.fake.musicQueueGet(device));
  assert.equal(queue.total, 5);
  assert.equal(queue.current_index, 1);
  assert.deepEqual(
    queue.items.map((i) => [i.type, i.title]),
    [
      ['track', 'Morning Glow'],
      ['track', 'Blue Hour'],
      ['track', 'Long Shadows'],
      ['radio', 'FIP'],
      ['track', 'Nameless'],
    ],
  );
  assert.equal(queue.items[4].id, 'queue:4', 'an id too long: a fallback, not a lost row');
  const page = data(await gladys.fake.musicQueueGet(device, { offset: 2, limit: 2 }));
  assert.deepEqual(
    page.items.map((i) => i.title),
    ['Long Shadows', 'FIP'],
  );
  assert.equal(page.current_index, 1);

  data(await gladys.fake.musicQueuePlay(device, 3));
  assert.equal(lms.player(KITCHEN).index, 3);
  const beyond = await gladys.fake.musicQueuePlay(device, 9);
  assert.match(beyond.error, /no longer in the queue/);
});

test('an offline player: the library still browses, playing says why', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  const { gladys, device, hub } = await ready(t, { lms });
  lms.player(KITCHEN).connected = 0;
  await until(() => hub.players.get(KITCHEN).connected === false, 2000, 'offline');
  data(await gladys.fake.musicBrowse(device, { parentId: 'lms:artists' }));
  const ack = await gladys.fake.musicPlay(device, { id: 'track:2', type: 'track' });
  assert.match(ack.error, /not connected/);
});

test('a stream playing for days: the position follows LMS, never capped', () => {
  const radio = parseStatus(fixture('status-radio').result);
  const snapshot = nowPlaying({ ...radio, time: 90_000.4 }, BASE);
  assert.equal(snapshot.duration, 0);
  assert.equal(snapshot.position, 90_000, 'a cap would drift from the extrapolated position');
  const song = nowPlaying({ ...parseStatus(fixture('status-playing').result), time: 9999 }, BASE);
  assert.ok(song.duration > 0);
  assert.equal(song.position, song.duration, 'a song: bounded by its duration');
  const nameless = nowPlaying({ ...radio, station: '' }, BASE);
  assert.equal(nameless.title, 'fip-midfi.mp3', 'neither song nor station: the stream file');
});

test('mute on a device not updated yet (1.0 television push button): it toggles', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  lms.load(KITCHEN, SONGS);
  const { gladys, device } = await ready(t, { lms });
  const old = {
    ...featureOf(gladys, KITCHEN, 'mute'),
    category: 'television',
    type: 'volume_mute',
  };
  await gladys.fake.setValue(device, old, 1);
  assert.equal(lms.player(KITCHEN).muted, true);
  await gladys.fake.setValue(device, old, 1);
  assert.equal(lms.player(KITCHEN).muted, false, 'the same press unmutes');
});

test('queue: an unreadable artist (LMS 9.1 drops the loop): read again without it', async (t) => {
  const lms = new FakeLms({ cliOpen: false });
  lms.load(KITCHEN, SONGS);
  const { gladys, device } = await ready(t, { lms });
  lms.unreadableArtist = true;
  const queue = data(await gladys.fake.musicQueueGet(device));
  assert.deepEqual(
    queue.items.map((i) => i.title),
    ['Morning Song', 'Evening Tune', 'Night Theme'],
  );
});

test('favorites: types from the URL, rows never dropped, title given to streams only', async (t) => {
  const hub = { gladys: { artworkKey }, config: { baseUrl: BASE } };
  const type = (url) => favoriteItem(hub, { id: 'x.0', name: 'F', isaudio: 1, url }).type;
  assert.equal(type('http://radio.example.com/live'), 'radio');
  assert.equal(type('spotify:album:abc'), 'track', 'an app of LMS is no radio');
  assert.equal(type('file:///playlist/Mix.m3u'), 'playlist');
  assert.equal(type('file:///music/a.flac'), 'track');
  assert.deepEqual(favoriteItem(hub, { id: 'x.4', name: 'Odd', isaudio: 0, hasitems: 0 }), {
    id: 'favx:4',
    type: 'folder',
    title: 'Odd',
    browsable: false,
    playable: false,
  });

  const lms = new FakeLms({ cliOpen: false });
  lms.load(KITCHEN, SONGS);
  const { gladys, device } = await ready(t, { lms });
  data(
    await gladys.fake.musicPlay(
      device,
      { id: 'fav:file:///music/Quiet%20Machines/Loops/02.flac', type: 'track' },
      'append',
    ),
  );
  const sent = lms.requests.filter((r) => r.playerId === KITCHEN).at(-1).command;
  assert.deepEqual(sent, ['playlist', 'add', 'file:///music/Quiet%20Machines/Loops/02.flac']);
  const odd = await gladys.fake.musicPlay(device, { id: 'favx:4', type: 'folder' });
  assert.equal(odd.success, false);
});
