// -----------------------------------------------------------------------------
// A scripted Lyrion Music Server for the tests: a `fetch` answering JSON-RPC
// like LMS 9.1 (answers modelled on test/fixtures/lms/, recorded on the
// lmscommunity/lyrionmusicserver image with two squeezelite players), and a
// `connect` giving fake CLI sockets that receive the `listen` events.
// No network.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';

export const fixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/lms/${name}.json`, import.meta.url), 'utf8'));

// A 4x4 JPEG, enough for the image checks of the core.
const TINY_JPEG =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAEAAQDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDkKKKK8U/TD//Z';

export const KITCHEN = '02:00:00:00:00:01';
export const SALON = '02:00:00:00:00:02';

export const SONGS = [
  {
    id: 1,
    title: 'Morning Song',
    artist: 'The Larks',
    album: 'Daybreak',
    url: 'file:///music/01.flac',
    coverid: 'a1b2c3d4',
    coverart: '1',
  },
  {
    id: 2,
    title: 'Evening Tune',
    artist: 'The Larks',
    album: 'Daybreak',
    url: 'file:///music/02.flac',
    coverid: 'a1b2c3d4',
    coverart: '1',
  },
  {
    id: 3,
    title: 'Night Theme',
    artist: 'Owls',
    album: 'Dusk',
    url: 'file:///music/03.flac',
    coverart: '0',
  },
];

export const until = async (predicate, timeoutMs = 2000, what = 'condition') => {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    if (await predicate()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error(`Timed out waiting for ${what}`);
};

class FakeSocket extends EventEmitter {
  constructor(lms) {
    super();
    this.lms = lms;
    this.written = [];
    this.destroyed = false;
    setImmediate(() => {
      if (this.lms.cliOpen) {
        this.emit('connect');
      } else {
        this.emit('error', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' }));
        this.emit('close');
      }
    });
  }

  setEncoding() {}
  setKeepAlive() {}

  write(text) {
    this.written.push(text);
    for (const line of text.split('\n').filter(Boolean)) {
      const [command] = line.split(' ');
      if (command === 'login') {
        this.loggedIn = this.lms.checkCli(line);
        this.emit('data', 'login gladys ******\n');
      } else if (command === 'listen') {
        this.emit('data', 'listen 1\n');
        if (this.lms.password && !this.loggedIn) {
          setImmediate(() => this.destroy());
        } else {
          this.lms.sockets.add(this);
        }
      }
    }
  }

  destroy() {
    if (this.destroyed) {
      return;
    }
    this.destroyed = true;
    this.lms.sockets.delete(this);
    this.emit('close');
  }
}

export class FakeLms {
  constructor({ username = '', password = '', cliOpen = true, favorites, library } = {}) {
    this.username = username;
    this.password = password;
    this.cliOpen = cliOpen;
    this.down = false;
    this.sockets = new Set();
    this.requests = [];
    this.favorites = favorites ?? fixture('favorites').result.loop_loop;
    // Library answers recorded on a real LMS, by command (src/catalog.js).
    this.library = library ?? fixture('library');
    this.players = new Map();
    this.addPlayer(KITCHEN, 'Kitchen');
    this.addPlayer(SALON, 'Salon');
    this.fetch = this.fetch.bind(this);
    this.connect = this.connect.bind(this);
  }

  addPlayer(id, name, extra = {}) {
    this.players.set(id, {
      id,
      name,
      connected: 1,
      power: 1,
      mode: 'stop',
      volume: 50,
      muted: false,
      queue: [],
      index: 0,
      time: 0,
      repeat: 0,
      shuffle: 0,
      master: null,
      ...extra,
    });
  }

  // --- CLI -------------------------------------------------------------------

  connect() {
    return new FakeSocket(this);
  }

  checkCli(line) {
    const [, user, pass] = line.split(' ').map(decodeURIComponent);
    return user === this.username && pass === this.password;
  }

  /** An event line of `listen 1`, as LMS writes it. */
  event(playerId, ...words) {
    const line = `${encodeURIComponent(playerId)} ${words.map(encodeURIComponent).join(' ')}\n`;
    for (const socket of this.sockets) {
      socket.emit('data', line);
    }
  }

  closeCli() {
    for (const socket of [...this.sockets]) {
      socket.destroy();
    }
  }

  // --- Player scripting --------------------------------------------------------

  player(id) {
    return this.players.get(id);
  }

  load(id, songs, { index = 0, mode = 'play', time = 0 } = {}) {
    Object.assign(this.player(id), { queue: songs.map((s) => ({ ...s })), index, mode, time });
  }

  groupOf(id) {
    const player = this.player(id);
    const master = player.master ?? id;
    const members = [...this.players.values()].filter((p) => p.master === master);
    return members.length ? { master, slaves: members.map((p) => p.id) } : null;
  }

  // --- JSON-RPC ----------------------------------------------------------------

  async fetch(url, init = {}) {
    if (this.down) {
      throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
    }
    const path = url.replace(/^https?:\/\/[^/]+/, '');
    if (this.password) {
      const expected = `Basic ${Buffer.from(`${this.username}:${this.password}`).toString('base64')}`;
      if (init.headers?.authorization !== expected) {
        return new Response('', { status: 401 });
      }
    }
    if (path.startsWith('/music/') || path.startsWith('/imageproxy/')) {
      this.requests.push({ path });
      return new Response(Buffer.from(TINY_JPEG, 'base64'));
    }
    if (path !== '/jsonrpc.js') {
      return new Response('', { status: 404 });
    }
    const body = JSON.parse(init.body);
    const [playerId, command] = body.params;
    this.requests.push({ playerId, command });
    const result = this.handle(playerId, command);
    if (result === undefined) {
      // LMS never answers an unknown command: the client times out.
      return new Promise((resolve, reject) => {
        init.signal?.addEventListener('abort', () => reject(init.signal.reason));
      });
    }
    return Response.json({ id: 1, method: 'slim.request', params: body.params, result });
  }

  handle(playerId, [name, ...args]) {
    if (playerId === '') {
      const recorded = this.library[[name, ...args].join(' ')];
      if (recorded !== undefined) {
        return structuredClone(recorded);
      }
      if (name === 'serverstatus') {
        const template = fixture('serverstatus').result;
        const players = [...this.players.values()].map((p, index) => ({
          ...template.players_loop[0],
          playerid: p.id,
          name: p.name,
          connected: p.connected,
          power: p.power,
          isplaying: p.mode === 'play' ? 1 : 0,
          playerindex: index,
        }));
        return { ...template, 'player count': players.length, players_loop: players };
      }
      if (name === 'favorites' && args[0] === 'items') {
        return { title: 'Favorites', count: this.favorites.length, loop_loop: this.favorites };
      }
      return undefined;
    }
    const player = this.player(playerId);
    if (!player) {
      return undefined;
    }
    const sub = args[0];
    switch (name) {
      case 'status':
        return this.status(player, sub === '-' ? player.index : Number(sub), Number(args[1] ?? 1));
      case 'playlistcontrol': {
        // `cmd:load|insert|add <kind>_id:<id>`: one song per id, none for 9999.
        const cmd = args[0].slice(4);
        const id = Number(args[1].split(':')[1]);
        const songs = id === 9999 ? [] : [{ id, title: `Loaded ${args[1]}`, url: `file:///${id}` }];
        this.enqueue(player, cmd === 'load' ? 'play' : cmd, songs);
        return { count: songs.length };
      }
      case 'play':
        player.mode = player.queue.length ? 'play' : 'stop';
        break;
      case 'pause':
        if (player.mode !== 'stop') {
          player.mode = sub === '1' ? 'pause' : 'play';
        }
        break;
      case 'stop':
        player.mode = 'stop';
        break;
      case 'power':
        player.power = Number(sub);
        if (!player.power && player.mode === 'play') {
          player.mode = 'pause';
        }
        break;
      case 'time':
        player.time = Number(sub);
        break;
      case 'mixer':
        if (sub === 'volume') {
          player.volume = Math.max(0, Math.min(100, Number(args[1])));
        } else if (sub === 'muting') {
          player.muted = args[1] === 'toggle' ? !player.muted : args[1] === '1';
        }
        break;
      case 'sync':
        if (sub === '-') {
          player.master = null;
        } else {
          this.player(sub).master = player.id;
        }
        break;
      case 'playlist':
        this.playlist(player, args);
        break;
      case 'favorites': {
        const id = args.find((a) => a.startsWith('item_id:'))?.slice(8);
        const favorite = this.favorites.find((f) => f.id === id);
        this.load(player.id, [{ id: 99, title: favorite.name, url: favorite.url, coverart: '0' }]);
        break;
      }
      default:
        return undefined;
    }
    return {};
  }

  playlist(player, [sub, value]) {
    switch (sub) {
      case 'index': {
        let index = Number(value);
        if (value.startsWith('+') || value.startsWith('-')) {
          index = player.index + Number(value);
        }
        if (index >= player.queue.length) {
          player.mode = 'stop';
          player.index = 0;
        } else {
          player.index = Math.max(0, index);
          player.mode = 'play';
        }
        player.time = 0;
        break;
      }
      case 'insert':
        player.queue.splice(player.index + 1, 0, {
          id: 100,
          title: 'announce',
          url: value,
          remote: '1',
        });
        break;
      case 'delete':
        player.queue.splice(Number(value), 1);
        if (player.index >= player.queue.length) {
          player.index = 0;
        }
        break;
      case 'play':
        // An URL LMS does not know (`Nope`) leaves an empty queue.
        player.queue = value.includes('Nope')
          ? []
          : [{ id: 100, title: 'announce', url: value, remote: '1' }];
        player.index = 0;
        player.mode = player.queue.length ? 'play' : 'stop';
        break;
      case 'add':
        player.queue.push({ id: 101, title: 'added', url: value });
        break;
      case 'shuffle':
        player.shuffle = Number(value);
        break;
      case 'clear':
        player.queue = [];
        player.index = 0;
        player.mode = 'stop';
        break;
      case 'repeat':
        player.repeat = Number(value);
        break;
      default:
        break;
    }
  }

  enqueue(player, how, songs) {
    if (how === 'play') {
      Object.assign(player, { queue: songs, index: 0, mode: songs.length ? 'play' : 'stop' });
    } else if (how === 'insert') {
      player.queue.splice(player.index + 1, 0, ...songs);
    } else {
      player.queue.push(...songs);
    }
  }

  status(player, start = player.index, count = 1) {
    const template = structuredClone(fixture('status-playing').result);
    delete template.playlist_loop;
    const song = player.queue[start];
    const result = {
      ...template,
      player_name: player.name,
      player_connected: player.connected,
      power: player.power,
      mode: player.mode,
      time: player.time,
      'mixer volume': player.muted ? -player.volume : player.volume,
      'playlist repeat': player.repeat,
      'playlist shuffle': player.shuffle,
      playlist_tracks: player.queue.length,
      playlist_cur_index: String(player.index),
    };
    if (song) {
      result.playlist_loop = player.queue
        .slice(start, start + Math.max(1, count))
        .map((item, i) => ({ 'playlist index': start + i, remote: '0', ...item }));
    }
    const group = this.groupOf(player.id);
    if (group) {
      result.sync_master = group.master;
      result.sync_slaves = group.slaves.join(',');
    }
    return result;
  }
}
