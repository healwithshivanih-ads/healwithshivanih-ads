// Pure unit tests for pickNumber (multi-number resolver). Run with:
//   node --test src/config.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pickNumber } from './config.js';

const cfg = {
  phoneNumberId: 'DEFAULT_PNID',
  token: 'DEFAULT_TOKEN',
  businessAccountId: 'DEFAULT_WABA',
  numbers: {
    marketing: {
      phoneNumberId: 'MKT_PNID',
      businessAccountId: 'MKT_WABA',
      token: 'MKT_TOKEN',
    },
    // a number that shares the default token (no token of its own)
    sharedtoken: {
      phoneNumberId: 'SHARED_PNID',
      businessAccountId: 'SHARED_WABA',
      token: '',
    },
  },
};

test('undefined key → default/legacy number (back-compat)', () => {
  assert.deepEqual(pickNumber(cfg, undefined), {
    phoneNumberId: 'DEFAULT_PNID',
    token: 'DEFAULT_TOKEN',
    businessAccountId: 'DEFAULT_WABA',
  });
});

test("'default' and 'clients' both map to the legacy number", () => {
  assert.equal(pickNumber(cfg, 'default').phoneNumberId, 'DEFAULT_PNID');
  assert.equal(pickNumber(cfg, 'clients').phoneNumberId, 'DEFAULT_PNID');
});

test("'marketing' resolves to its own number + token", () => {
  assert.deepEqual(pickNumber(cfg, 'marketing'), {
    phoneNumberId: 'MKT_PNID',
    token: 'MKT_TOKEN',
    businessAccountId: 'MKT_WABA',
  });
});

test('a named number with no token falls back to the shared token', () => {
  assert.equal(pickNumber(cfg, 'sharedtoken').token, 'DEFAULT_TOKEN');
});

test('unknown key throws (loud, never silently uses the wrong number)', () => {
  assert.throws(() => pickNumber(cfg, 'nope'), /Unknown or unconfigured/);
});

test('named key throws when numbers map is empty/unset', () => {
  assert.throws(() => pickNumber({ phoneNumberId: 'X', token: 'Y' }, 'marketing'), /Unknown or unconfigured/);
});
