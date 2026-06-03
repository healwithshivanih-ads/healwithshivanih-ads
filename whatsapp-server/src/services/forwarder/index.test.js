// Pure unit tests for chooseRoute (inbound number-aware routing). Run with:
//   node --test src/services/forwarder/index.test.js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chooseRoute } from './index.js';

const MKT = '111marketing';
const opts = { marketingPhoneNumberId: MKT, funnelsAppSlugs: ['40s-decade'] };

test('marketing number → funnels-app even with no slug', () => {
  const r = chooseRoute({ phone_number_id: MKT, body: 'hi there' }, opts);
  assert.equal(r.name, 'funnels-app');
  assert.equal(r.slug, null);
});

test('marketing number → funnels-app and keeps the slug for attribution', () => {
  const r = chooseRoute({ phone_number_id: MKT, body: 'Hi ref:40s-decade' }, opts);
  assert.equal(r.name, 'funnels-app');
  assert.equal(r.slug, '40s-decade');
});

test('default number + known slug → funnels-app', () => {
  const r = chooseRoute({ phone_number_id: '999clients', body: 'ref:40s-decade' }, opts);
  assert.equal(r.name, 'funnels-app');
  assert.equal(r.slug, '40s-decade');
});

test('default number + unknown slug → fm-coach', () => {
  const r = chooseRoute({ phone_number_id: '999clients', body: 'ref:not-a-funnel' }, opts);
  assert.equal(r.name, 'fm-coach');
});

test('default number + no slug → fm-coach', () => {
  const r = chooseRoute({ phone_number_id: '999clients', body: 'just a normal message' }, opts);
  assert.equal(r.name, 'fm-coach');
});

test('back-compat: no marketing number configured → content-based only', () => {
  const noMkt = { marketingPhoneNumberId: null, funnelsAppSlugs: ['40s-decade'] };
  assert.equal(chooseRoute({ phone_number_id: MKT, body: 'hi' }, noMkt).name, 'fm-coach');
  assert.equal(chooseRoute({ phone_number_id: MKT, body: 'ref:40s-decade' }, noMkt).name, 'funnels-app');
});
