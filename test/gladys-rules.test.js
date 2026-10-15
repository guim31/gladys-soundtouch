// -----------------------------------------------------------------------------
// Conformity with the Gladys core, on every device discovered from realistic
// fixtures: a SoundTouch 10 group leader playing a preset radio, a member in
// standby without AUX, a SoundTouch 20 on Spotify with an older firmware
// (no /sources) — in every feature-name language.
//
// The table (test/fixtures/gladys-feature-table.json) is extracted from the
// core code: a category/type couple missing there shows as "undefined" or
// without icon in Gladys, a poll frequency outside its list is a 400 on
// discovery, a feature without min/max is a 422 on "Add to Gladys".
// Do not loosen this test to make it pass: fix the integration.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createAll, createWorld } from './helpers/world.js';

const table = JSON.parse(
  await readFile(new URL('./fixtures/gladys-feature-table.json', import.meta.url), 'utf8'),
);

const scenarios = [
  { label: 'English names', config: { language: 'en' } },
  { label: 'French names (default)', config: {} },
  { label: 'German names', config: { language: 'de' } },
  { label: 'Spanish names', config: { language: 'es' } },
];

for (const scenario of scenarios) {
  test(`every discovered device follows the Gladys rules (${scenario.label})`, async () => {
    const world = await createWorld({ config: scenario.config });
    const { gladys, app } = world;
    try {
      const devices = gladys.fake.discoveredDevices;
      assert.equal(devices.length, 3, `expected the fixture speakers, got ${devices.length}`);

      for (const device of devices) {
        const where = device.name;

        // should_poll: true if and only if poll_frequency is provided, in ms.
        if (device.poll_frequency === undefined) {
          assert.notEqual(device.should_poll, true, `${where}: should_poll without poll_frequency`);
        } else {
          assert.equal(device.should_poll, true, `${where}: poll_frequency without should_poll`);
          assert.ok(
            table.poll_frequencies_ms.includes(device.poll_frequency),
            `${where}: poll_frequency ${device.poll_frequency} is not one of ${table.poll_frequencies_ms}`,
          );
        }

        assert.ok(device.features.length > 0, `${where}: no feature`);
        const externalIds = new Set();
        const names = new Set();
        for (const feature of device.features) {
          const at = `${where} / ${feature.name}`;
          const pair = table.pairs[`${feature.category}/${feature.type}`];
          assert.ok(
            pair,
            `${at}: ${feature.category}/${feature.type} is not a couple Gladys knows`,
          );
          assert.ok(
            pair.label_en && pair.label_fr && pair.icon,
            `${at}: couple without label or icon`,
          );

          assert.equal(typeof feature.min, 'number', `${at}: min must be a number`);
          assert.equal(typeof feature.max, 'number', `${at}: max must be a number`);
          assert.ok(
            Number.isFinite(feature.min) && Number.isFinite(feature.max),
            `${at}: finite min/max`,
          );
          assert.ok(feature.min <= feature.max, `${at}: min > max`);
          assert.equal(typeof feature.read_only, 'boolean', `${at}: read_only must be a boolean`);
          assert.equal(
            typeof feature.has_feedback,
            'boolean',
            `${at}: has_feedback must be a boolean`,
          );
          if (feature.unit !== undefined) {
            assert.ok(table.units.includes(feature.unit), `${at}: unknown unit ${feature.unit}`);
          }
          if (feature.supported_options !== undefined) {
            // The core's normalizeSupportedOptions: non-empty labels, unique
            // values, string values on text/select only.
            assert.equal(`${feature.category}/${feature.type}`, 'text/select', at);
            const values = feature.supported_options.map((option) => option.value);
            assert.equal(new Set(values).size, values.length, `${at}: duplicate option`);
            for (const option of feature.supported_options) {
              assert.ok(typeof option.value === 'string' && option.value.trim(), at);
              assert.ok(typeof option.label === 'string' && option.label.trim(), at);
            }
          }

          assert.ok(!externalIds.has(feature.external_id), `${at}: duplicate external_id`);
          externalIds.add(feature.external_id);
          assert.ok(!names.has(feature.name), `${at}: duplicate feature name on the device`);
          names.add(feature.name);
        }
      }

      // Once added, every published state fits its feature: a number within
      // the bounds, or a non-empty text (Gladys ignores an empty one), and a
      // select value among its options.
      await createAll(world);
      const features = new Map(
        devices
          .flatMap((device) => device.features)
          .map((feature) => [feature.external_id, feature]),
      );
      assert.ok(gladys.fake.states.length > 0);
      for (const state of gladys.fake.states) {
        const feature = features.get(state.device_feature_external_id);
        assert.ok(feature, `state for an unknown feature ${state.device_feature_external_id}`);
        if (feature.category === 'text') {
          assert.ok(typeof state.text === 'string' && state.text.trim(), feature.name);
          if (feature.supported_options) {
            assert.ok(
              feature.supported_options.some((option) => option.value === state.text),
              `${feature.name}: ${state.text} is not an option`,
            );
          }
        } else {
          assert.ok(
            state.state >= feature.min && state.state <= feature.max,
            `${feature.name}: ${state.state} outside ${feature.min}-${feature.max}`,
          );
        }
      }
    } finally {
      await app.stop();
    }
  });
}
