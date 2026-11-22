const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'js', 'cloud.js'), 'utf8');

function makeStore(rows, shouldFail = false) {
  const requests = [];
  const window = { LIFEDROP_CONFIG: { cloud: { enabled: true, url: 'http://example.test', anonKey: 'test-only' } } };
  const localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
  const fetch = async (url) => {
    requests.push(url);
    if (shouldFail) {
      return { ok: false, status: 503, statusText: 'Unavailable', json: async () => ({ message: 'Unavailable' }) };
    }
    const name = new URL(url).pathname.split('/').pop();
    const data = rows[name] || [];
    return { ok: true, status: 200, text: async () => JSON.stringify(data) };
  };
  vm.runInNewContext(source, { window, localStorage, fetch, URL, location: { origin: 'http://example.test', pathname: '/' } });
  return { store: window.LifeDropCloud, requests };
}

test('stock mapping keeps missing entries separate from reported zero', async () => {
  const updated = '2026-11-20T10:00:00Z';
  const { store, requests } = makeStore({
    hospitals: [{ id: 'bank', name: 'Test bank', city: 'Test city', phone: '' }],
    inventory: [{ hospital_id: 'bank', blood_group: 'O+', units: 0, updated_at: updated }]
  });
  const payload = await store.pull();
  const bank = payload.hospitals[0];
  assert.equal(bank.stock['O+'], 0);
  assert.equal(bank.stockUpdatedAt['O+'], updated);
  assert.equal(bank.stock['A+'], null);
  assert.equal(bank.stockUpdatedAt['A+'], null);
  assert.ok(requests.some((url) => url.includes('inventory?') && url.includes('updated_at')));
});

test('an empty bank list stays empty', async () => {
  const { store } = makeStore({});
  const payload = await store.pull();
  assert.equal(payload.hospitals.length, 0);
  assert.equal(payload.donors.length, 0);
  assert.equal(payload.sos.length, 0);
});

test('a failed pull does not report a ready snapshot', async () => {
  const { store } = makeStore({}, true);
  await assert.rejects(store.pull(), /Unavailable/);
  assert.equal(store.ready, false);
});
