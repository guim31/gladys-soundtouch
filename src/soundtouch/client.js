// -----------------------------------------------------------------------------
// HTTP client of one SoundTouch speaker (web API on port 8090, UPnP renderer
// on port 8091). No authentication: the API is open on the local network.
//
// Every call has a timeout: a speaker unplugged mid-request must not hold a
// command or a refresh forever. A failure to reach the speaker carries
// `unreachable: true`, an HTTP error or an <errors> answer does not.
// -----------------------------------------------------------------------------

import { escapeXml, parseXml } from './xml.js';
import {
  contentItemXml,
  parseInfo,
  parseNowPlaying,
  parsePresets,
  parseSources,
  parseVolume,
  parseZone,
} from './model.js';

export const API_PORT = 8090;
export const WEBSOCKET_PORT = 8080;
export const UPNP_PORT = 8091;
export const REQUEST_TIMEOUT_MS = 5_000;

// Remote-control keys the integration sends (POST /key, press then release).
export const KEYS = {
  POWER: 'POWER',
  PLAY: 'PLAY',
  PAUSE: 'PAUSE',
  PLAY_PAUSE: 'PLAY_PAUSE',
  STOP: 'STOP',
  NEXT: 'NEXT_TRACK',
  PREVIOUS: 'PREV_TRACK',
  MUTE: 'MUTE',
  SHUFFLE_ON: 'SHUFFLE_ON',
  SHUFFLE_OFF: 'SHUFFLE_OFF',
  REPEAT_OFF: 'REPEAT_OFF',
  REPEAT_ALL: 'REPEAT_ALL',
  REPEAT_ONE: 'REPEAT_ONE',
};

export class SoundTouchError extends Error {
  constructor(message, { unreachable = false, status = null } = {}) {
    super(message);
    this.name = 'SoundTouchError';
    this.unreachable = unreachable;
    this.status = status;
  }
}

export class SoundTouchClient {
  /**
   * @param {string} host IPv4 address or DNS name, without port
   * @param {object} [options]
   * @param {typeof fetch} [options.fetch] test seam
   * @param {number} [options.timeoutMs]
   */
  constructor(host, { fetch: fetchImpl, timeoutMs = REQUEST_TIMEOUT_MS } = {}) {
    this.host = host;
    this.fetch = fetchImpl ?? globalThis.fetch;
    this.timeoutMs = timeoutMs;
  }

  get baseUrl() {
    return `http://${this.host}:${API_PORT}`;
  }

  get websocketUrl() {
    return `ws://${this.host}:${WEBSOCKET_PORT}/`;
  }

  async request(path, { method = 'GET', body, port = API_PORT, headers = {} } = {}) {
    const url = `http://${this.host}:${port}${path}`;
    let response;
    try {
      response = await this.fetch(url, {
        method,
        body,
        headers: body === undefined ? headers : { 'Content-Type': 'text/xml', ...headers },
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (err) {
      const reason = err?.name === 'TimeoutError' ? 'no answer' : (err?.cause?.code ?? err.message);
      throw new SoundTouchError(`${this.host} unreachable (${reason})`, { unreachable: true });
    }
    let text;
    try {
      text = await response.text();
    } catch (err) {
      throw new SoundTouchError(`${this.host}: answer cut (${err.message})`, { unreachable: true });
    }
    if (!response.ok) {
      throw new SoundTouchError(`${this.host}${path}: HTTP ${response.status}`, {
        status: response.status,
      });
    }
    // The API answers 200 with an <errors> document on a refused command.
    if (text.includes('<errors')) {
      const error = parseXml(text).children.find((node) => node.name === 'error');
      const detail = error?.attributes.name ?? error?.text.trim() ?? 'error';
      throw new SoundTouchError(`${this.host}${path}: ${detail}`);
    }
    return text;
  }

  async getInfo() {
    return parseInfo(await this.request('/info'));
  }

  async getNowPlaying() {
    return parseNowPlaying(await this.request('/now_playing'));
  }

  async getVolume() {
    return parseVolume(await this.request('/volume'));
  }

  async getPresets() {
    return parsePresets(await this.request('/presets'));
  }

  async getSources() {
    return parseSources(await this.request('/sources'));
  }

  async getZone() {
    return parseZone(await this.request('/getZone'));
  }

  /** Everything the integration shows, in one go (6 small requests). */
  async getSnapshot() {
    const info = await this.getInfo();
    const [nowPlaying, volume, presets, zone] = await Promise.all([
      this.getNowPlaying(),
      this.getVolume(),
      this.getPresets(),
      this.getZone(),
    ]);
    // Older firmwares may not answer /sources: AUX and Bluetooth are offered then.
    const sources = await this.getSources().catch((err) => {
      if (err.unreachable) {
        throw err;
      }
      return null;
    });
    return { info, nowPlaying, volume, presets, zone, sources };
  }

  /** A remote-control key: press, then release (a held PRESET key stores a preset). */
  async sendKey(key) {
    if (!Object.values(KEYS).includes(key)) {
      throw new Error(`Unknown key ${key}`);
    }
    await this.request('/key', {
      method: 'POST',
      body: `<key state="press" sender="Gabbo">${key}</key>`,
    });
    await this.request('/key', {
      method: 'POST',
      body: `<key state="release" sender="Gabbo">${key}</key>`,
    });
  }

  async setVolume(level) {
    const value = Math.round(Math.min(100, Math.max(0, Number(level))));
    if (!Number.isFinite(value)) {
      throw new Error(`Invalid volume ${level}`);
    }
    await this.request('/volume', { method: 'POST', body: `<volume>${value}</volume>` });
  }

  /** Play a stored preset: its ContentItem, sent back as the speaker gave it. */
  async selectPreset(preset) {
    await this.request('/select', { method: 'POST', body: preset.xml });
  }

  /** Switch to an input: AUX (with its account, e.g. AUX or AUX3) or BLUETOOTH. */
  async selectSource(source, account) {
    await this.request('/select', { method: 'POST', body: contentItemXml(source, account) });
  }

  /**
   * Play an http:// address through the speaker's UPnP renderer (port 8091),
   * like libsoundtouch. The renderer does not do https.
   */
  async playUrl(url) {
    const body =
      '<?xml version="1.0" encoding="utf-8"?>' +
      '<s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" ' +
      's:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/"><s:Body>' +
      '<u:SetAVTransportURI xmlns:u="urn:schemas-upnp-org:service:AVTransport:1">' +
      `<InstanceID>0</InstanceID><CurrentURI>${escapeXml(url)}</CurrentURI>` +
      '<CurrentURIMetaData></CurrentURIMetaData></u:SetAVTransportURI></s:Body></s:Envelope>';
    await this.request('/AVTransport/Control', {
      method: 'POST',
      port: UPNP_PORT,
      body,
      headers: {
        SOAPACTION: '"urn:schemas-upnp-org:service:AVTransport:1#SetAVTransportURI"',
        'Content-Type': 'text/xml; charset="utf-8"',
      },
    });
  }
}
