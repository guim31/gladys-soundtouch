# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

### Added

- Gladys 5.3 music player: each speaker now publishes what it plays to the
  Music box of the dashboard: title, artist, album, artwork, duration and
  position (moved forward by the dashboard itself, never sent every second),
  shuffle and repeat (on the sources that have them: Spotify, stored music…;
  off elsewhere),
  mute and volume. Playback state is writable: play, pause and **stop**.
- Music panel: the six presets of the speaker, with their cover, playable from
  the panel and from the `music.play-media` scene action (sent back to the
  speaker like the preset buttons, never as a long press that would store one).
- Artwork served to Gladys through its proxy: Spotify and TuneIn covers as
  they are, a large cover from a media server (stored music) made small in the
  container with the small pure-JavaScript `jpeg-js` encoder (a runtime
  dependency).

### Changed

- Requires Gladys 5.3.0 and SDK 0.16.0.
- Existing devices: click **Update** on the speaker in the Discovery tab to get
  the new features. Feature ids are kept: Mute (a switch), Now playing and
  Artist (texts) become music features in place, so scenes and dashboards keep
  working; before the update the new values are simply ignored by Gladys.
- Playback state: standby and a stopped player are now **2 (idle)** instead of
  0, and buffering is 3: a scene testing `= 0` no longer fires on standby.
- Now playing and Artist are empty in standby (they showed "Standby" and "—"):
  the Music box shows an empty player. The Power feature still says it.
- Mute reads the speaker's state just before toggling it, so a mute changed on
  the remote a moment earlier is never undone by mistake.

## [1.0.1] - 2026-10-15

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

[Unreleased]: https://github.com/guim31/gladys-soundtouch/compare/v1.0.1...HEAD
[1.0.1]: https://github.com/guim31/gladys-soundtouch/releases/tag/v1.0.1
