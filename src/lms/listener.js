// -----------------------------------------------------------------------------
// The CLI of Lyrion (TCP 9090) in `listen 1` mode: LMS writes one line per
// event (`<playerid> playlist newsong ...`, `<playerid> mixer volume 40`,
// `<playerid> power 0`...), the first token being the URL-encoded player id.
// The integration does not parse the events: each one only says "this player
// changed, read it again" through the JSON-RPC API, which stays the single
// source of truth. When the CLI is closed or unreachable, the hub polls faster.
//
// With "Server security" on, the CLI wants `login <user> <password>` first and
// closes the connection on wrong credentials.
// -----------------------------------------------------------------------------

import { EventEmitter } from 'node:events';
import net from 'node:net';

export const RECONNECT_MIN_MS = 5_000;
export const RECONNECT_MAX_MS = 60_000;
// LMS echoes `listen 1` even when it is about to close the connection (wrong
// or missing credentials): the subscription counts once it held this long.
export const SETTLE_MS = 1_500;

const encode = (text) => encodeURIComponent(text);

export class CliListener extends EventEmitter {
  /**
   * @param {{ host: string, port: number, username?: string, password?: string,
   *   connect?: (options: object) => import('node:net').Socket,
   *   reconnectMinMs?: number, reconnectMaxMs?: number }} options
   */
  constructor({
    host,
    port,
    username = '',
    password = '',
    connect = net.createConnection,
    reconnectMinMs = RECONNECT_MIN_MS,
    reconnectMaxMs = RECONNECT_MAX_MS,
    settleMs = SETTLE_MS,
  }) {
    super();
    this.options = { host, port, username, password };
    this.connectFn = connect;
    this.reconnectMinMs = reconnectMinMs;
    this.reconnectMaxMs = reconnectMaxMs;
    this.settleMs = settleMs;
    this.settleTimer = null;
    this.delay = reconnectMinMs;
    this.socket = null;
    this.timer = null;
    this.up = false;
    this.stopped = true;
  }

  start() {
    this.stopped = false;
    this.#open();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearTimeout(this.settleTimer);
    this.timer = null;
    this.socket?.destroy();
    this.socket = null;
    this.#setUp(false);
  }

  #setUp(up) {
    if (this.up !== up) {
      this.up = up;
      this.emit(up ? 'up' : 'down');
    }
  }

  #open() {
    const { host, port, username, password } = this.options;
    const socket = this.connectFn({ host, port });
    this.socket = socket;
    let buffer = '';
    socket.setEncoding?.('utf8');
    socket.setKeepAlive?.(true, 60_000);
    socket.on('connect', () => {
      if (username || password) {
        socket.write(`login ${encode(username)} ${encode(password)}\n`);
      }
      socket.write('listen 1\n');
    });
    socket.on('data', (chunk) => {
      buffer += chunk;
      let newline = buffer.indexOf('\n');
      while (newline !== -1) {
        const line = buffer.slice(0, newline).trim();
        buffer = buffer.slice(newline + 1);
        this.#line(line);
        newline = buffer.indexOf('\n');
      }
      if (buffer.length > 65_536) {
        buffer = ''; // a runaway line: drop it rather than grow
      }
    });
    socket.on('error', () => {}); // followed by 'close'
    socket.on('close', () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      clearTimeout(this.settleTimer);
      this.#setUp(false);
      if (!this.stopped) {
        this.timer = setTimeout(() => this.#open(), this.delay);
        this.timer.unref?.();
        this.delay = Math.min(this.delay * 2, this.reconnectMaxMs);
      }
    });
  }

  #line(line) {
    if (line === '') {
      return;
    }
    const [first, second] = line.split(' ');
    if (first === 'listen' || first === 'login') {
      // The echo of our own commands: the subscription is live.
      if (first === 'listen' && !this.up) {
        const socket = this.socket;
        clearTimeout(this.settleTimer);
        this.settleTimer = setTimeout(() => {
          if (this.socket === socket && !this.stopped) {
            this.delay = this.reconnectMinMs;
            this.#setUp(true);
          }
        }, this.settleMs);
        this.settleTimer.unref?.();
      }
      return;
    }
    let playerId;
    try {
      playerId = decodeURIComponent(first);
    } catch {
      return;
    }
    // Server-wide events (`rescan`, `favorites changed`...) have no player id.
    this.emit('event', /[:.]/.test(playerId) ? playerId : null, second ?? '');
  }
}
