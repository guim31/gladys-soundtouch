import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, normalizeConfig, parseHosts } from '../src/config.js';

test('defaults: no typed address, French texts', () => {
  assert.deepEqual(normalizeConfig(), { hosts: [], invalidHosts: [], language: 'fr' });
  assert.equal(DEFAULT_CONFIG.language, 'fr');
});

test('typed addresses: separators, pasted URLs, duplicates, mistakes', () => {
  assert.deepEqual(
    parseHosts(
      '192.0.2.10, 192.0.2.11;http://192.0.2.12:8090/info\n192.0.2.10 speaker.lan 300.1.1.1 1.2.3',
    ),
    {
      hosts: ['192.0.2.10', '192.0.2.11', '192.0.2.12', 'speaker.lan'],
      invalid: ['300.1.1.1', '1.2.3'],
    },
  );
  assert.deepEqual(parseHosts(undefined), { hosts: [], invalid: [] });
});

test('an unknown language falls back to French', () => {
  assert.equal(normalizeConfig({ language: 'it' }).language, 'fr');
  assert.equal(normalizeConfig({ language: 'de' }).language, 'de');
});
