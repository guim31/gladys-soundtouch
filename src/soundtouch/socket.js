// -----------------------------------------------------------------------------
// Live link to one SoundTouch speaker: the notification WebSocket
// (`ws://<host>:8080/`, sub-protocol `gabbo`).
//
// The speaker pushes an <updates> document on every change, whatever made it
// (the Bose app, the remote, the buttons, another speaker of the group):
// volume, now playing, presets, zone. The link reconnects with a growing
// delay. Node.js 22+ ships a standard WebSocket client: no dependency.
//
// The standard client cannot send pings: a speaker unplugged without closing
// the connection is caught by the hub, whose periodic HTTP check fails and
// restarts the link (see src/hub.js).
// -----------------------------------------------------------------------------

export const SOCKET_PROTOCOL = 'gabbo';

export const SOCKET_TIMINGS = {
  reconnectMinMs: 5_000,
  reconnectMaxMs: 5 * 60_000,
};

export class LiveSocket {
  /**
   * @param {object} options
   * @param {string} options.url
   * @param {(text: string) => void} options.onMessage raw XML text
   * @param {() => void} [options.onOpen]
   * @param {() => void} [options.onClose] once per lost connection
   * @param {(url: string, protocols: string[]) => WebSocket} [options.createSocket] test seam
   * @param {object} [options.timings]
   * @param {object} [options.logger]
   */
  constructor({ url, onMessage, onOpen, onClose, createSocket, timings, logger }) {
    this.url = url;
    this.onMessage = onMessage;
    this.onOpen = onOpen ?? (() => {});
    this.onClose = onClose ?? (() => {});
    this.createSocket = createSocket ?? ((target, protocols) => new WebSocket(target, protocols));
    this.timings = { ...SOCKET_TIMINGS, ...timings };
    this.logger = logger;
    this.socket = null;
    this.connected = false;
    this.stopped = true;
    this.delay = this.timings.reconnectMinMs;
    this.reconnectTimer = null;
  }

  start() {
    if (!this.stopped) {
      return;
    }
    this.stopped = false;
    this.connect();
  }

  stop() {
    this.stopped = true;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.teardown();
  }

  /** Drop the connection and open a new one now (it looked dead). */
  restart() {
    if (this.stopped) {
      return;
    }
    const wasConnected = this.connected;
    this.teardown();
    if (wasConnected) {
      this.onClose();
    }
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.delay = this.timings.reconnectMinMs;
    this.connect();
  }

  connect() {
    let socket;
    try {
      socket = this.createSocket(this.url, [SOCKET_PROTOCOL]);
    } catch (err) {
      this.logger?.debug(`WebSocket ${this.url}: ${err.message}`);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.addEventListener('open', () => {
      if (this.socket !== socket) {
        return;
      }
      this.connected = true;
      this.delay = this.timings.reconnectMinMs;
      this.onOpen();
    });
    socket.addEventListener('message', (event) => {
      if (this.socket === socket && typeof event.data === 'string') {
        this.onMessage(event.data);
      }
    });
    const closed = () => {
      if (this.socket !== socket) {
        return;
      }
      const wasConnected = this.connected;
      this.teardown();
      if (wasConnected) {
        this.onClose();
      }
      this.scheduleReconnect();
    };
    socket.addEventListener('close', closed);
    socket.addEventListener('error', closed);
  }

  teardown() {
    const socket = this.socket;
    this.socket = null;
    this.connected = false;
    if (socket) {
      try {
        socket.close();
      } catch {
        // already closed
      }
    }
  }

  scheduleReconnect() {
    if (this.stopped || this.reconnectTimer) {
      return;
    }
    const delay = this.delay;
    this.delay = Math.min(this.delay * 2, this.timings.reconnectMaxMs);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      if (!this.stopped) {
        this.connect();
      }
    }, delay);
    this.reconnectTimer.unref?.();
  }
}
