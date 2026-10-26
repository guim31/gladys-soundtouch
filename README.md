# Bose SoundTouch for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
controls **Bose SoundTouch** speakers (SoundTouch 10, 20, 30, 300, Wave,
Lifestyle…) over the local network, through their documented web API (port 8090) and their notification WebSocket (port 8080). No cloud, no account: Bose
has announced the end of the SoundTouch cloud, and this local API is what keeps
these speakers useful.

> **Developed without the hardware: feedback welcome.** The integration is
> built and tested against recorded answers of real speakers (from the tests of
> the Home Assistant integration and of libsoundtouch), not against a physical
> speaker. Please report what works and what does not in the
> [issues](https://github.com/guim31/gladys-soundtouch/issues).

Not affiliated with Bose. Bose and SoundTouch are trademarks of Bose
Corporation.

## Features

- **Automatic discovery**: the speakers announce themselves in mDNS
  (`_soundtouch._tcp`); the Gladys core browses for the integration (mediated
  network discovery). IP addresses can be typed by hand for the ones it does
  not see.
- **One device per speaker, a music player** (Gladys 5.3): the **Music**
  dashboard box shows title, artist, album, artwork and progress, and drives
  play / pause / stop, previous / next, shuffle, repeat, mute and volume. The
  device also has power, **source** (AUX, Bluetooth and the stored presets, by
  name) and the **multi-room group** (read only).
- **Music panel**: the stored presets, with their cover, playable from the
  panel and from the `music.play-media` scene action. The web API has no queue,
  no search and no library browsing: nothing more is offered.
- **Real time**: every speaker pushes its changes (volume, track, source,
  presets, group) over its WebSocket. The integration also refreshes each
  speaker by itself, every 2 minutes (30 s while the WebSocket is down): the
  Gladys core does not reliably poll external devices (Gladys#3198).
- **Scene actions**: _Play a SoundTouch preset_ (1 to 6) and _Play an audio
  address_ (an `http://` stream or file, through the speaker's UPnP renderer —
  the link with Gladys Music: any `http://` address Gladys can build, the
  speaker can play).
- **Scene trigger**: _SoundTouch preset started_, when a preset starts outside
  Gladys (speaker buttons, remote, SoundTouch app): the preset buttons become
  scene buttons.
- **Dashboard widget** "SoundTouch player": title, artist, source, volume,
  group, previous / play-pause / next, and a **Presets** button that opens the
  list of the six presets (Gladys 5.2.0+).
- A **transport badge** per device: local, or unreachable when the speaker
  does not answer.
- Texts in **English, French, German and Spanish**.

## Requirements

- Gladys Assistant **5.3.0** or later (music player); before that, **5.2.0** (widget buttons opening a form, mediated
  mDNS discovery, scene triggers and actions).
- SoundTouch speakers set up with the SoundTouch app, on the same local network
  as Gladys, reachable on TCP 8090, 8080 and (for _Play an audio address_) 8091.

## Installation

1. In Gladys, open **Integrations → Install from GitHub** and give the address
   of this repository (or install it from the catalog once it is listed). The
   install screen shows the mDNS discovery request (`_soundtouch._tcp`).
2. Open the **Discovery** tab: the speakers found appear there. Add them.
3. A speaker is missing? In **Configuration**, type its IP address (shown in the
   SoundTouch app, under _Settings_ → _Speaker Settings_ → _Speaker Info_),
   save, and check **Discovery** again. Give it a fixed address in your router
   (DHCP reservation) if you can.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

```
Gladys core ──mDNS (_soundtouch._tcp)──▶ LAN      (the core browses, on the host network)
     ▲                                            (the integration only reads the results)
     │ SDK (WebSocket + host API)
Integration container ──HTTP :8090 /info /now_playing /volume /presets /sources /getZone──▶ speaker
                      ◀──── WebSocket :8080 ("gabbo"): <updates> on every change ─────────
                      ──HTTP :8090 POST /key /volume /select (commands)──────────────────▶
                      ──HTTP :8091 UPnP SetAVTransportURI (play an address)──────────────▶
```

- The speaker is identified by its **device id** (the MAC address of its main
  module): a speaker that changes IP address (DHCP) keeps its device; a new scan
  (every 15 minutes, or from the Discovery tab) finds its new address.
- POWER and MUTE are toggles on the speaker: the integration only sends them
  when the state differs from the one asked. Presets are played by sending
  back their own `ContentItem` to `/select` (never the `PRESET_n` key, whose
  long press stores a preset).
- Only the **changes** are published to Gladys (the SDK deduplicates), with a
  heartbeat every 6 hours; pushes closer than 300 ms are merged (a volume knob
  turned).
- What the integration knows (addresses, names, presets) is kept in
  `/data/soundtouch-state.json`, so the devices stay in the Discovery list
  while a speaker is off.
- Memory: one WebSocket per speaker (Node.js' built-in client), a small XML
  reader, and no dependency beside the Gladys SDK.

## Gladys 5.3 Music player

- The music features go through the SDK's `publishNowPlaying` (one batch per
  change); the position is sent only on an event (track, play/pause, a jump)
  and moved forward by the dashboard. A radio reports no time: duration 0, and
  the position counts from the start of the stream.
- Feature ids of 1.0 are kept (`mute`, `title`, `artist`, `playback-state`):
  **Update** in the Discovery tab converts them in place and adds `album`,
  `artwork`, `duration`, `position`, `shuffle`, `repeat`.
- Playback state: 0 pause, 1 play, 2 stop (`PAUSE`, `PLAY`, `STOP` keys);
  standby and `STOP_STATE` are 2, `BUFFERING_STATE` is 3. Shuffle and repeat
  (`SHUFFLE_ON/OFF`, `REPEAT_OFF/ALL/ONE`) are refused when the source does not
  report them (radio, AUX, Bluetooth). Position is read only: the web API has
  no seek.
- Manifest `"music": { "browse": true }`: the presets at the root (`preset:<n>`),
  played through `/select`. No queue, no search.
- Artwork: the `<art>` of `/now_playing` (only with `IMAGE_PRESENT`) and the
  `<containerArt>` of the presets, downloaded with bounds (10 MB, 10 s, no
  redirect from the Internet into the LAN) and made smaller than 300 KB in pure
  JavaScript when needed (`src/artwork-resize.js`, shared with the other
  players of the campaign).
- Bose has ended its SoundTouch cloud service: the integration only uses the
  local API. Whether a streaming preset still plays depends on the speaker and
  the service, not on Gladys.

## Limitations

- **Developed without the hardware**: see above.
- Gladys announcements (_Broadcast a notification_) are not offered: Gladys
  Plus serves them from an `https://` address, and the speakers' renderer only
  plays `http://`.
- Multi-room groups are read, not created or changed (do it in the SoundTouch
  app).
- Only AUX and Bluetooth can be selected as inputs; HDMI/TV inputs of the
  Lifestyle and SoundTouch 300 systems and streaming services show as "Other".
- _Play an audio address_ relies on the UPnP renderer of the speaker, which not
  every model has.
- Bass, tone and alarms are not supported.

## Credits

- [libsoundtouch](https://github.com/CharlesBlonde/libsoundtouch) by Charles
  Blonde (Apache-2.0): the protocol knowledge (keys, `/select`, zones, UPnP
  play) and recorded answers used as test fixtures.
- The Home Assistant
  [`soundtouch` integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/soundtouch)
  (Apache-2.0): its behaviour (group detection, sources) and its test fixtures.
- Bose, for publishing the SoundTouch Web API documentation.

The fixtures keep their origin and license in
[`test/fixtures/soundtouch/README.md`](test/fixtures/soundtouch/README.md).

## Development

Node.js 22+, ESM, no build step. The only runtime dependency is
[`@gladysassistant/integration-sdk`](https://github.com/GladysAssistant/integration-sdk-js).

```bash
npm install
npm test              # node --test: unit tests + simulated speakers, SDK fake Gladys
npm run lint
npm run format:check
npx github:GladysAssistant/integration-store .   # store validator
node scripts/probe.mjs <speaker ip>              # read-only check of a real speaker
```

```
index.js                  SDK wiring (src/app.js registers the handlers)
src/hub.js                discovery, live links, own refresh timer, states, commands, trigger
src/devices.js            speaker -> Gladys device, states and commands
src/discovery.js          mDNS results, address probing
src/soundtouch/client.js  HTTP client of the web API and of the UPnP renderer
src/soundtouch/socket.js  notification WebSocket with reconnection
src/soundtouch/model.js   reading the XML documents of the API
src/soundtouch/xml.js     the small XML reader
src/widgets.js            "SoundTouch player" dashboard widget
src/scenes.js             "Play a preset" and "Play an audio address" scene actions
scripts/probe.mjs         read-only check of a real speaker
test/                     node --test; SDK fake Gladys, simulated speakers
test/fixtures/soundtouch/ recorded API answers (Home Assistant, libsoundtouch)
```

`test/gladys-rules.test.js` checks every discovered device against the
category/type table extracted from the Gladys core.

To run it outside Gladys:

```bash
GLADYS_HOST_API_URL="http://localhost:1443" \
GLADYS_INTEGRATION_TOKEN="<token>" \
GLADYS_INTEGRATION_SELECTOR="soundtouch" \
SOUNDTOUCH_DATA_DIR=./data \
npm start
```

Releases are made by the **Release** workflow (Actions → Release); never edit
the versions by hand. A hand-pushed `vX.Y.Z` tag also builds the image and the
GitHub Release, but then `version` in `package.json` and in the manifest (with
the `docker_image` tag) must be bumped and committed before tagging. See
[`CLAUDE.md`](CLAUDE.md) for the project rules.

## License

[Apache-2.0](LICENSE).
