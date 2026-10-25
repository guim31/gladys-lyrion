// -----------------------------------------------------------------------------
// LMS player -> Gladys device, and snapshot -> feature states.
//
// Couples chosen among those the Gladys front knows (test/gladys-rules.test.js):
// - the `music` category, the one of the core "Music" dashboard box:
//   play, pause, previous, next (one-shot commands kept for the scenes and
//   dashboards made before Gladys 5.3), volume, mute, playback_state
//   (writable since Gladys 5.3: 0 pause, 1 play, 2 stop), and the "now
//   playing" of Gladys 5.3: title, artist, album, artwork (an image key
//   served by src/catalog.js), duration, position (writable: seek),
//   shuffle and repeat. They go through publishNowPlaying (src/hub.js);
// - notification: music/play_notification, the target of the core "play a
//   notification" scene action (it sends the URL of an MP3);
// - stop: television/stop, a push button from before Gladys 5.3 (writing 2
//   to playback_state is the stop of 5.3), kept for the scenes using it;
// - power: switch/binary (a toggle), published with publishChangedStates.
// Before 1.1.0, title and artist were text/text and mute a television key:
// same external ids, the "Update" of the Discover tab converts them in place
// (the core updates the category and type of a feature found by external id).
//
// The external id comes from the LMS player id (the MAC of a Squeezebox or of
// squeezelite), never from its name. Feature keys are forever, and equal the
// music type they carry: the default ids of publishNowPlaying
// (`${device}:${type}`) are ours.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
  DEVICE_FEATURE_UNITS,
  MUSIC_PLAYBACK_STATE,
  MUSIC_REPEAT_MODE,
} from '@gladysassistant/integration-sdk';
import { artworkPath, lastSegment } from './lms/model.js';
import { NAMES, pick } from './texts.js';

export const DEVICE_TYPE = 'player';

// Bound of duration and position (a day: a stream reports 0).
export const MAX_SECONDS = 86_400;

// Now-playing artwork size asked to LMS (the core frame renders under 400 px).
export const ARTWORK_SIZE = 300;

const SECONDS = DEVICE_FEATURE_UNITS.SECONDS;

const f = (category, type, readOnly, min, max, feedback, extra = {}) => ({
  category,
  type,
  read_only: readOnly,
  min,
  max,
  has_feedback: feedback,
  ...extra,
});

// key -> definition. Every writable music feature has feedback: LMS reports
// the change (CLI event, then a status read).
export const FEATURES = {
  power: f(CAT.SWITCH, TYPE.SWITCH.BINARY, false, 0, 1, true),
  playback_state: f(
    CAT.MUSIC,
    TYPE.MUSIC.PLAYBACK_STATE,
    false,
    0,
    MUSIC_PLAYBACK_STATE.IDLE,
    true,
  ),
  play: f(CAT.MUSIC, TYPE.MUSIC.PLAY, false, 0, 1, false),
  pause: f(CAT.MUSIC, TYPE.MUSIC.PAUSE, false, 0, 1, false),
  stop: f(CAT.TELEVISION, TYPE.TELEVISION.STOP, false, 0, 1, false),
  previous: f(CAT.MUSIC, TYPE.MUSIC.PREVIOUS, false, 0, 1, false),
  next: f(CAT.MUSIC, TYPE.MUSIC.NEXT, false, 0, 1, false),
  volume: f(CAT.MUSIC, TYPE.MUSIC.VOLUME, false, 0, 100, true),
  mute: f(CAT.MUSIC, TYPE.MUSIC.MUTE, false, 0, 1, true),
  title: f(CAT.MUSIC, TYPE.MUSIC.TITLE, true, 0, 0, false),
  artist: f(CAT.MUSIC, TYPE.MUSIC.ARTIST, true, 0, 0, false),
  album: f(CAT.MUSIC, TYPE.MUSIC.ALBUM, true, 0, 0, false),
  artwork: f(CAT.MUSIC, TYPE.MUSIC.ARTWORK, true, 0, 0, false),
  duration: f(CAT.MUSIC, TYPE.MUSIC.DURATION, true, 0, MAX_SECONDS, false, { unit: SECONDS }),
  position: f(CAT.MUSIC, TYPE.MUSIC.POSITION, false, 0, MAX_SECONDS, true, { unit: SECONDS }),
  shuffle: f(CAT.MUSIC, TYPE.MUSIC.SHUFFLE, false, 0, 1, true),
  repeat: f(CAT.MUSIC, TYPE.MUSIC.REPEAT, false, 0, MUSIC_REPEAT_MODE.ONE, true),
  notification: f(CAT.MUSIC, TYPE.MUSIC.PLAY_NOTIFICATION, false, 0, 0, false),
};

/** The platform id of a player: its LMS id, lower case, without separators. */
export const platformIdOf = (playerId) => playerId.toLowerCase().replace(/[^a-z0-9]/g, '');

