// -----------------------------------------------------------------------------
// Lyrion Music Server JSON-RPC client: `POST /jsonrpc.js` with
// `{ method: "slim.request", params: [playerId, [command...]] }`, the very
// commands of the CLI. Optional HTTP basic authentication ("Server security"
// in the LMS settings).
//
// LMS never answers an unknown command or player: the request hangs until the
// client gives up. Hence a short timeout on every request.
// -----------------------------------------------------------------------------

export const REQUEST_TIMEOUT_MS = 5000;

// The core refuses a widget image over 300 KB.
export const MAX_IMAGE_BYTES = 300 * 1024;

/** A failure with a code the texts know: unreachable, auth, timeout, protocol. */
export class LmsError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

export class LmsClient {
  /**
   * @param {{ baseUrl: string, username?: string, password?: string,
   *   fetch?: typeof fetch, timeoutMs?: number }} options
   */
  constructor({ baseUrl, username = '', password = '', fetch, timeoutMs = REQUEST_TIMEOUT_MS }) {
    this.baseUrl = baseUrl;
    this.fetch = fetch ?? globalThis.fetch;
    this.timeoutMs = timeoutMs;
    this.headers = { 'content-type': 'application/json' };
    if (username || password) {
      const token = Buffer.from(`${username}:${password}`, 'utf8').toString('base64');
      this.headers.authorization = `Basic ${token}`;
    }
  }

  /**
   * One HTTP exchange, the body read included, under the timeout. A ref'd
   * timer rather than AbortSignal.timeout(): Node 22 would not wait for an
   * unref'd one when nothing else keeps the process busy.
   */
  async #get(path, init, read) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      let response;
      try {
        response = await this.fetch(`${this.baseUrl}${path}`, {
          ...init,
          headers: this.headers,
          signal: controller.signal,
        });
      } catch (err) {
        if (controller.signal.aborted) {
          throw new LmsError('timeout', 'Lyrion did not answer in time');
        }
        throw new LmsError(
          'unreachable',
          `Lyrion is unreachable (${err?.cause?.code ?? err?.message})`,
        );
      }
      if (response.status === 401 || response.status === 403) {
        throw new LmsError('auth', `Lyrion refused the credentials (HTTP ${response.status})`);
      }
      if (!response.ok) {
        throw new LmsError('protocol', `Lyrion answered HTTP ${response.status}`);
      }
      try {
        return await read(response);
      } catch (err) {
        if (err instanceof LmsError) {
          throw err;
        }
        if (controller.signal.aborted) {
          throw new LmsError('timeout', 'Lyrion did not answer in time');
        }
        throw new LmsError('protocol', 'Lyrion answered something that is not JSON');
      }
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * One CLI command. `playerId` is '' for a server command.
   * @param {string} playerId
   * @param {Array<string|number>} command
   * @returns {Promise<object>} the `result` object (empty for most commands)
   */
  async request(playerId, command) {
    const body = await this.#get(
      '/jsonrpc.js',
      {
        method: 'POST',
        body: JSON.stringify({
          id: 1,
          method: 'slim.request',
          params: [playerId, command.map(String)],
        }),
      },
      (response) => response.json(),
    );
    if (!body || typeof body !== 'object') {
      throw new LmsError('protocol', 'Lyrion answered an empty body');
    }
    return body.result && typeof body.result === 'object' ? body.result : {};
  }

  /** The server and its players (`serverstatus`). */
  serverStatus() {
    return this.request('', ['serverstatus', 0, 100]);
  }

  /**
   * The state of a player and its current track. Tags: a artist, l album,
   * c coverid, j coverart, K artwork_url, N remote_title, u url, d duration.
   * LMS 9.1 drops the whole playlist_loop when the artist of the track cannot
   * be read (seen on a track retitled by `playlist preview`): read it again
   * without the artist rather than show nothing.
   */
  async status(playerId) {
    const result = await this.request(playerId, ['status', '-', 1, 'tags:acdjKlNu']);
    if (Number(result.playlist_tracks) > 0 && !Array.isArray(result.playlist_loop)) {
      return this.request(playerId, ['status', '-', 1, 'tags:cdjKlNu']);
    }
    return result;
  }

  /** Top-level favorites (`favorites items`). */
  favorites() {
    return this.request('', ['favorites', 'items', 0, 200]);
  }

  /**
   * The bytes of an image served by LMS (cover art), read up to the 300 KB
   * the core accepts: a bigger image is refused without reading it all.
   */
  async image(path) {
    return this.#get(path, {}, async (response) => {
      const tooLarge = () => new LmsError('protocol', 'Image too large (over 300 KB)');
      if (Number(response.headers.get('content-length')) > MAX_IMAGE_BYTES) {
        await response.body?.cancel().catch(() => {});
        throw tooLarge();
      }
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body ?? []) {
        size += chunk.length;
        if (size > MAX_IMAGE_BYTES) {
          throw tooLarge();
        }
        chunks.push(chunk);
      }
      return Buffer.concat(chunks);
    });
  }
}
