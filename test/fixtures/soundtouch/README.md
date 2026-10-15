# SoundTouch fixtures

Answers of the SoundTouch web API, used by the fake speaker of the tests
(`test/helpers/fakeSpeaker.js`). Developed without the hardware: none of these
files was recorded by this project.

| Prefix | Origin                                                                                                                                                                | License    |
| ------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| `ha_`  | Test fixtures of the Home Assistant `soundtouch` integration ([home-assistant/core](https://github.com/home-assistant/core), `tests/components/soundtouch/fixtures`)  | Apache-2.0 |
| `lib_` | Test data of [libsoundtouch](https://github.com/CharlesBlonde/libsoundtouch) by Charles Blonde (`tests/data`): HTTP answers and WebSocket notifications (`ws_*`)      | Apache-2.0 |
| `doc_` | Written for these tests from the examples of the Bose SoundTouch Web API documentation: `/sources`, an empty `/getZone`, an `<errors>` answer, the WebSocket greeting | —          |

Changes made to the originals: private addresses replaced by documentation
addresses (`192.0.2.x`, RFC 5737), and the Home Assistant media URL of the UPnP
fixtures replaced by a local `http://` address. Device ids and serial numbers
were already made up by their authors.
