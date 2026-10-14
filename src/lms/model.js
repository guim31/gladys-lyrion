// -----------------------------------------------------------------------------
// LMS answers -> plain snapshots. Fields come as numbers or numeric strings
// depending on the command and the version: everything goes through num().
// -----------------------------------------------------------------------------

export const MODES = ['play', 'pause', 'stop'];

const num = (value, fallback = null) => {
  const number = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof number === 'number' && Number.isFinite(number) ? number : fallback;
};
const str = (value) => (typeof value === 'string' ? value.trim() : '');

/** `serverstatus` -> the server and its players. */
export function parseServer(result = {}) {
  const players = (Array.isArray(result.players_loop) ? result.players_loop : [])
    .filter((p) => typeof p?.playerid === 'string' && p.playerid !== '')
    .map((p) => ({
      id: p.playerid,
      name: str(p.name) || p.playerid,
      model: str(p.modelname) || str(p.model),
      connected: num(p.connected, 0) === 1,
      canPowerOff: num(p.canpoweroff, 1) === 1,
    }));
  return { version: str(result.version), uuid: str(result.uuid), players };
}

/**
 * `status - 1 tags:acdjKlNu` -> snapshot of a player.
 * The volume is negative while muted (LMS keeps the level to restore).
 */
export function parseStatus(result = {}) {
  const track = Array.isArray(result.playlist_loop) ? (result.playlist_loop[0] ?? {}) : {};
  const rawVolume = num(result['mixer volume'], null);
  const tracks = num(result.playlist_tracks, 0);
  const mode = MODES.includes(result.mode) ? result.mode : 'stop';
  // A radio puts the song in current_title ("Artist - Title") and the station
  // in the track title / remote_title.
  const streamTitle = str(result.current_title);
  const remote = num(track.remote, 0) === 1;
  let title = str(track.title);
  let artist = str(track.artist);
  if (remote && streamTitle && !artist) {
    const dash = streamTitle.indexOf(' - ');
    if (dash > 0) {
      artist = streamTitle.slice(0, dash).trim();
      title = streamTitle.slice(dash + 3).trim();
    } else {
      title = streamTitle;
    }
  }
  return {
    connected: num(result.player_connected, 1) === 1,
    power: num(result.power, 1) === 1,
    mode,
    volume: rawVolume === null ? null : Math.min(100, Math.abs(Math.round(rawVolume))),
    muted: rawVolume !== null && rawVolume < 0,
    tracks,
    index: tracks > 0 ? num(result.playlist_cur_index, 0) : null,
    time: num(result.time, 0),
    duration: num(track.duration ?? result.duration, null),
    repeat: num(result['playlist repeat'], 0),
    title: tracks > 0 ? title : '',
    artist: tracks > 0 ? artist : '',
    album: tracks > 0 ? str(track.album) : '',
    station: remote ? str(track.remote_title) : '',
    url: str(track.url),
    trackId: track.id ?? null,
    coverId: num(track.coverart, 0) === 1 && track.coverid ? String(track.coverid) : '',
    artworkUrl: str(track.artwork_url),
    syncMaster: str(result.sync_master),
    syncSlaves: str(result.sync_slaves)
      .split(',')
      .map((id) => id.trim())
      .filter(Boolean),
  };
}

/** The player plays something right now. */
export const isPlaying = (snapshot) =>
  Boolean(snapshot?.connected && snapshot.power && snapshot.mode === 'play');

/** What identifies the current song: a radio keeps its URL and changes title. */
export function trackKey(snapshot) {
  if (!snapshot || snapshot.tracks === 0) {
    return '';
  }
  return [snapshot.url || snapshot.trackId, snapshot.title, snapshot.artist].join('|');
}

/** `favorites items` -> the playable favorites, in the order of LMS. */
export function parseFavorites(result = {}) {
  const loop = Array.isArray(result.loop_loop) ? result.loop_loop : [];
  return loop
    .filter((item) => typeof item?.id === 'string' && num(item.isaudio, 0) === 1)
    .map((item) => ({ id: item.id, name: str(item.name) }));
}
