# Bose SoundTouch

Control your Bose SoundTouch speakers (SoundTouch 10, 20, 30, 300, Wave,
Lifestyle and the other SoundTouch systems) from Gladys, over the local network:
power, volume, mute, play and pause, previous and next track, source, the six
presets, what is playing and the multi-room group.

> **Developed without the hardware: feedback welcome.** This integration was
> written from the Bose SoundTouch Web API documentation and from the
> recorded answers of other open-source projects, without a speaker at hand.
> Tell us on the Gladys forum what works and what does not.

This integration is not affiliated with Bose. Bose and SoundTouch are trademarks
of Bose Corporation.

## Overview

Each speaker becomes one Gladys device, a music player: the Gladys **Music**
dashboard box drives it (play, pause, previous, next, volume slider), and the
device box shows the rest. Changes made from the speaker, its remote or the
SoundTouch app reach Gladys within a second, through the speaker's own
notifications.

Everything stays on your network: the integration talks to the speakers
directly, with no account and no cloud. Bose has announced the end of the
SoundTouch cloud service; the local API this integration uses keeps working
without it.

## Requirements

- Gladys 5.3.0 or later.
- SoundTouch speakers on the same network as Gladys, already set up with the
  SoundTouch app (they must be on your Wi-Fi or Ethernet network).
- Gladys must reach the speakers on TCP ports 8090 (API), 8080 (notifications)
  and, for the "Play an audio address" action, 8091 (UPnP).

## Configuration

1. Install the integration (**Integrations → Install from GitHub** while it is
   not in the store), then open its **Configuration** tab.
2. Speakers on the same network are found automatically (mDNS, relayed by
   Gladys). If one is missing, type its IP address in **Speaker IP
   addresses** (several addresses: separate them with commas). The SoundTouch
   app shows it under Settings, Speaker Settings, Speaker Info. Give your
   speakers a fixed address in your router if you can.
3. Choose the **Language of the texts**: the feature names (set when you add a
   speaker) and the texts the integration writes (source, group, standby).
   French by default.
4. Save, then open the **Discovery** tab and add your speakers.

The **Search for speakers** button looks for the speakers again and lists the
ones found, with their model, their address and whether their notifications
are live.

## The speaker device

| Feature             | What it does                                                                   |
| ------------------- | ------------------------------------------------------------------------------ |
| Power               | Turns the speaker on (it resumes what it last played) or puts it in standby    |
| Volume              | 0 to 100, follows the volume knob and the remote                               |
| Mute                | Mutes or unmutes                                                               |
| Play, Pause         | Buttons of the Music box                                                       |
| Previous, Next      | Previous or next track (on the sources that allow it)                          |
| Playback state      | Playing, paused, stopped (standby too) or loading; writable: play, pause, stop |
| Source              | AUX, Bluetooth or one of the stored presets; "Other" for any other source      |
| Now playing (title) | The track, else the station, else the input ("AUX IN"); empty in standby       |
| Artist              | The artist; empty when there is none                                           |
| Multi-room group    | "Not grouped", "Leads Kitchen, Bedroom" or "Follows Living room", read only    |
| Album               | The album, else the station of a radio playing a song                          |
| Artwork             | The cover of the track or the logo of the station                              |
| Duration, Position  | Length of the track and where it is (0 for a radio); position is read only     |
| Shuffle, Repeat     | On the sources that have them (Spotify, stored music…)                         |

The **Source** list shows the presets stored on the speaker with their names
("Preset 2 · FIP"); it follows the presets you store or change in the
SoundTouch app. Picking "Other" does nothing: it only means the speaker plays a
source Gladys cannot choose itself (Spotify, a radio outside the presets,
standby). AUX is only offered on the speakers that have an AUX input.

Multi-room groups are shown, not created: create them in the SoundTouch app.

## Gladys 5.3 Music player

From Gladys 5.3, the **Music** box of the dashboard is a real player: title,
artist, album, artwork, progress bar, play / pause / stop, previous / next,
shuffle, repeat, mute and volume. Its **panel** lists the six presets of the
speaker, with their cover: one click plays it, exactly like the preset button
on the speaker. The same presets can be started by the scene action **Play a
media** of Gladys.

- **Existing devices**: open **Integrations → Discovery**, and click **Update**
  on each speaker to get the new features. Nothing is lost: Mute, Now playing,
  Artist and Playback state keep their ids, scenes and dashboards keep working.
- Playback state now says **2** when the speaker is stopped or in standby (it
  said 0, like a pause), and 3 while it loads: check the scenes that test it.