export const deviceIds = (gladys, playerId) =>
  gladys.externalIds(DEVICE_TYPE, platformIdOf(playerId));

/**
 * @param {object} gladys
 * @param {{ id: string, name: string, model: string }} player
 * @param {string} language
 */
export function buildDevice(gladys, player, language) {
  const names = pick(NAMES, language);
  const ids = deviceIds(gladys, player.id);
  return {
    name: player.name.slice(0, 60),
    external_id: ids.device,
    model: player.model || 'Squeezebox',
    // The container polls and listens to LMS itself (Gladys#3198).
    should_poll: false,
    params: [{ name: 'PLAYER_ID', value: player.id }],
    features: Object.entries(FEATURES).map(([key, definition]) => ({
      name: names[key],
      external_id: ids.feature(key),
      ...definition,
      // The core forces false on the music category anyway.
      keep_history: key === 'power',
    })),
  };
}

/** Feature states published with publishChangedStates: the power only. */
export function buildStates(gladys, playerId, snapshot) {
  const ids = deviceIds(gladys, playerId);
  return [{ device_feature_external_id: ids.feature('power'), state: snapshot.power ? 1 : 0 }];
}

// LMS `playlist repeat`: 0 off, 1 the song, 2 the playlist.
const REPEAT_FROM_LMS = [MUSIC_REPEAT_MODE.OFF, MUSIC_REPEAT_MODE.ONE, MUSIC_REPEAT_MODE.ALL];
export const REPEAT_TO_LMS = {
  [MUSIC_REPEAT_MODE.OFF]: 0,
  [MUSIC_REPEAT_MODE.ALL]: 2,
  [MUSIC_REPEAT_MODE.ONE]: 1,
};

const seconds = (value) => Math.min(MAX_SECONDS, Math.max(0, Math.round(Number(value) || 0)));

/** The Gladys playback state of a snapshot: off or offline is stopped. */
export function playbackState(snapshot) {
  if (!snapshot.connected || !snapshot.power || snapshot.tracks === 0) {
    return MUSIC_PLAYBACK_STATE.IDLE;
  }
  if (snapshot.mode === 'play') {
    return MUSIC_PLAYBACK_STATE.PLAYING;
  }
  return snapshot.mode === 'pause' ? MUSIC_PLAYBACK_STATE.PAUSED : MUSIC_PLAYBACK_STATE.IDLE;
}

/**
 * The snapshot given to publishNowPlaying (Gladys 5.3). Nothing loaded: the
 * texts are cleared explicitly (an absent key means "unchanged"). Stopped
 * with a queue (LMS keeps its current song): IDLE, the song stays shown. A
 * radio: the song it announces as title and the station as album, or the
 * station as title; duration 0 (live).
 * @param {object} snapshot parseStatus()
 * @param {string} baseUrl of the server, to make the artwork URL absolute
 */
export function nowPlaying(snapshot, baseUrl) {
  const state = playbackState(snapshot);
  const loaded = snapshot.tracks > 0;
  const result = {
    playback_state: state,
    title: '',
    artist: '',
    album: '',
    artwork_url: null,
    duration: 0,
    position: 0,
    shuffle: snapshot.shuffle > 0,
    repeat: REPEAT_FROM_LMS[snapshot.repeat] ?? MUSIC_REPEAT_MODE.OFF,
  };
  if (loaded) {
    if (snapshot.remote && snapshot.title && snapshot.station !== snapshot.title) {
      result.title = snapshot.title;
      result.artist = snapshot.artist;
      result.album = snapshot.station;
    } else {
      // A stream with neither song nor station: the name of its file.
      result.title = snapshot.title || snapshot.station || lastSegment(snapshot.url);
      result.artist = snapshot.artist;
      result.album = snapshot.remote ? '' : snapshot.album;
    }
    const path = artworkPath(snapshot, ARTWORK_SIZE);
    result.artwork_url = path ? `${baseUrl}${path}` : null;
    result.duration = seconds(snapshot.duration);
    if (state !== MUSIC_PLAYBACK_STATE.IDLE) {
      // Bounded by the duration only: a stream (duration 0) plays for days,
      // and a capped position would drift from the one the SDK extrapolates,
      // then be republished at every read.
      const time = Math.max(0, Math.round(Number(snapshot.time) || 0));
      result.position = result.duration > 0 ? Math.min(time, result.duration) : time;
    }
  }
  if (snapshot.volume !== null) {
    result.volume = snapshot.volume;
    result.mute = snapshot.muted;
  }
  return result;
}

/** The feature key of a feature external id (`...:player:0200...:volume` -> `volume`). */
export const featureKeyOf = (externalId) =>
  typeof externalId === 'string' ? externalId.split(':').at(-1) : '';
