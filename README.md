# Lyrion Music Server for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that follows and
controls the players of a [Lyrion Music Server](https://lyrion.org) (formerly Logitech Media Server,
LMS): Squeezebox Touch, Radio, Boom and Duet, piCorePlayer, squeezelite and every compatible player.
It talks to the server over the local network, through its JSON-RPC API and its CLI. No cloud, no
account.

> **Tested against a real Lyrion Music Server 9.1, not with a physical Squeezebox: feedback
> welcome.** The server ran in Docker (`lmscommunity/lyrionmusicserver`) with two squeezelite
> players: playback, pause, next, volume, mute, power, favorites, sync groups, announcements and
> their restoration, the CLI events and HTTP basic authentication were exercised for real, and so
> were the Gladys 5.3 music player (now playing, seek, shuffle, repeat, covers) and its catalog
> (browse, search, play, queue). Please
> report what works and what does not in the [issues](https://github.com/guim31/gladys-lyrion/issues).

## Features

- **One device per player**, keyed on its Lyrion player id (its MAC address): power, playback state,
  play / pause / stop / previous / next, volume, mute, title, artist, album, artwork, duration,
  position, shuffle and repeat. The playback features belong to the Gladys **Music** category, so the
  core Music dashboard box shows and drives them.
- **Gladys 5.3 Music player**: the core Music box shows the cover, the song, a progress bar you drag
  to seek, shuffle, repeat and mute, and opens the player's **queue** (tap to jump), a **search** of
  the Lyrion library and favorites, and **browsing** of Favorites, Playlists, Artists and Albums; an
  item plays in place of the queue, after the current song or at the end. The core "Play music on a
  speaker" scene action uses the same catalog.
- **Announcements**: the core "Talk on a speaker" scene action works on every player, and so does the
  integration's own "Play an announcement" action: the audio is inserted after the current song,
  played, then removed, and the player gets back its song, position, volume, state, repeat mode and
  power.
- **Instant updates** through the CLI (`listen 1` on port 9090), with a read every 5 seconds when that
  port is closed, every 30 seconds otherwise (to catch what an event may miss).
- **Dashboard widget "Lyrion players"**: every player with what it plays, and a "Pause all" button;
  or one player with its cover, song, artist, album, state, volume, group, and play/pause, next,
  volume buttons.
- **Scene triggers**: playback started, playback stopped (paused, stopped, turned off), song changed
  (including a radio announcing a new title), with the player, title, artist and album as variables.
- **Scene actions**: play a Lyrion favorite (by name or position), set the volume of one or every
  player, pause every player, play an announcement, join a group of players, leave it.
- Texts in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.3** or later (version 1.0 works with Gladys 5.1).
- A Lyrion Music Server reachable from Gladys: web port 9000, CLI port 9090 (both default).
  Logitech Media Server 8 has the same API and should work too.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and type
   `https://github.com/guim31/gladys-lyrion`.
2. Type the address of the Lyrion server (and its user name and password if password protection is
   on in Lyrion).
3. Open the **Discovery** tab and add the players.

The user documentation is in [docs/en.md](docs/en.md) (also in [French](docs/fr.md),
[German](docs/de.md) and [Spanish](docs/es.md)).

## How it works

- `serverstatus` lists the players; `status - 1 tags:acdjKlNu` reads each connected one (mode, power,
  volume — negative while muted —, the current song, its cover). Only the changes are published to
  Gladys, with a heartbeat every 6 hours.
- The CLI connection only says "something changed": every event schedules a JSON-RPC read, which
  stays the single source of truth.
- The music features go through the SDK's `publishNowPlaying` (diffed, the position only on a change
  of state or song, or a seek); the power through `publishChangedStates`.
- Covers are fetched from the server, which resizes them itself (`/music/<coverid>/cover_300x300_o.jpg`,
  `_64x64_o.jpg` for list thumbnails, or its image proxy for a remote artwork), with the credentials and
  under the 300 KB Gladys accepts, and served by the integration: the browser never loads a
  third-party URL.
- The catalog is read on demand: `favorites items`, `playlists`, `artists`, `albums`, `titles`,
  `playlists tracks`, each paged by LMS; the queue is `status <offset> <limit>`. An item plays by its
  LMS URL (`playlist play|insert|add`, `db:album.title=…` for an album or an artist), which survives
  a library rescan.

### Gladys 5.3: updating an existing device

A player added with version 1.0.x keeps its features (its mute still toggles), with the empty texts
and the stopped state (2) of 1.1.0. To get the new features, open the
**Discover** tab of the integration and click **Update** on the player: the new features are added
and the existing ones keep their scenes and dashboards. Title, artist and mute keep their external
ids but become `music/title`, `music/artist` and `music/mute`; the playback state reads 2 (stopped)
instead of 0 when the player is stopped or off.

## Limitations

- One server per integration, typed by hand: Lyrion's own discovery is a UDP broadcast, which the
  Gladys sandbox does not carry.
- The one-shot music buttons (play, pause, next…) have no row in the "devices in a room" box of
  Gladys; Gladys 5.3 shows the playback state, volume, mute, shuffle, repeat and texts there.
- An announcement on a synced player plays on the whole group; with shuffle on, the position given
  back may differ. An endless stream is cut after 10 minutes.
- Only the top level of the favorites can be played by the integration's "Play a Lyrion favorite"
  action (the Music box panel opens their folders). Lyrion apps (online radios, streaming services)
  are not browsable from Gladys: add their items to the favorites.

## Development

```bash
npm ci
npm run format:check && npm run lint && npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests run against the fake Gladys of the SDK and a scripted Lyrion server
(`test/helpers/fakeLms.js`) built on answers recorded on Lyrion 9.1 (`test/fixtures/lms/`,
anonymized). They never touch the network.

## Credits

- [Lyrion Music Server](https://github.com/LMS-Community/slimserver) (GPL-2.0) and its CLI and
  JSON-RPC documentation, by the LMS Community.
- [squeezelite](https://github.com/ralph-irving/squeezelite) (GPL-3.0), the software player used for
  the tests.
- The [Gladys integration SDK](https://github.com/GladysAssistant/integration-sdk-js) and template.

## Disclaimer

This project is not affiliated with, endorsed by or sponsored by the Lyrion project, the LMS
Community or Logitech. Squeezebox is a trademark of Logitech.

## License

[Apache-2.0](LICENSE).
