// -----------------------------------------------------------------------------
// The catalog of the Gladys 5.3 music panel (manifest `music`): browse,
// search, play and the queue, read on demand from Lyrion, never stored. Every
// answer is a list of MediaItems whose `id` is ours (opaque to Gladys, carried
// back by a play command and by the `music.play-media` scene action):
//   lms:favorites, lms:playlists, lms:artists, lms:albums   the root folders
//   favdir:<index>        a folder of the favorites ("3", "3.1": its position)
//   fav:<url>             a playable favorite (a radio, a song, an album…)
//   track|album|artist|playlist:<id>:<url>   the LMS library: the id to
//                         browse, the URL to play (`db:album.title=…`, the
//                         `favorites_url` of LMS, or the file URL), which
//                         survives a library wiped and rescanned (new ids)
//   url:<url>             a queue song without a library id (a radio)
//   queue:<index>         a queue row that has neither (never dropped)
//
// What Lyrion gives (checked on 9.1.1 with squeezelite players):
//   - every library command pages itself (`<start> <count>`) and answers the
//     full size in `count`: the pages of Gladys go straight through;
//   - `playlist play|insert|add <url>` plays, or queues after the current
//     song or at the end, any URL LMS knows: a file, a stream, a saved
//     playlist, `db:album.title=…&contributor.name=…` (an album or an artist);
//     LMS builds the queue itself, an artist of thousands of songs included.
//     Without a URL, `playlistcontrol cmd:load|insert|add <kind>_id:<id>`,
//     which answers the number of songs;
//   - a URL or an id LMS does not know leaves an empty queue on `play` and
//     `load`: a replace is checked by reading the length of the queue;
//   - the favorites answer an id prefixed with a session (`555fb4c9.3`),
//     different on each call: only the position after the dot is kept; a
//     favorite plays by its URL (`playlist play <url> <title>`, `db:album…`
//     URLs included), which survives a reordering of the favorites;
//   - `status <start> <count>` pages the queue in play order (shuffled when
//     shuffle is on), with `playlist index`, the length and the current index;
//   - covers are resized by LMS (`/music/<coverid>/cover_64x64_o`).
// -----------------------------------------------------------------------------

import {
  MUSIC_MEDIA_TYPES,
  MUSIC_PLAY_MODES,
  createLogger,
} from '@gladysassistant/integration-sdk';
import { artworkPath, parseQueue } from './lms/model.js';
import { CATALOG_FOLDERS, pick } from './texts.js';

const logger = createLogger({ name: 'lyrion-catalog' });

const { TRACK, ALBUM, ARTIST, PLAYLIST, RADIO, FOLDER } = MUSIC_MEDIA_TYPES;

// Bounds of the core (capabilities/music.md, section 4.2).
const MAX_ID = 512;
const MAX_TEXT = 200;

// List thumbnails render under 64 px.
export const THUMBNAIL_SIZE = 64;

// The favorites searched by name (the top level).
const MAX_FAVORITES = 200;

const TRACK_TAGS = 'tags:acdjKlNu';
const ALBUM_TAGS = 'tags:laj';

export const ROOTS = ['favorites', 'playlists', 'artists', 'albums'];

// Play modes -> `playlistcontrol cmd:` and `playlist` sub-commands.
const LOAD = {
  [MUSIC_PLAY_MODES.REPLACE]: ['load', 'play'],
  [MUSIC_PLAY_MODES.NEXT]: ['insert', 'insert'],
  [MUSIC_PLAY_MODES.APPEND]: ['add', 'add'],
};

// The library kinds and their `playlistcontrol` parameter.
const LIBRARY_KINDS = {
  track: 'track_id',
  album: 'album_id',
  artist: 'artist_id',
  playlist: 'playlist_id',
};

const text = (value) =>
  typeof value === 'string' || typeof value === 'number' ? String(value).trim() : '';
const clip = (value) => text(value).slice(0, MAX_TEXT);
const int = (value) => (/^\d+$/.test(text(value)) ? text(value) : null);
const fold = (value) => text(value).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

/** `kind:id:url` of a library item, `kind:id` when the URL is too long or absent. */
function libraryId(kind, id, url) {
  const full = `${kind}:${id}:${text(url)}`;
  return text(url) && full.length <= MAX_ID ? full : `${kind}:${id}`;
}

/** The id and the URL of the `rest` of a library item id. */
function parseLibrary(rest) {
  const colon = rest.indexOf(':');
  const id = int(colon < 0 ? rest : rest.slice(0, colon));
  return { id, url: colon < 0 ? '' : rest.slice(colon + 1) };
}

/** Split `kind:rest` (rest may hold colons: a URL). */
function parseId(id) {
  const value = typeof id === 'string' ? id : '';
  const colon = value.indexOf(':');
  return colon < 0
    ? { kind: '', rest: '' }
    : { kind: value.slice(0, colon), rest: value.slice(colon + 1) };
}

