// -----------------------------------------------------------------------------
// LMS answers -> snapshots, on the answers recorded on Lyrion 9.1
// (test/fixtures/lms/) and on the shapes of radio streams.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isPlaying, parseFavorites, parseServer, parseStatus, trackKey } from '../src/lms/model.js';
import { fixture } from './helpers/fakeLms.js';

test('serverstatus: the version and every player with its id, name and model', () => {
  const server = parseServer(fixture('serverstatus').result);
  assert.equal(server.version, '9.1.1');
  assert.deepEqual(
    server.players.map((p) => [p.id, p.name, p.model, p.connected]),
    [
      ['02:00:00:00:00:02', 'Salon', 'SqueezeLite', true],
      ['02:00:00:00:00:01', 'Kitchen', 'SqueezeLite', true],
    ],
  );
  assert.deepEqual(parseServer({}).players, []);
});

test('a playing player: mode, volume, song and queue position', () => {
  const s = parseStatus(fixture('status-playing').result);
  assert.equal(s.mode, 'play');
  assert.equal(s.power, true);
  assert.equal(s.volume, 30);
  assert.equal(s.muted, false);
  assert.equal(s.title, '01 Morning Song');
  assert.equal(s.artist, 'No Artist'); // what LMS says of an untagged file
  assert.equal(s.tracks, 2);
  assert.equal(s.index, 0);
  assert.equal(s.coverId, '', 'no cover art: coverart is "0"');
  assert.ok(isPlaying(s));
});

test('a muted player reports a negative volume: the level and the mute', () => {
  const s = parseStatus(fixture('status-muted').result);
  assert.equal(s.volume, 40);
  assert.equal(s.muted, true);
});

test('a synced, paused player and a player turned off', () => {
  const synced = parseStatus(fixture('status-paused-synced').result);
  assert.equal(synced.mode, 'pause');
  assert.equal(synced.syncMaster, '02:00:00:00:00:01');
  assert.deepEqual(synced.syncSlaves, ['02:00:00:00:00:02']);
  assert.equal(isPlaying(synced), false);
  const off = parseStatus(fixture('status-off').result);
  assert.equal(off.power, false);
  assert.equal(isPlaying(off), false);
});

test('an empty queue has no song', () => {
  const s = parseStatus(fixture('status-empty').result);
  assert.equal(s.tracks, 0);
  assert.equal(s.title, '');
  assert.equal(s.index, null);
  assert.equal(trackKey(s), '');
});

test('a radio: the song comes from current_title, the station from remote_title', () => {
  const s = parseStatus({
    mode: 'play',
    power: 1,
    'mixer volume': '25',
    playlist_tracks: 1,
    playlist_cur_index: '0',
    current_title: 'Nina Simone - Feeling Good',
    playlist_loop: [
      {
        id: '-94',
        title: 'FIP',
        remote: 1,
        remote_title: 'FIP',
        url: 'https://example.com/fip.mp3',
      },
    ],
  });
  assert.equal(s.artist, 'Nina Simone');
  assert.equal(s.title, 'Feeling Good');
  assert.equal(s.station, 'FIP');
  assert.equal(s.volume, 25, 'numeric strings are numbers');
  const next = parseStatus({ ...s, current_title: 'Miles Davis - So What' });
  assert.notEqual(trackKey(s), trackKey({ ...s, title: 'So What', artist: 'Miles Davis' }));
  assert.ok(next);
});

test('favorites: only the playable ones (folders are left out)', () => {
  const favorites = parseFavorites(fixture('favorites').result);
  assert.deepEqual(
    favorites.map((f) => f.name),
    ['Night Radio'],
  );
  assert.match(favorites[0].id, /^[0-9a-f]+\.0$/);
  assert.deepEqual(parseFavorites({}), []);
});
