// -----------------------------------------------------------------------------
// The integration refreshes the speakers by itself: the Gladys core does not
// reliably poll external devices (Gladys#3198), and a device created without
// polling fields is never polled. These tests run the hub's real timers, with
// short periods, and never call onPoll.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAll, createWorld, featureId } from './helpers/world.js';
import { FIXTURES, createSpeaker, setVolume } from './helpers/fakeSpeaker.js';

async function waitFor(check, timeoutMs = 3_000) {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error('timed out');
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

const lastValue = (gladys, externalId) => {
  const states = gladys.fake.states.filter((s) => s.device_feature_external_id === externalId);
  return states.length ? (states.at(-1).text ?? states.at(-1).state) : undefined;
};

/** Counts the core's polls: there must be none. */
function countPolls(world) {
  const counter = { polls: 0 };
  const poll = world.hub.poll.bind(world.hub);
  world.hub.poll = (device) => {
    counter.polls += 1;
    return poll(device);
  };
  return counter;
}

test('a change missed by the WebSocket is caught by the periodic check, without onPoll', async () => {
  const speakers = [createSpeaker(FIXTURES.kitchen)];
  const world = await createWorld({
    speakers,
    timers: true,
    timings: { checkMs: 40, fallbackPollMs: 20 },
  });
  const counter = countPolls(world);
  try {
    await createAll(world);
    const [kitchen] = speakers;
    // The speaker changes without pushing anything (a lost notification).
    setVolume(kitchen, { level: 77 }, { notify: false });
    await waitFor(() => lastValue(world.gladys, featureId(world.gladys, kitchen, 'volume')) === 77);
    assert.equal(counter.polls, 0);
  } finally {
    await world.app.stop();
  }
});

test('without WebSocket the speaker is polled by the integration', async () => {
  const kitchen = createSpeaker(FIXTURES.kitchen);
  kitchen.noWebSocket = true;
  const world = await createWorld({
    speakers: [kitchen],
    timers: true,
    timings: { checkMs: 60_000, fallbackPollMs: 20 },
    socketTimings: { reconnectMinMs: 60_000 },
  });
  const counter = countPolls(world);
  try {
    await createAll(world);
    const requestsBefore = kitchen.requests.length;
    setVolume(kitchen, { level: 5 }, { notify: false });
    await waitFor(() => lastValue(world.gladys, featureId(world.gladys, kitchen, 'volume')) === 5);
    assert.ok(kitchen.requests.length > requestsBefore);
    assert.equal(counter.polls, 0);
    // The search report tells the speaker is polled, not live.
    const ack = await world.gladys.fake.action('search', {});
    assert.match(ack.data.message.en, /192\.0\.2\.1, polled\)/);
  } finally {
    await world.app.stop();
  }
});

test('a link that died without closing is replaced when the check fails', async () => {
  const kitchen = createSpeaker(FIXTURES.kitchen);
  const world = await createWorld({
    speakers: [kitchen],
    timers: true,
    timings: { checkMs: 30, fallbackPollMs: 30 },
    socketTimings: { reconnectMinMs: 10 },
  });
  try {
    await createAll(world);
    const [socket] = kitchen.sockets;
    // Power cut: the HTTP check fails while the socket still looks open.
    kitchen.offline = true;
    await waitFor(() => world.gladys.fake.transports.at(-1)?.transport === 'unreachable');
    assert.equal(socket.readyState, 3, 'the dead socket is closed');
    kitchen.offline = false;
    await waitFor(() => world.gladys.fake.transports.at(-1)?.transport === 'local');
    await waitFor(() => kitchen.sockets.size === 1);
  } finally {
    await world.app.stop();
  }
});

test('an unchanged value is published again (heartbeat)', async () => {
  const speakers = [createSpeaker(FIXTURES.kitchen)];
  const world = await createWorld({
    speakers,
    timers: true,
    timings: { checkMs: 20, fallbackPollMs: 20, heartbeatMs: 60 },
  });
  try {
    await createAll(world);
    const id = featureId(world.gladys, speakers[0], 'volume');
    const count = () =>
      world.gladys.fake.states.filter((s) => s.device_feature_external_id === id).length;
    await waitFor(() => count() >= 3);
    assert.ok(
      world.gladys.fake.states
        .filter((s) => s.device_feature_external_id === id)
        .every((s) => s.state === 12),
    );
  } finally {
    await world.app.stop();
  }
});
