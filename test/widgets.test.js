// -----------------------------------------------------------------------------
// The `player` widget: content within the core's vocabulary and budget, bound
// to features that exist, and its actions.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createAll, createWorld, deviceId, settle } from './helpers/world.js';
import { setNowPlaying } from './helpers/fakeSpeaker.js';

const fixture = (name) =>
  readFileSync(new URL(`./fixtures/soundtouch/${name}`, import.meta.url), 'utf8');

async function content(world, speaker, language = 'fr') {
  const ack = await world.gladys.fake.widgetGet('player', {
    settings: { device: deviceId(world.gladys, speaker) },
    language,
    units: 'metric',
  });
  assert.equal(ack.success, true, ack.error);
  return ack.data.content;
}

const featureIdsOf = (world) =>
  new Set(world.gladys.fake.discoveredDevices.flatMap((d) => d.features.map((f) => f.external_id)));

test('the content fits the core rules, in every language and state', async () => {
  const world = await createWorld();
  try {
    await createAll(world);
    const known = featureIdsOf(world);
    for (const speaker of world.network.speakers) {
      for (const language of ['en', 'fr', 'de', 'es']) {
        const widget = await content(world, speaker, language);
        assert.deepEqual(validateWidgetContent(widget), [], `${speaker.id} ${language}`);
        // validateWidgetContent does not check the bound features exist.
        for (const component of widget.components) {
          if (component.device_feature) {
            assert.ok(known.has(component.device_feature), component.device_feature);
          }
        }
        const buttons = widget.components.filter((component) => component.type === 'button');
        const keys = buttons.filter((b) => b.action).map((b) => b.action.key);
        assert.equal(new Set(keys).size, keys.length, 'action keys are unique');
      }
    }
  } finally {
    await world.app.stop();
  }
});

test('what the widget shows for a playing speaker', async () => {
  const world = await createWorld();
  try {
    await createAll(world);
    const [kitchen] = world.network.speakers;
    const widget = await content(world, kitchen, 'fr');
    const [heading, caption, tile, status] = widget.components;
    assert.equal(heading.text, 'MockTrack');
    assert.equal(caption.text, 'MockArtist · Présélection 2 · MockStation');
    assert.equal(tile.device_feature, `${deviceId(world.gladys, kitchen)}:volume`);
    assert.deepEqual(
      status.items.map((item) => `${item.label}: ${item.value}`),
      [
        'État: Lecture',
        'Source: Présélection 2 · MockStation',
        'Groupe: Pilote My SoundTouch 2, 020000000003',
      ],
    );
    const buttons = widget.components.filter((component) => component.type === 'button');
    assert.deepEqual(
      buttons.map((button) => button.icon),
      ['skip-back', 'pause', 'skip-forward', 'radio'],
    );
    // The current state is told by icons, never by the `primary` style.
    assert.ok(buttons.every((button) => button.style !== 'primary'));
    const presetField = buttons[3].action.fields[0];
    assert.deepEqual(
      presetField.options.map((option) => option.value),
      ['1', '2'],
    );
    assert.equal(presetField.default, '2');
  } finally {
    await world.app.stop();
  }
});

test('a speaker in standby offers to turn it on', async () => {
  const world = await createWorld();
  try {
    await createAll(world);
    const bedroom = world.network.speakers[1];
    const widget = await content(world, bedroom, 'en');
    assert.equal(widget.components[0].text, 'My SoundTouch 2');
    const power = widget.components.find((c) => c.type === 'button' && c.action?.key === 'power');
    assert.ok(power);
    const ack = await world.gladys.fake.widgetAction(
      'player',
      'power',
      {},
      {
        settings: { device: deviceId(world.gladys, bedroom) },
      },
    );
    assert.equal(ack.success, true, ack.error);
    await settle(world.hub);
    assert.deepEqual(bedroom.keys, ['POWER']);
  } finally {
    await world.app.stop();
  }
});

test('the widget actions: play/pause, preset from the form', async () => {
  const world = await createWorld();
  try {
    await createAll(world);
    const [kitchen] = world.network.speakers;
    const settings = { device: deviceId(world.gladys, kitchen) };

    let ack = await world.gladys.fake.widgetAction('player', 'play_pause', {}, { settings });
    assert.equal(ack.success, true, ack.error);
    assert.deepEqual(kitchen.keys, ['PLAY_PAUSE']);

    setNowPlaying(kitchen, fixture('ha_device1_now_playing_aux.xml'));
    await settle(world.hub);
    ack = await world.gladys.fake.widgetAction(
      'player',
      'preset',
      {},
      {
        settings,
        values: { preset: '2' },
      },
    );
    assert.equal(ack.success, true, ack.error);
    assert.equal(ack.data.message.fr, 'Présélection 2 · MockStation');
    assert.match(kitchen.selected.at(-1), /sXXXXX/);
    await settle(world.hub);
    // Started from Gladys: no scene event.
    assert.deepEqual(world.gladys.fake.sceneEvents, []);

    // An older core relays the tap without the form.
    ack = await world.gladys.fake.widgetAction('player', 'preset', {}, { settings });
    assert.equal(ack.success, false);
    assert.match(ack.error, /Update Gladys/);
  } finally {
    await world.app.stop();
  }
});

test('the widget is nudged when what it shows changes, not for the volume', async () => {
  const world = await createWorld();
  try {
    await createAll(world);
    const [kitchen] = world.network.speakers;
    const before = world.gladys.fake.widgetRefreshes.length;
    world.network.speakers[0].volume.level = 50;
    const record = world.hub.speakers.get('020000000001');
    await world.hub.refresh(record);
    await settle(world.hub);
    assert.equal(world.gladys.fake.widgetRefreshes.length, before);
    setNowPlaying(kitchen, fixture('ha_device1_now_playing_bluetooth.xml'));
    await settle(world.hub);
    assert.equal(world.gladys.fake.widgetRefreshes.length, before + 1);
  } finally {
    await world.app.stop();
  }
});

test('no device chosen, or an unknown one: a hint, in the user language', async () => {
  const world = await createWorld();
  try {
    let ack = await world.gladys.fake.widgetGet('player', { settings: {}, language: 'de' });
    assert.match(ack.data.content.components[0].text, /Wähle in den Einstellungen/);
    ack = await world.gladys.fake.widgetGet('player', {
      settings: { device: 'ext:test-integration:speaker:ffffffffffff' },
      language: 'es',
    });
    assert.match(ack.data.content.components[0].text, /aún no es conocido/);
  } finally {
    await world.app.stop();
  }
});
