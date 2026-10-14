# Lyrion Music Server for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that follows and
controls the players of a [Lyrion Music Server](https://lyrion.org) (formerly Logitech Media Server,
LMS): Squeezebox Touch, Radio, Boom and Duet, piCorePlayer, squeezelite and every compatible player.
It talks to the server over the local network, through its JSON-RPC API and its CLI. No cloud, no
account.

> **Tested against a real Lyrion Music Server 9.1, not with a physical Squeezebox: feedback
> welcome.** The server ran in Docker (`lmscommunity/lyrionmusicserver`) with two squeezelite
> players: playback, pause, next, volume, mute, power, favorites, sync groups, announcements and
> their restoration, the CLI events and HTTP basic authentication were exercised for real. Please
> report what works and what does not in the [issues](https://github.com/guim31/gladys-lyrion/issues).

## Features

- **One device per player**, keyed on its Lyrion player id (its MAC address): power, playback state,
  play / pause / stop / previous / next, volume, mute, title and artist. The playback features belong
  to the Gladys **Music** category, so the core Music dashboard box drives them.
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

- Gladys Assistant **5.1** or later.
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
- Covers are fetched from the server (`/music/<coverid>/cover_300x300_o.jpg`, or its image proxy for
  a remote artwork) and served to the widget by the integration: the browser never loads a
  third-party URL.

## Limitations

- One server per integration, typed by hand: Lyrion's own discovery is a UDP broadcast, which the
  Gladys sandbox does not carry.
- The music features have no row in the "devices in a room" box of Gladys (only the Music box and the
  widget show them).
- An announcement on a synced player plays on the whole group; with shuffle on, the position given
  back may differ. An endless stream is cut after 10 minutes.
- Only the top level of the favorites can be played by an action.

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
