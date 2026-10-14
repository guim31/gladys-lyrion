// -----------------------------------------------------------------------------
// LMS player -> Gladys device, and snapshot -> feature states.
//
// Couples chosen among those the Gladys front knows (test/gladys-rules.test.js):
// - play, pause, previous, next, volume, playback_state: the `music` category,
//   the one the core "Music" dashboard box reads and drives;
// - notification: music/play_notification, the target of the core "play a
//   notification" scene action (it sends the URL of an MP3);
// - stop and mute: the core has no music stop nor mute, they borrow the
//   television remote-control keys (push buttons in the device box);
// - power: switch/binary (a toggle);
// - title, artist: text/text (two of them: the dashboard shows their names).
// The music features have no row in the "devices in room" box (only the
// Music box shows them): the widget of the integration covers that.
//
// The external id comes from the LMS player id (the MAC of a Squeezebox or of
// squeezelite), never from its name. Feature keys are forever.
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as CAT,
  DEVICE_FEATURE_TYPES as TYPE,
} from '@gladysassistant/integration-sdk';
import { isPlaying } from './lms/model.js';
import { NAMES, NOTHING_PLAYING, UNKNOWN_TITLE, pick } from './texts.js';

export const DEVICE_TYPE = 'player';

const MAX_TEXT = 200;

// key -> [category, type, read_only, min, max, has_feedback]
export const FEATURES = {
  power: [CAT.SWITCH, TYPE.SWITCH.BINARY, false, 0, 1, true],
  playback_state: [CAT.MUSIC, TYPE.MUSIC.PLAYBACK_STATE, true, 0, 1, false],
  play: [CAT.MUSIC, TYPE.MUSIC.PLAY, false, 0, 1, false],
  pause: [CAT.MUSIC, TYPE.MUSIC.PAUSE, false, 0, 1, false],
  stop: [CAT.TELEVISION, TYPE.TELEVISION.STOP, false, 0, 1, false],
  previous: [CAT.MUSIC, TYPE.MUSIC.PREVIOUS, false, 0, 1, false],
  next: [CAT.MUSIC, TYPE.MUSIC.NEXT, false, 0, 1, false],
  // LMS reports every volume change (CLI event, then a status read).
  volume: [CAT.MUSIC, TYPE.MUSIC.VOLUME, false, 0, 100, true],
  mute: [CAT.TELEVISION, TYPE.TELEVISION.VOLUME_MUTE, false, 0, 1, false],
  title: [CAT.TEXT, TYPE.TEXT.TEXT, true, 0, 0, false],
  artist: [CAT.TEXT, TYPE.TEXT.TEXT, true, 0, 0, false],
  notification: [CAT.MUSIC, TYPE.MUSIC.PLAY_NOTIFICATION, false, 0, 0, false],
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
    features: Object.entries(FEATURES).map(
      ([key, [category, type, readOnly, min, max, feedback]]) => ({
        name: names[key],
        external_id: ids.feature(key),
        category,
        type,
        read_only: readOnly,
        has_feedback: feedback,
        keep_history: key === 'playback_state' || key === 'power',
        min,
        max,
      }),
    ),
  };
}

/** The title state: the song, or a dash when nothing is loaded. */
export function titleText(snapshot, language) {
  if (snapshot.tracks === 0) {
    return pick(NOTHING_PLAYING, language);
  }
  return (snapshot.title || snapshot.station || pick(UNKNOWN_TITLE, language)).slice(0, MAX_TEXT);
}

export function artistText(snapshot, language) {
  if (snapshot.tracks === 0) {
    return pick(NOTHING_PLAYING, language);
  }
  return (snapshot.artist || snapshot.station || pick(NOTHING_PLAYING, language)).slice(
    0,
    MAX_TEXT,
  );
}

/** Feature states of a snapshot, in the publishStates format. */
export function buildStates(gladys, playerId, snapshot, language) {
  const ids = deviceIds(gladys, playerId);
  const states = [
    { device_feature_external_id: ids.feature('power'), state: snapshot.power ? 1 : 0 },
    {
      device_feature_external_id: ids.feature('playback_state'),
      state: isPlaying(snapshot) ? 1 : 0,
    },
    { device_feature_external_id: ids.feature('title'), text: titleText(snapshot, language) },
    { device_feature_external_id: ids.feature('artist'), text: artistText(snapshot, language) },
  ];
  if (snapshot.volume !== null) {
    states.push({ device_feature_external_id: ids.feature('volume'), state: snapshot.volume });
  }
  return states;
}

/** The feature key of a feature external id (`...:player:0200...:volume` -> `volume`). */
export const featureKeyOf = (externalId) =>
  typeof externalId === 'string' ? externalId.split(':').at(-1) : '';
