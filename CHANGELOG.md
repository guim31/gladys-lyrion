# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

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

[Unreleased]: https://github.com/guim31/gladys-lyrion/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/guim31/gladys-lyrion/releases/tag/v1.0.0
