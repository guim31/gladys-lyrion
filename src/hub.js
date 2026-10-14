// -----------------------------------------------------------------------------
// The hub: one Lyrion Music Server, its players, and everything Gladys sees of
// them (devices, states, scene events, widget, commands).
//
// Reading: JSON-RPC (`serverstatus`, then `status` per connected player) on a
// timer of the container (Gladys#3198), fast while the CLI is closed, slow
// while it is open; every CLI event schedules an early read. Only the changes
// reach Gladys (publishChangedStates), with a heartbeat.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { buildDevice, buildStates, deviceIds, featureKeyOf } from './devices.js';
import { LmsClient, LmsError } from './lms/client.js';
import { CliListener, RECONNECT_MIN_MS, SETTLE_MS } from './lms/listener.js';
import { isPlaying, parseFavorites, parseServer, parseStatus, trackKey } from './lms/model.js';
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
    if (!previous) {
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
      await this.gladys.publishChangedStates(
        buildStates(this.gladys, player.id, player.snapshot, this.language),
        { heartbeat: HEARTBEAT_MS },
      );
      if (this.publishFailing) {
        this.publishFailing = false;
        logger.info('States published again');
      }
    } catch (err) {
      const log = this.publishFailing ? logger.debug : logger.warn;
      this.publishFailing = true;
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

  /** A device was added in Gladys: its states, now that its features exist. */
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

  /** The player of a device external id, or a CommandError. */
  playerOf(externalId) {
    if (!this.client) {
      throw new CommandError('not_configured', this.language);
    }
    const player = this.#find(externalId);
    if (!player) {
      throw new CommandError('unknown_player', this.language);
    }
    if (!player.connected) {
      throw new CommandError('offline', this.language);
    }
    return player;
  }

  /** One command to LMS, errors turned into coded messages. */
  async send(playerId, command) {
    if (!this.client) {
      throw new CommandError('not_configured', this.language);
    }
    try {
      const result = await this.client.request(playerId, command);
      this.soon();
      return result;
    } catch (err) {
      if (err instanceof LmsError) {
        throw new CommandError(err.code, this.language);
      }
      throw err;
    }
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
    if (player.snapshot) {
      player.snapshot = { ...player.snapshot, volume: clampVolume(value) };
    }
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
        return player.snapshot?.mode === 'pause'
          ? this.send(player.id, ['pause', '0'])
          : this.send(player.id, ['play']);
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
        return this.send(player.id, ['mixer', 'muting', 'toggle']);
      case 'notification':
        return this.announce(player, value);
      default:
        throw new Error(`Unknown feature ${key}`);
    }
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
    if (volume !== null && volume !== undefined && volume !== '') {
      const value = Number(volume);
      if (!Number.isFinite(value) || value < 0 || value > 100) {
        throw new CommandError('bad_volume', this.language);
      }
    }
    player.announcing = true;
    const id = player.id;
    let saved;
    let slot;
    try {
      saved = parseStatus(await this.client.status(id));
      if (!saved.power) {
        await this.send(id, ['power', '1']);
      }
      if (saved.repeat) {
        // Repeat-one would play the announcement forever.
        await this.send(id, ['playlist', 'repeat', '0']);
      }
      if (saved.muted) {
        await this.send(id, ['mixer', 'muting', '0']);
      }
      if (volume !== null && volume !== undefined && volume !== '') {
        await this.send(id, ['mixer', 'volume', clampVolume(volume)]);
      }
      if (saved.tracks > 0) {
        slot = saved.index + 1;
        await this.send(id, ['playlist', 'insert', parsed.href]);
        await this.send(id, ['playlist', 'index', slot]);
      } else {
        slot = 0;
        await this.send(id, ['playlist', 'play', parsed.href]);
      }
    } catch (err) {
      player.announcing = false;
      throw err instanceof LmsError ? new CommandError(err.code, this.language) : err;
    }
    logger.info(`${player.name}: announcement`);
    this.#follow(player, saved, slot, volume).catch((err) => {
      logger.warn(`${player.name}: cannot restore after the announcement: ${err.message}`);
    });
  }

  async #follow(player, saved, slot, volume) {
    const id = player.id;
    const started = this.now();
    let heard = false;
    try {
      // Wait for the stream to start, then for it to end.
      while (!this.stopped) {
        await sleep(this.timings.announceCheckMs);
        let current;
        try {
          current = parseStatus(await this.client.status(id));
        } catch {
          continue;
        }
        const onSlot = current.index === slot && current.mode === 'play';
        const elapsed = this.now() - started;
        if (onSlot) {
          heard = true;
        } else if (heard || elapsed > this.timings.announceStartMs || current.mode === 'stop') {
          break;
        }
        if (elapsed > this.timings.announceMaxMs) {
          break;
        }
      }
      if (this.stopped || !this.client) {
        return;
      }
      if (saved.tracks > 0) {
        await this.client.request(id, ['playlist', 'delete', slot]);
        await this.client.request(id, ['playlist', 'index', saved.index]);
        if (saved.time > 1) {
          await this.client.request(id, ['time', saved.time.toFixed(1)]);
        }
        if (saved.mode === 'pause') {
          await this.client.request(id, ['pause', '1']);
        } else if (saved.mode === 'stop') {
          await this.client.request(id, ['stop']);
        }
      } else {
        await this.client.request(id, ['playlist', 'clear']);
      }
      if (volume !== null && volume !== undefined && volume !== '' && saved.volume !== null) {
        await this.client.request(id, ['mixer', 'volume', saved.volume]);
      }
      if (saved.muted) {
        await this.client.request(id, ['mixer', 'muting', '1']);
      }
      if (saved.repeat) {
        await this.client.request(id, ['playlist', 'repeat', saved.repeat]);
      }
      if (!saved.power) {
        await this.client.request(id, ['power', '0']);
      }
    } finally {
      // The next read is the reference again, without scene events for what
      // the announcement did.
      player.snapshot = null;
      player.announcing = false;
      this.soon();
    }
  }

  // --- Widget images ---------------------------------------------------------

  /** The image key of the cover of what a player plays, or null. */
  coverKey(player) {
    const { snapshot } = player;
    if (!snapshot || snapshot.tracks === 0) {
      return null;
    }
    let path = null;
    if (snapshot.coverId) {
      path = `/music/${encodeURIComponent(snapshot.coverId)}/cover_300x300_o.jpg`;
    } else if (/^https?:\/\//i.test(snapshot.artworkUrl)) {
      // LMS fetches and resizes remote art itself: the browser never does.
      path = `/imageproxy/${encodeURIComponent(snapshot.artworkUrl)}/image_300x300_o`;
    } else if (snapshot.artworkUrl) {
      path = `/${snapshot.artworkUrl.replace(/^\/+/, '')}`;
    }
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
    return (await this.client.image(path)).toString('base64');
  }
}
