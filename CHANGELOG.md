# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- The music player of Gladys 5.3: the **Music** box of the dashboard shows
  the cover, the title, the artist, the album and a progress bar you can drag
  to seek, with shuffle, repeat and mute. New features on each player:
  album, artwork, duration, position (writable: seek), shuffle and repeat
  (off, all, one).
- The panels of the Music box: the player's **queue** (tap an item to play
  it), **search** in the Lyrion library (artists, albums, songs, playlists)
  and in the names of the favorites, and **browsing** of the favorites (their
  folders included), playlists, artists and albums; an item plays in place of
  the queue, after the current song, or at the end of the queue. The core
  scene action "Play music on a speaker" uses the same catalog, and keeps an
  item by its Lyrion address (it survives a full rescan of the library).
- Covers resized by Lyrion itself (300 px for the player, 64 px in the
  lists), read with the server credentials.

### Changed

- Requires Gladys 5.3.0 or later (SDK 0.16).
- The playback state is writable (play, pause, stop) and reads 2 (stopped)
  instead of 0 when the player is stopped or off.
- Title and artist are music texts (`music/title`, `music/artist`, same
  external ids), empty when nothing is loaded instead of a dash; a radio
  without song information shows the station name instead of the name of
  its stream file.
- Mute is a music mute (`music/mute`, same external id) that takes a value
  (1 mutes, 0 unmutes) instead of toggling on each press.
- Devices added with 1.0.x get the new features after **Update** in the
  Discover tab of the integration; until then they keep their features (mute
  still toggles), with the empty texts and the stopped state of 1.1.0.

## [1.0.1] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.0] - 2026-10-14

### Added

- One Gladys device per player of a Lyrion Music Server (Squeezebox,
  piCorePlayer, squeezelite...): power, playback state, play, pause, stop,
  previous, next, volume, mute, title and artist, driven by the core Music box.
- Announcements: the core "Talk on a speaker" action and the "Play an
  announcement" scene action play an audio address, then give the music back
  (song, position, volume, state, repeat mode, power).
- Instant updates through the Lyrion CLI (port 9090), with a read every
  5 seconds when it is closed.
- Dashboard widget "Lyrion players": every player with what it plays and a
  "Pause all" button, or one player with its cover and buttons.
- Scene triggers: playback started, playback stopped (paused, stopped, turned
  off), song changed.
- Scene actions: play a Lyrion favorite, set the volume of one or every player,
  pause every player, play an announcement, join a group of players, leave it.
- HTTP basic authentication of Lyrion's password protection.
- English, French, German and Spanish texts and documentation.

[Unreleased]: https://github.com/guim31/gladys-lyrion/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-lyrion/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-lyrion/releases/tag/v1.0.0
