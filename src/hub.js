// -----------------------------------------------------------------------------
// The hub: one Lyrion Music Server, its players, and everything Gladys sees of
// them (devices, states, scene events, widget, commands).
//
// Reading: JSON-RPC (`serverstatus`, then `status` per connected player) on a
// timer of the container (Gladys#3198), fast while the CLI is closed, slow
// while it is open; every CLI event schedules an early read. Only the changes
// reach Gladys: the music features through publishNowPlaying (diffed by the
// SDK, the position only on a change of state or song, or a seek), the power
// through publishChangedStates, with a heartbeat.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { DEVICE_FEATURE_CATEGORIES, MUSIC_PLAYBACK_STATE } from '@gladysassistant/integration-sdk';
import {
  ARTWORK_SIZE,
  REPEAT_TO_LMS,
  buildDevice,
  buildStates,
  deviceIds,
  featureKeyOf,
  nowPlaying,
} from './devices.js';
import { LmsClient, LmsError } from './lms/client.js';
import { CliListener, RECONNECT_MIN_MS, SETTLE_MS } from './lms/listener.js';
import {
  artworkPath,
  isPlaying,
  parseFavorites,
  parseServer,
  parseStatus,
  trackKey,
} from './lms/model.js';
import { STATUS_TEXT, commandMessage } from './texts.js';

const logger = createLogger({ name: 'lyrion-hub' });

export const WIDGET_KEY = 'players';

export const TRIGGERS = {
  STARTED: 'playback_started',
  STOPPED: 'playback_stopped',
  TRACK: 'track_changed',
};

export const TIMINGS = {
  fastPollMs: 5_000, // CLI closed: the timer is the only source
  slowPollMs: 30_000, // CLI open: the timer only catches what it missed
  debounceMs: 300, // a song change is a burst of CLI events
  announceCheckMs: 1_000,
  announceStartMs: 15_000, // the stream must start within this delay
  announceMaxMs: 10 * 60_000, // an announcement longer than this is cut
  cliSettleMs: SETTLE_MS,
  cliReconnectMs: RECONNECT_MIN_MS,
};

// A stable value is re-published twice a day (the front greys out a value
// older than 48 h).
const HEARTBEAT_MS = 6 * 60 * 60_000;

// requestWidgetRefresh is dropped by the core beyond one call per 10 s.
const WIDGET_REFRESH_GAP_MS = 10_500;

/** An Error carrying a coded, multi-language message. */
export class CommandError extends Error {
  constructor(code, language = 'en') {
    const messages = commandMessage(code);
    super(messages[language] ?? messages.en);
    this.code = code;
    this.messages = messages;
  }
}