/** The artwork key of an LMS image at thumbnail size, or undefined. */
function thumbnail(hub, source) {
  const path = artworkPath(source, THUMBNAIL_SIZE);
  return path ? hub.gladys.artworkKey(`${hub.config.baseUrl}${path}`) : undefined;
}

const withArtwork = (item, key) => (key ? { ...item, artwork_key: key } : item);

const lastSegment = (url) => {
  const segment =
    url
      .replace(/[?#].*$/, '')
      .split('/')
      .pop() ?? '';
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
};

/** A stream rather than a song: an http(s) URL of no known length. */
const isRadio = (url, duration) => /^https?:\/\//i.test(url) && !(Number(duration) > 0);

/**
 * A MediaItem of a song (library, playlist, search, queue). Null when it has
 * no usable id, unless `index` is given (a queue row is never dropped: the
 * page must stay aligned with the indexes of the queue).
 */
export function songItem(hub, song, index = null) {
  const url = text(song?.url);
  const trackId = int(song?.id);
  let id;
  if (trackId) {
    id = libraryId('track', trackId, url);
  } else if (url && url.length + 4 <= MAX_ID) {
    id = `url:${url}`;
  } else if (index !== null) {
    id = `queue:${index}`;
  } else {
    return null;
  }
  const duration = Number(song.duration);
  const radio = isRadio(url, duration);
  // A radio without stream metadata is named after its file ("fip-midfi.mp3"):
  // the station name (`remote_title`, from the playlist or the stream) is better.
  const fileName = clip(lastSegment(url));
  const station = clip(song.remote_title);
  const named = clip(song.title) && !(radio && station && clip(song.title) === fileName);
  const title = (named ? clip(song.title) : station) || fileName || '?';
  const item = {
    id,
    type: radio ? RADIO : TRACK,
    title,
    duration: duration > 0 ? Math.round(duration) : null,
    browsable: false,
    playable: true,
  };
  const artist = clip(song.artist);
  if (artist && artist !== title) {
    item.subtitle = artist;
  } else if (radio && station && station !== title) {
    item.subtitle = station;
  }
  const coverId = text(song.coverart) === '1' ? text(song.coverid) : '';
  return withArtwork(item, thumbnail(hub, { coverId, artworkUrl: text(song.artwork_url) }));
}

export function albumItem(hub, album) {
  const id = int(album?.id);
  if (!id) {
    return null;
  }
  const item = {
    id: libraryId('album', id, album.favorites_url),
    type: ALBUM,
    title: clip(album.album) || clip(album.title) || '?',
    browsable: true,
    playable: true,
  };
  if (clip(album.artist)) {
    item.subtitle = clip(album.artist);
  }
  return withArtwork(item, thumbnail(hub, { coverId: text(album.artwork_track_id) }));
}

export function artistItem(artist) {
  const id = int(artist?.id);
  return id
    ? {
        id: libraryId('artist', id, artist.favorites_url),
        type: ARTIST,
        title: clip(artist.artist) || '?',
        browsable: true,
        playable: true,
      }
    : null;
}

export function playlistItem(playlist) {
  const id = int(playlist?.id);
  return id
    ? {
        id: libraryId('playlist', id, playlist.url),
        type: PLAYLIST,
        title: clip(playlist.playlist) || '?',
        browsable: true,
        playable: true,
      }
    : null;
}

/** The type of a favorite from its URL. */
function favoriteType(url) {
  if (url.startsWith('db:album')) {
    return ALBUM;
  }
  if (url.startsWith('db:contributor')) {
    return ARTIST;
  }
  if (url.startsWith('file:')) {
    return TRACK;
  }
  return RADIO;
}

/**
 * A MediaItem of a favorite: a folder, or a playable URL. Null otherwise.
 * LMS 9.1.1 answers `<session>.<n>` at the top level and `<folder>.<n>`
 * inside a folder: only the last number is read, the path is ours.
 * @param {object} hub
 * @param {object} favorite an item of `favorites items`
 * @param {string} [folder] the position of the folder listed ('' at the top)
 */
export function favoriteItem(hub, favorite, folder = '') {
  const last = text(favorite?.id).split('.').pop();
  const position = /^\d+$/.test(last) ? (folder ? `${folder}.${last}` : last) : '';
  const title = clip(favorite?.name) || '?';
  if (Number(favorite?.hasitems) === 1 && position) {
    return { id: `favdir:${position}`, type: FOLDER, title, browsable: true, playable: false };
  }
  const url = text(favorite?.url);
  if (Number(favorite?.isaudio) !== 1 || !url || url.length + 4 > MAX_ID) {
    return null;
  }
  const item = {
    id: `fav:${url}`,
    type: favoriteType(url),
    title,
    browsable: false,
    playable: true,
  };
  return withArtwork(item, thumbnail(hub, { artworkUrl: text(favorite.image) }));
}

const loop = (result, name) => (Array.isArray(result?.[name]) ? result[name] : []);
const count = (result) => Math.max(0, Number(result?.count) || 0);

/** The player of a device of a music command (a coded error the panel shows). */
const playerOf = (hub, device, options) => hub.playerOf(device?.external_id, options);

/**
 * onMusicBrowse: the root folders, then any level, paged by LMS.
 * @returns {Promise<{ items: object[], total: number }>}
 */
export async function browse(hub, device, { parentId = null, offset = 0, limit = 50 } = {}) {
  playerOf(hub, device, { connected: false });
  const page = [offset, limit];
  if (parentId === null) {
    const items = ROOTS.map((root) => ({
      id: `lms:${root}`,
      type: FOLDER,
      title: pick(CATALOG_FOLDERS[root], hub.language),
      browsable: true,
      playable: false,
    }));
    return { items: items.slice(offset, offset + limit), total: items.length };
  }
  const { kind, rest } = parseId(parentId);
  const { id } = parseLibrary(rest);
  let result;
  let items;
  if (parentId === 'lms:favorites' || (kind === 'favdir' && /^\d+(\.\d+)*$/.test(rest))) {
    const folder = kind === 'favdir' ? [`item_id:${rest}`] : [];
    result = await hub.query('', ['favorites', 'items', ...page, 'want_url:1', ...folder]);
    items = loop(result, 'loop_loop').map((favorite) =>
      favoriteItem(hub, favorite, kind === 'favdir' ? rest : ''),
    );
  } else if (parentId === 'lms:playlists') {
    result = await hub.query('', ['playlists', ...page, 'tags:u']);
    items = loop(result, 'playlists_loop').map(playlistItem);
  } else if (parentId === 'lms:artists') {
    result = await hub.query('', ['artists', ...page]);
    items = loop(result, 'artists_loop').map(artistItem);
  } else if (parentId === 'lms:albums') {
    result = await hub.query('', ['albums', ...page, ALBUM_TAGS, 'sort:album']);
    items = loop(result, 'albums_loop').map((album) => albumItem(hub, album));
  } else if (kind === 'artist' && id) {
    result = await hub.query('', ['albums', ...page, `artist_id:${id}`, ALBUM_TAGS, 'sort:album']);
    items = loop(result, 'albums_loop').map((album) => albumItem(hub, album));
  } else if (kind === 'album' && id) {
    result = await hub.query('', [
      'titles',
      ...page,
      `album_id:${id}`,
      'sort:tracknum',
      TRACK_TAGS,
    ]);
    items = loop(result, 'titles_loop').map((song) => songItem(hub, song));
  } else if (kind === 'playlist' && id) {
    result = await hub.query('', ['playlists', 'tracks', ...page, `playlist_id:${id}`, TRACK_TAGS]);
    items = loop(result, 'playlisttracks_loop').map((song) => songItem(hub, song));
  } else {
    return { items: [], total: 0 };
  }
  return { items: items.filter(Boolean), total: count(result) };
}

/**
 * Search results of every type in one list of `limit`: the radios, the
 * playlists, the artists and the albums first (a quarter of the list each at
 * most), the songs after, then what is left of the others.
 */
export function mixResults(groups, limit) {
  const share = Math.max(1, Math.floor(limit / 4));
  const heads = [RADIO, PLAYLIST, ARTIST, ALBUM];
  const first = heads.flatMap((type) => (groups[type] ?? []).slice(0, share));
  const rest = heads.flatMap((type) => (groups[type] ?? []).slice(share));
  return [...first, ...(groups[TRACK] ?? []), ...rest].slice(0, limit);
}

/**
 * onMusicSearch: the LMS library (artists, albums, songs, playlists) and the
 * favorites by name (the radios are there).
 * @returns {Promise<{ items: object[] }>}
 */
export async function search(hub, device, { query, type = null, limit = 20 } = {}) {
  playerOf(hub, device, { connected: false });
  const term = text(query);
  if (!term) {
    return { items: [] };
  }
  const wants = (wanted) => type === null || type === wanted;
  const page = [0, limit, `search:${term}`];
  const ask = (enabled, command, read) =>
    enabled ? hub.query('', command).then(read) : Promise.resolve([]);
  const [artists, albums, songs, playlists, favorites] = await Promise.all([
    ask(wants(ARTIST), ['artists', ...page], (r) => loop(r, 'artists_loop').map(artistItem)),
    ask(wants(ALBUM), ['albums', ...page, ALBUM_TAGS], (r) =>
      loop(r, 'albums_loop').map((album) => albumItem(hub, album)),
    ),
    ask(wants(TRACK), ['titles', ...page, TRACK_TAGS], (r) =>
      loop(r, 'titles_loop').map((song) => songItem(hub, song)),
    ),
    ask(wants(PLAYLIST), ['playlists', ...page, 'tags:u'], (r) =>
      loop(r, 'playlists_loop').map(playlistItem),
    ),
    ask(type !== FOLDER, ['favorites', 'items', 0, MAX_FAVORITES, 'want_url:1'], (r) =>
      loop(r, 'loop_loop')
        .filter((favorite) => fold(favorite?.name).includes(fold(term)))
        .map((favorite) => favoriteItem(hub, favorite)),
    ),
  ]);
  const groups = { [ARTIST]: artists, [ALBUM]: albums, [TRACK]: songs, [PLAYLIST]: playlists };
  groups[RADIO] = [];
  for (const key of Object.keys(groups)) {
    // The favorites first: the user chose them.
    const chosen = favorites.filter((favorite) => favorite?.type === key);
    groups[key] = [...chosen, ...groups[key].filter(Boolean)];
  }
  const items = type === null ? mixResults(groups, limit) : (groups[type] ?? []).slice(0, limit);
  return { items };
}

/** The title of a favorite by its URL (top level), for LMS to show it. */
async function favoriteTitle(hub, url) {
  try {
    const result = await hub.query('', ['favorites', 'items', 0, MAX_FAVORITES, 'want_url:1']);
    return text(loop(result, 'loop_loop').find((favorite) => favorite?.url === url)?.name);
  } catch {
    return '';
  }
}

/** onMusicPlay (and the `music.play-media` scene action). */
export async function play(hub, device, media, mode = MUSIC_PLAY_MODES.REPLACE) {
  const player = playerOf(hub, device);
  const load = LOAD[mode];
  if (!load) {
    throw new Error(`Unknown play mode ${mode}`);
  }
  const { kind, rest } = parseId(media?.id);
  if (media?.type === FOLDER || kind === 'lms' || kind === 'favdir') {
    throw hub.error('folder_not_playable');
  }
  const library = LIBRARY_KINDS[kind] ? parseLibrary(rest) : null;
  let command;
  if (library?.url) {
    command = ['playlist', load[1], library.url];
  } else if (library?.id) {
    command = ['playlistcontrol', `cmd:${load[0]}`, `${LIBRARY_KINDS[kind]}:${library.id}`];
  } else if ((kind === 'fav' || kind === 'url') && rest) {
    const title = kind === 'fav' ? await favoriteTitle(hub, rest) : '';
    command = ['playlist', load[1], rest, ...(title ? [title] : [])];
  } else {
    throw hub.error('not_playable');
  }
  if (player.snapshot && !player.snapshot.power) {
    await hub.send(player.id, ['power', '1']);
  }
  const result = await hub.send(player.id, command);
  if (command[0] === 'playlistcontrol' && Number(result?.count) === 0) {
    throw hub.error('not_playable');
  }
  if (command[0] === 'playlist' && mode === MUSIC_PLAY_MODES.REPLACE) {
    // LMS answers {} whatever happened: an unknown URL leaves an empty queue.
    const { total } = parseQueue(await hub.query(player.id, ['status', '-', 1, 'tags:u']));
    if (total === 0) {
      throw hub.error('not_playable');
    }
  }
  logger.info(`${player.name}: ${mode} ${kind}`);
}

/**
 * onMusicQueueGet: a page of the queue of the player, in play order.
 * @returns {Promise<{ items: object[], currentIndex: number|null, total: number }>}
 */
export async function queueGet(hub, device, { offset = 0, limit = 50 } = {}) {
  const player = playerOf(hub, device);
  const { songs, total, current } = parseQueue(
    await hub.query(player.id, ['status', offset, limit, TRACK_TAGS]),
  );
  const items = songs.map((song, i) => {
    const index = Number.isInteger(Number(song['playlist index']))
      ? Number(song['playlist index'])
      : offset + i;
    return songItem(hub, song, index);
  });
  return { items, currentIndex: current, total };
}

/** onMusicQueuePlay: jump to an item of the queue. */
export async function queuePlay(hub, device, index) {
  const player = playerOf(hub, device);
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`Invalid queue index ${index}`);
  }
  const { total } = parseQueue(await hub.query(player.id, ['status', '-', 1, 'tags:u']));
  if (index >= total) {
    throw hub.error('not_in_queue');
  }
  if (player.snapshot && !player.snapshot.power) {
    await hub.send(player.id, ['power', '1']);
  }
  await hub.send(player.id, ['playlist', 'index', index]);
  logger.info(`${player.name}: queue item ${index}`);
}
