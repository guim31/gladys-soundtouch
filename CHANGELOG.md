# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Bose SoundTouch speakers on the local network (SoundTouch 10, 20, 30, 300,
  Wave, Lifestyle…), found automatically through Gladys (mDNS) or by IP
  address. No account, no cloud.
- One music player device per speaker, driven by the Gladys Music box: play,
  pause, previous, next, volume and playback state; plus power, mute, source
  (AUX, Bluetooth and the stored presets, by name), now playing, artist and
  multi-room group.
- Real-time updates from the speaker's notifications, and a refresh by the
  integration itself every 2 minutes (30 seconds without notifications).
- Scene actions "Play a SoundTouch preset" and "Play an audio address"
  (`http://`, through the speaker's UPnP renderer).
- Scene trigger "SoundTouch preset started", when a preset starts from the
  speaker, its remote or the SoundTouch app.
- Dashboard widget "SoundTouch player": what is playing, volume, group, play
  buttons and the six presets.
- Texts and documentation in English, French, German and Spanish.
- `scripts/probe.mjs`, a read-only check of a real speaker.

[Unreleased]: https://github.com/guim31/gladys-soundtouch/commits/main