const sleep = (ms) =>
  new Promise((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

const clampVolume = (value) => Math.max(0, Math.min(100, Math.round(Number(value))));

export class Hub {
  /**
   * @param {{ gladys: object, fetch?: typeof fetch, connect?: Function,
   *   timings?: object, now?: () => number }} options
   */
  constructor({ gladys, fetch, connect, timings, now }) {
    this.gladys = gladys;
    this.fetch = fetch;
    this.connect = connect;
    this.timings = { ...TIMINGS, ...timings };
    this.now = now ?? Date.now;
    this.config = null;
    this.client = null;
    this.listener = null;
    /** @type {Map<string, object>} LMS player id -> player entry */
    this.players = new Map();
    this.server = null;
    this.serverError = undefined; // undefined: never read; null: fine; else the code
    this.lastStatus = null;
    this.timer = null;
    this.soonTimer = null;
    this.refreshing = null;
    this.again = false;
    this.widgetRefreshAt = 0;
    this.widgetTimer = null;
    this.images = new Map(); // widget image key -> LMS path
    this.stopped = false;
    this.generation = 0;
  }

  get language() {
    return this.config?.language ?? 'fr';
  }

  // --- Lifecycle -----------------------------------------------------------

  async start(config) {
    this.config = config;
    this.#setup();
    await this.refresh();
    this.#schedule();
  }

  /** The configuration changed: new server, credentials or language. */
  async reconfigure(config) {
    const sameServer = this.config?.baseUrl === config.baseUrl;
    this.#teardown();
    if (!sameServer) {
      this.players.clear();
      this.server = null;
    }
    this.serverError = undefined;
    this.config = config;
    this.#setup();
    await this.refresh();
    // The feature names follow the language: publish again.
    await this.publishDevices();
    this.#schedule();
  }

  /** Gladys came back: it may have lost the discovered devices. */
  async resync() {
    this.gladys.forgetPublishedStates?.();
    await this.refresh();
    await this.publishDevices();
  }

  stop() {
    this.stopped = true;
    this.#teardown();
    clearTimeout(this.widgetTimer);
  }

  #teardown() {
    this.generation += 1;
    clearTimeout(this.timer);
    clearTimeout(this.soonTimer);
    this.timer = null;
    this.soonTimer = null;
    // Listeners off first: a deliberate stop is not a lost CLI.
    this.listener?.removeAllListeners();
    this.listener?.stop();
    this.listener = null;
    this.client = null;
  }

  #setup() {
    const config = this.config;
    if (!config.configured || !config.valid) {
      this.#setStatus(false, config.configured ? 'invalid_host' : 'not_configured');
      if (config.configured) {
        logger.warn('The server address is not valid');
      }
      return;
    }
    this.client = new LmsClient({
      baseUrl: config.baseUrl,
      username: config.username,
      password: config.password,
      fetch: this.fetch,
    });
    if (config.cliPort > 0) {
      const listener = new CliListener({
        host: config.host.replace(/^\[|\]$/g, ''),
        port: config.cliPort,
        username: config.username,
        password: config.password,
        connect: this.connect,
        settleMs: this.timings.cliSettleMs,
        reconnectMinMs: this.timings.cliReconnectMs,
      });
      listener.on('event', () => this.soon());
      listener.on('up', () => {
        logger.info('Listening to the Lyrion CLI');
        this.soon();
        this.#schedule();
      });
      listener.on('down', () => {
        logger.info('The Lyrion CLI is closed: reading the players more often');
        this.#schedule();
      });
      this.listener = listener;
      listener.start();
    }
  }

  #schedule() {
    clearTimeout(this.timer);
    if (this.stopped || !this.client) {
      return;
    }
    const generation = this.generation;
    const delay = this.listener?.up ? this.timings.slowPollMs : this.timings.fastPollMs;
    this.timer = setTimeout(async () => {
      await this.refresh();
      if (generation === this.generation) {
        this.#schedule();
      }
    }, delay);
    this.timer.unref?.();
  }

  /** An early read, debounced (a CLI event, a command just sent). */
  soon() {
    if (this.soonTimer || !this.client) {
      return;
    }
    this.soonTimer = setTimeout(() => {
      this.soonTimer = null;
      this.refresh();
    }, this.timings.debounceMs);
    this.soonTimer.unref?.();
  }

  // --- Reading -------------------------------------------------------------

  /** Reads the server and its players; one read at a time, never fails. */
  refresh() {
    if (this.refreshing) {
      this.again = true;
      return this.refreshing;
    }
    this.refreshing = (async () => {
      do {
        this.again = false;
        await this.#read();
      } while (this.again && !this.stopped);
    })().finally(() => {
      this.refreshing = null;
    });
    return this.refreshing;
  }

  async #read() {
    const client = this.client;
    if (!client) {
      return;
    }
    let server;
    try {
      server = parseServer(await client.serverStatus());
    } catch (err) {
      this.#serverDown(err);
      return;
    }
    if (client !== this.client) {
      return; // reconfigured meanwhile
    }
    this.server = server;
    if (this.serverError !== null) {
      logger.info(
        `Connected to Lyrion Music Server ${server.version || ''} (${server.players.length} players)`,
      );
      this.serverError = null;
    }
    this.#setStatus(true);

    let added = false;
    const listed = new Set();
    for (const info of server.players) {
      listed.add(info.id);
      let player = this.players.get(info.id);
      if (!player) {
        player = { id: info.id, snapshot: null, lastTrack: null, announcing: false };
        this.players.set(info.id, player);
        added = true;
      }
      if (player.connected === false && info.connected) {
        logger.info(`Player ${info.name} is back`);
      } else if (player.connected && !info.connected) {
        logger.info(`Player ${info.name} is offline`);
      }
      Object.assign(player, info);
    }
    for (const player of this.players.values()) {
      if (!listed.has(player.id) && player.connected !== false) {
        logger.info(`Player ${player.name} left the server`);
        player.connected = false;
      }
    }
    if (added) {
      await this.publishDevices();
    }

    for (const player of this.players.values()) {
      if (!player.connected) {
        if (player.snapshot?.connected) {
          this.#apply(player, { ...player.snapshot, connected: false });
        }
        continue;
      }
      try {
        const snapshot = parseStatus(await client.status(player.id));
        if (client !== this.client) {
          return;
        }
        this.#apply(player, snapshot);
      } catch (err) {
        logger.debug(`Cannot read player ${player.name}: ${err.message}`);
      }
    }
  }

  #serverDown(err) {
    const code = err instanceof LmsError ? err.code : 'protocol';
    if (this.serverError !== code) {
      logger.warn(`Lyrion Music Server unavailable: ${err.message}`);
    } else {
      logger.debug(`Lyrion Music Server still unavailable: ${err.message}`);
    }
    this.serverError = code;
    this.#setStatus(false, code);
    // Without the server, nothing is known of the players: offline, not
    // "playing" for hours.
    for (const player of this.players.values()) {
      if (player.snapshot?.connected) {
        this.#apply(player, { ...player.snapshot, connected: false });
      }
    }
  }

  async #setStatus(connected, code = null) {
    const fingerprint = `${connected}:${code}`;
    if (this.lastStatus === fingerprint) {
      return;
    }
    this.lastStatus = fingerprint;
    try {
      await this.gladys.setConnectionStatus(connected, code ? STATUS_TEXT[code] : undefined);
    } catch (err) {
      this.lastStatus = null;
      logger.debug(`Cannot set the connection status: ${err.message}`);
    }
  }

  /** A new snapshot of a player: states, scene events, widget. */
  #apply(player, snapshot) {
    const previous = player.snapshot;
    player.snapshot = snapshot;
    if (player.announcing) {
      // The announcement and its restoration are not the user's music.
      return;
    }
    const key = trackKey(snapshot);
    if (!previous || !previous.connected) {
      // First read, or back from offline: the reference, no scene event.
      player.lastTrack = key;
    } else if (snapshot.connected) {
      const was = isPlaying(previous);
      const now = isPlaying(snapshot);
      if (!was && now) {
        this.#fire(TRIGGERS.STARTED, player);
      } else if (was && !now) {
        let state = 'stopped';
        if (!snapshot.power) {
          state = 'off';
        } else if (snapshot.mode === 'pause') {
          state = 'paused';
        }
        this.#fire(TRIGGERS.STOPPED, player, { state });
      }
      if (now && key !== player.lastTrack) {
        this.#fire(TRIGGERS.TRACK, player);
      }
      if (now || snapshot.tracks === 0) {
        player.lastTrack = key;
      }
    }
    this.publishStates(player);
    if (!previous || this.#visible(previous) !== this.#visible(snapshot)) {
      this.refreshWidget();
    }
  }

  #visible(s) {
    return [s.connected, s.power, s.mode, s.volume, s.muted, s.title, s.artist, s.album].join('|');
  }

  #fire(key, player, extra = {}) {
    const { snapshot } = player;
    const data = {
      device: deviceIds(this.gladys, player.id).device,
      player: this.deviceName(player),
      title: snapshot.title || snapshot.station || '',
      artist: snapshot.artist || '',
      album: snapshot.album || '',
      ...extra,
    };
    logger.debug(`${player.name}: ${key}`);
    this.gladys.publishSceneEvent(key, data).catch((err) => {
      logger.warn(`Cannot fire ${key}: ${err.message}`);
    });
  }

  // --- Gladys side -----------------------------------------------------------

  isCreated(playerId) {
    const id = deviceIds(this.gladys, playerId).device;
    return (this.gladys.devices ?? []).some((device) => device.external_id === id);
  }

  /** The name of the device in Gladys (the user may have renamed it). */
  deviceName(player) {
    const id = deviceIds(this.gladys, player.id).device;
    const created = (this.gladys.devices ?? []).find((device) => device.external_id === id);
    return created?.name ?? player.name;
  }

  async publishStates(player) {
    if (!player.snapshot || !this.isCreated(player.id)) {
      return;
    }
    try {
      await this.gladys.publishNowPlaying(
        deviceIds(this.gladys, player.id).device,
        nowPlaying(player.snapshot, this.config.baseUrl),
      );
      await this.gladys.publishChangedStates(buildStates(this.gladys, player.id, player.snapshot), {
        heartbeat: HEARTBEAT_MS,
      });
      if (player.publishFailing) {
        player.publishFailing = false;
        logger.info('States published again');
      }
    } catch (err) {
      const log = player.publishFailing ? logger.debug : logger.warn;
      player.publishFailing = true;
      log(`Cannot publish the states of ${player.name}: ${err.message}`);
    }
  }

  buildDevices() {
    return [...this.players.values()].map((player) =>
      buildDevice(this.gladys, player, this.language),
    );
  }

  async publishDevices() {
    if (!this.client) {
      return;
    }
    try {
      await this.gladys.publishDiscoveredDevices(this.buildDevices());
    } catch (err) {
      logger.error('Cannot publish the devices', err);
    }
  }

  /**
   * A device was added, or updated from the Discover tab, in Gladys: its
   * states, now that its features exist (the SDK forgot what it had
   * published for it, everything is sent again).
   */
  async onDeviceCreated(device) {
    const player = this.#find(device?.external_id);
    if (player) {
      await this.publishStates(player);
    }
    this.refreshWidget(true);
  }

  refreshWidget(force = false) {
    const wait = this.widgetRefreshAt + WIDGET_REFRESH_GAP_MS - this.now();
    if (wait <= 0 || force) {
      clearTimeout(this.widgetTimer);
      this.widgetTimer = null;
      this.widgetRefreshAt = this.now();
      Promise.resolve(this.gladys.requestWidgetRefresh(WIDGET_KEY)).catch(() => {});
      return;
    }
    if (!this.widgetTimer) {
      this.widgetTimer = setTimeout(() => {
        this.widgetTimer = null;
        this.refreshWidget();
      }, wait);
      this.widgetTimer.unref?.();
    }
  }

  // --- Commands --------------------------------------------------------------

  #find(externalId) {
    for (const player of this.players.values()) {
      if (deviceIds(this.gladys, player.id).device === externalId) {
        return player;
      }
    }
    return null;
  }

  /** A CommandError in the language of the configuration. */
  error(code) {
    return new CommandError(code, this.language);
  }

  /**
   * The player of a device external id, or a CommandError.
   * @param {string} externalId
   * @param {{ connected?: boolean }} [options] connected: false for what does
   *   not need the player itself (browsing the library of the server)
   */
  playerOf(externalId, { connected = true } = {}) {
    if (!this.client) {
      throw new CommandError('not_configured', this.language);
    }
    const player = this.#find(externalId);
    if (!player) {
      throw new CommandError('unknown_player', this.language);
    }
    if (connected && !player.connected) {
      throw new CommandError('offline', this.language);
    }
    return player;
  }

  /** One command to LMS, errors turned into coded messages; then an early read. */
  async send(playerId, command) {
    const result = await this.query(playerId, command);
    this.soon();
    return result;
  }

  /** One request to LMS that changes nothing (the catalog), errors coded. */
  async query(playerId, command) {
    if (!this.client) {
      throw new CommandError('not_configured', this.language);
    }
    try {
      return await this.client.request(playerId, command);
    } catch (err) {
      if (err instanceof LmsError) {
        throw new CommandError(err.code, this.language);
      }
      throw err;
    }
  }

  /** Play, or resume a paused song. */
  resume(player) {
    return player.snapshot?.mode === 'pause'
      ? this.send(player.id, ['pause', '0'])
      : this.send(player.id, ['play']);
  }

  async playPause(player) {
    const mode = player.snapshot?.mode;
    if (mode === 'play') {
      return this.send(player.id, ['pause', '1']);
    }
    return this.send(player.id, mode === 'pause' ? ['pause', '0'] : ['play']);
  }

  async setVolume(player, volume) {
    const value = Number(volume);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      throw new CommandError('bad_volume', this.language);
    }
    await this.send(player.id, ['mixer', 'volume', clampVolume(value)]);
  }

  async stepVolume(player, step) {
    const current = player.snapshot?.volume ?? 50;
    await this.setVolume(player, clampVolume(current + step));
  }

  /** onSetValue: a control of the device box, or the core Music box. */
  async setValue(device, feature, value) {
    const player = this.playerOf(device?.external_id);
    const key = featureKeyOf(feature?.external_id);
    switch (key) {
      case 'power':
        return this.send(player.id, ['power', Number(value) ? '1' : '0']);
      case 'play':
        return this.resume(player);
      case 'playback_state':
        return this.setPlaybackState(player, value);
      case 'position':
        return this.seek(player, value);
      case 'shuffle':
        return this.send(player.id, ['playlist', 'shuffle', Number(value) ? '1' : '0']);
      case 'repeat': {
        const repeat = REPEAT_TO_LMS[Number(value)];
        if (repeat === undefined) {
          throw new Error(`Invalid repeat mode ${value}`);
        }
        return this.send(player.id, ['playlist', 'repeat', repeat]);
      }
      case 'pause':
        return this.send(player.id, ['pause', '1']);
      case 'stop':
        return this.send(player.id, ['stop']);
      case 'previous':
        return this.send(player.id, ['playlist', 'index', '-1']);
      case 'next':
        return this.send(player.id, ['playlist', 'index', '+1']);
      case 'volume':
        return this.setVolume(player, value);
      case 'mute':
        // music/mute since 1.1.0 takes a value; a device not updated yet still
        // has the television push button of 1.0 (always 1): it toggles.
        if (feature?.category === DEVICE_FEATURE_CATEGORIES.TELEVISION) {
          return this.send(player.id, ['mixer', 'muting', 'toggle']);
        }
        return this.send(player.id, ['mixer', 'muting', Number(value) ? '1' : '0']);
      case 'notification':
        return this.announce(player, value);
      default:
        throw new Error(`Unknown feature ${key}`);
    }
  }

  /** playback_state written by Gladys 5.3: 0 pause, 1 play, 2 stop. */
  setPlaybackState(player, value) {
    switch (Number(value)) {
      case MUSIC_PLAYBACK_STATE.PLAYING:
        return this.resume(player);
      case MUSIC_PLAYBACK_STATE.PAUSED:
        return this.send(player.id, ['pause', '1']);
      case MUSIC_PLAYBACK_STATE.IDLE:
        return this.send(player.id, ['stop']);
      default:
        throw new Error(`Invalid playback state ${value}`);
    }
  }

  /** position written by Gladys 5.3: a seek, in seconds. */
  seek(player, value) {
    const position = Number(value);
    if (!Number.isFinite(position) || position < 0) {
      throw new Error(`Invalid position ${value}`);
    }
    return this.send(player.id, ['time', Math.round(position)]);
  }

  /** Plays a favorite found by name (case and accents ignored) or 1-based position. */
  async playFavorite(player, query) {
    const wanted = typeof query === 'string' ? query.trim() : String(query ?? '').trim();
    if (wanted === '') {
      throw new CommandError('no_favorite', this.language);
    }
    let favorites;
    try {
      favorites = parseFavorites(await this.client.favorites());
    } catch (err) {
      throw err instanceof LmsError ? new CommandError(err.code, this.language) : err;
    }
    const fold = (text) => text.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
    let favorite = favorites.find((item) => fold(item.name) === fold(wanted));
    if (!favorite && /^\d+$/.test(wanted)) {
      favorite = favorites[Number(wanted) - 1];
    }
    if (!favorite) {
      throw new CommandError('favorite_not_found', this.language);
    }
    if (player.snapshot && !player.snapshot.power) {
      await this.send(player.id, ['power', '1']);
    }
    await this.send(player.id, ['favorites', 'playlist', 'play', `item_id:${favorite.id}`]);
    logger.info(`${player.name}: playing the favorite ${favorite.name}`);
    return favorite;
  }

  /** Pauses every player that plays; returns how many. */
  async pauseAll() {
    if (!this.client) {
      throw new CommandError('not_configured', this.language);
    }
    await this.refresh();
    const playing = [...this.players.values()].filter((p) => isPlaying(p.snapshot));
    // A synced group follows its master: pausing every member is harmless.
    await Promise.all(playing.map((player) => this.send(player.id, ['pause', '1'])));
    logger.info(`Paused ${playing.length} players`);
    return playing.length;
  }

  /** `player` joins the group (sync) of `target`. */
  async join(player, target) {
    if (player.id === target.id) {
      throw new CommandError('same_player', this.language);
    }
    await this.send(target.id, ['sync', player.id]);
    logger.info(`${player.name} joins ${target.name}`);
  }

  async leave(player) {
    await this.send(player.id, ['sync', '-']);
    logger.info(`${player.name} leaves its group`);
  }

  // --- Announcements -----------------------------------------------------------

  /**
   * Plays a URL, then gives the player back its queue, song, position, volume
   * and state. The URL is inserted after the current song and removed once
   * played: the queue is never rebuilt (no length limit). Resolves as soon as
   * LMS accepted the stream; the restoration runs in the background.
   */
  async announce(player, url, volume = null) {
    let parsed;
    try {
      parsed = new URL(String(url ?? '').trim());
    } catch {
      parsed = null;
    }
    if (!parsed || !['http:', 'https:'].includes(parsed.protocol)) {
      throw new CommandError('bad_url', this.language);
    }
    if (player.announcing) {
      throw new CommandError('busy', this.language);
    }
    const withVolume = volume !== null && volume !== undefined && volume !== '';
    if (withVolume) {
      const value = Number(volume);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new CommandError('bad_volume', this.language);
      }
    }
    if (!this.client) {
      throw new CommandError('not_configured', this.language);
    }
    player.announcing = true;
    const id = player.id;
    const client = this.client;
    const job = { id, client, url: parsed.href, withVolume, saved: null, slot: 0 };
    try {
      job.saved = parseStatus(await client.status(id));
      const { saved } = job;
      if (!saved.power) {
        await client.request(id, ['power', '1']);
      }
      if (saved.repeat) {
        // Repeat-one would play the announcement forever.
        await client.request(id, ['playlist', 'repeat', '0']);
      }
      if (saved.muted) {
        await client.request(id, ['mixer', 'muting', '0']);
      }
      if (withVolume) {
        await client.request(id, ['mixer', 'volume', clampVolume(volume)]);
      }
      if (saved.tracks > 0) {
        job.slot = saved.index + 1;
        await client.request(id, ['playlist', 'insert', job.url]);
        await client.request(id, ['playlist', 'index', job.slot]);
      } else {
        await client.request(id, ['playlist', 'play', job.url]);
      }
    } catch (err) {
      // Give back what was already changed (power, repeat, mute, volume).
      if (job.saved) {
        await this.#restoreSettings(job).catch(() => {});
      }
      player.announcing = false;
      throw err instanceof LmsError ? new CommandError(err.code, this.language) : err;
    }
    logger.info(`${player.name}: announcement`);
    this.#follow(player, job).catch((err) => {
      logger.warn(`${player.name}: cannot restore after the announcement: ${err.message}`);
    });
  }

  /**
   * Waits for the end of the announcement, then restores. The end is the
   * first read off the announcement slot or not playing it any more: a short
   * chime is often over before the first read. A pause on the announcement is
   * a user's pause (pause all, a button): the music comes back paused. When the
   * queue is not ours any more (a favorite was played meanwhile), only the
   * volume, mute and repeat are given back. Without the server, nothing is
   * replayed hours later: after 10 failed reads, or a new configuration, the
   * hub gives up.
   */
  async #follow(player, job) {
    const { id, client, saved, slot } = job;
    const generation = this.generation;
    const alive = () => !this.stopped && this.generation === generation && this.client === client;
    const started = this.now();
    let failures = 0;
    let pausedByUser = false;
    let gaveUp = false;
    try {
      while (alive()) {
        await sleep(this.timings.announceCheckMs);
        const elapsed = this.now() - started;
        if (elapsed > this.timings.announceMaxMs) {
          break;
        }
        let current;
        try {
          current = parseStatus(await client.status(id));
          failures = 0;
        } catch {
          failures += 1;
          if (failures >= 10) {
            gaveUp = true;
            break;
          }
          continue;
        }
        if (current.index !== slot || current.mode === 'stop') {
          break;
        }
        if (current.mode === 'pause') {
          pausedByUser = true;
          break;
        }
        // Still on the slot, playing: wait for the end.
      }
      if (!alive() || gaveUp) {
        return;
      }
      let ours = saved.tracks === 0;
      if (saved.tracks > 0) {
        const check = await client.request(id, ['status', slot, 1, 'tags:u']);
        ours =
          Number(check.playlist_tracks) === saved.tracks + 1 &&
          check.playlist_loop?.[0]?.url === job.url;
      }
      if (ours && saved.tracks > 0) {
        await client.request(id, ['playlist', 'delete', slot]);
        await client.request(id, ['playlist', 'index', saved.index]);
        if (saved.mode !== 'stop' && !saved.remote && saved.time > 1) {
          await client.request(id, ['time', saved.time.toFixed(1)]);
        }
        if (saved.mode === 'stop') {
          await client.request(id, ['stop']);
        } else if (saved.mode === 'pause' || pausedByUser) {
          await client.request(id, ['pause', '1']);
        }
      } else if (ours) {
        await client.request(id, ['playlist', 'clear']);
      }
      await this.#restoreSettings(job, { power: ours });
    } finally {
      // The next read is the reference again, without scene events for what
      // the announcement did.
      player.snapshot = null;
      player.announcing = false;
      this.soon();
    }
  }

  async #restoreSettings({ id, client, saved, withVolume }, { power = true } = {}) {
    if (withVolume && saved.volume !== null) {
      await client.request(id, ['mixer', 'volume', saved.volume]);
    }
    if (saved.muted) {
      await client.request(id, ['mixer', 'muting', '1']);
    }
    if (saved.repeat) {
      await client.request(id, ['playlist', 'repeat', saved.repeat]);
    }
    if (power && !saved.power) {
      await client.request(id, ['power', '0']);
    }
  }

  // --- Widget images ---------------------------------------------------------

  /** The image key of the cover of what a player plays, or null. */
  coverKey(player) {
    const { snapshot } = player;
    if (!snapshot || snapshot.tracks === 0) {
      return null;
    }
    // LMS fetches and resizes remote art itself: the browser never does.
    const path = artworkPath(snapshot, ARTWORK_SIZE);
    if (!path) {
      return null;
    }
    const key = `cover-${createHash('sha1').update(path).digest('hex').slice(0, 20)}`;
    this.images.set(key, path);
    if (this.images.size > 64) {
      this.images.delete(this.images.keys().next().value);
    }
    return key;
  }

  /** onWidgetGetImage: the raw base64 of a cover key. */
  async widgetImage(key) {
    const path = this.images.get(key);
    if (!path || !this.client) {
      throw new Error(`Unknown image ${key}`);
    }
    return this.#imageBase64(path, key);
  }

  /**
   * onMusicGetArtwork (Gladys 5.3): the raw base64 of an artwork key. Its URL
   * was recorded by artworkKey (publishNowPlaying, the catalog); it is read
   * by the LMS client, with the credentials and under 300 KB, never by the
   * default handler of the SDK (no credentials, no size limit).
   */
  async artwork(key) {
    const url = this.gladys.artworkUrls?.get(key);
    const base = this.config?.baseUrl;
    if (!url || !this.client || !base || !url.startsWith(`${base}/`)) {
      throw new Error(`Unknown artwork ${key}`);
    }
    return this.#imageBase64(url.slice(base.length), key);
  }

  async #imageBase64(path, key) {
    const bytes = await this.client.image(path);
    // The core takes PNG, JPEG or WebP only (a radio logo may be a GIF or SVG).
    const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8;
    const webp = bytes.subarray(8, 12).toString('latin1') === 'WEBP';
    if (!png && !jpeg && !webp) {
      throw new Error(`Image ${key} is not a PNG, JPEG or WebP`);
    }
    return bytes.toString('base64');
  }
}