- Shuffle and repeat only work on the sources that have them (Spotify, music
  stored on a server…), not on a radio, AUX or Bluetooth.
- There is no queue and no search: the speaker's web API offers neither.
- The progress bar moves by itself in the dashboard: the speaker's position is
  only sent when something happens (new track, pause, a jump).

## Dashboard widget

The **SoundTouch player** widget shows one speaker (chosen in its settings):

- the title and the artist, with the source or the preset;
- the volume, live;
- the state (playing, paused, standby, unreachable), the source and the
  multi-room group;
- four buttons: previous, play/pause (turn on when the speaker is in standby),
  next, and **Presets**, which opens the list of the six presets to start one.

The Gladys **Music** box works too: choose the speaker in it.

## Scenes

### Trigger: SoundTouch preset started

**SoundTouch preset started** fires when one of the six presets starts outside
Gladys: from the buttons of the speaker, its remote or the SoundTouch app. It
also fires when the speaker wakes up on a preset. It does not fire when Gladys
starts the preset itself (a scene, the widget, the Source list), so a scene
cannot loop on it.

Filters: the speaker, and the presets (leave empty for any). Variables: the
preset number and the preset name.

### Action: Play a SoundTouch preset

**Play a SoundTouch preset** starts preset 1 to 6 of a speaker, turning it on
if needed. Its output is the name of the preset, for the next actions of the
scene. An empty preset fails the action (the rest of the scene goes on).

### Action: Play an audio address

**Play an audio address** sends an `http://` address (a radio stream, a sound
file served on your network) to the speaker's UPnP renderer, at an optional
volume. The speakers do not play `https://` addresses. Not every model has the
UPnP renderer: on those, the action fails.

Power, volume and source need no dedicated action: use the core's "Control a
device" action on the speaker's features.

## Scene examples

- **Wake up with the radio**: at 7:00 on weekdays, "Play a SoundTouch preset"
  (preset 1, your morning radio) in the bedroom, then set its volume to 15.
- **A preset button as a switch**: when "SoundTouch preset started" fires for
  preset 6 on the living room speaker, turn on the living room lamps and close
  the shutters: the speaker's button becomes a "movie night" button.
- **Quiet when leaving**: when the last person leaves home, set the power of
  every speaker to off.

## Refresh and network

- The speakers push every change (volume, track, source, presets, group) over
  their notification WebSocket: Gladys follows them in real time.
- The integration also reads each speaker over HTTP every 2 minutes (every 30
  seconds while its notifications are down), to catch a lost notification and
  notice a speaker that was unplugged. That is six small requests per speaker,
  on your local network only.
- Unchanged values are sent to Gladys again every 6 hours, so the device never
  shows "no recent value".
- A new search runs every 15 minutes, to follow a speaker whose address
  changed (DHCP).
- The SoundTouch web API has no account, no quota and no key. It is open to
  any device of your network: that is how the speakers are built.

## Troubleshooting

- **No speaker found**: check that the speaker plays from the SoundTouch app,
  then type its IP address in the configuration. Automatic discovery needs a
  Gladys that relays mDNS (5.2.0 or later) and a network that lets mDNS
  through (some mesh Wi-Fi and guest networks do not).
- **The speaker shows as unreachable**: it may be unplugged or in a deep sleep
  (some models leave the network after a long standby). Press a button on the
  speaker, then **Search for speakers**.
- **States arrive late**: the notifications may be blocked between Gladys and
  the speaker (port 8080); the integration then reads the speaker every 30
  seconds. **Search for speakers** shows "polled" instead of "live".
- **A preset is not in the Source list**: store it on the speaker first
  (SoundTouch app or a long press on the preset button).
- Set `LOG_LEVEL=debug` on the integration to see every notification and
  refresh in its logs.

## Limitations

- No seek in a track: the speaker's web API has none.
- Developed without the hardware: the behaviour on a real speaker is not
  verified yet.
- Gladys announcements (the "Broadcast a notification" scene action) are not
  offered: Gladys Plus serves them from an `https://` address, and the
  speakers only play `http://` ones.
- Multi-room groups are read, not created or changed.
- Only AUX and Bluetooth can be selected as inputs: the HDMI and TV inputs of
  the Lifestyle and SoundTouch 300 systems, and the streaming services, are
  shown as "Other".
- Previous and next only work on the sources that allow skipping (not on a
  radio).
- Bass, tone and the alarms of some models are not supported.
