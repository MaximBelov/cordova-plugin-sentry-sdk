// The JavaScript half of the plugin, run on Node with `cordova.exec` replaced by a recorder: every call has to reach native under the
// service, action and arguments native reads them by, and the promise has to follow the callbacks. Whether native answers is for
// tests/ (on a phone) and test/ios, test/android (the native code on its own).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const wrapper = fileURLToPath(new URL('../../www/SentrySdk.js', import.meta.url));

/** The plugin's JavaScript with a recorder as `cordova.exec`; `calls` is what native would have been sent. */
function load() {
  const calls = [];
  globalThis.cordova = {
    exec: (success, failure, service, action, args) => calls.push({ success, failure, service, action, args }),
  };
  delete require.cache[wrapper];
  return { api: require(wrapper), calls };
}

const OPTIONS = { dsn: 'https://key@example.invalid/1', release: 'app@1.0.0', environment: 'test', appHangTimeoutInterval: 7 };

test('every method sends its action to the SentrySdk service, with the arguments native reads', () => {
  const { api, calls } = load();
  const cases = [
    ['start', [OPTIONS], 'start', [OPTIONS]],
    ['start', [{ ...OPTIONS, allowCrash: true }], 'start', [{ ...OPTIONS, allowCrash: true }]],
    ['setUser', [{ id: '42', email: 'a@b.c' }], 'setUser', [{ id: '42', email: 'a@b.c' }]],
    ['setUser', [null], 'setUser', [null]],
    ['setTags', [{ 'farm.region': 'IE', gone: null }], 'setTags', [{ 'farm.region': 'IE', gone: null }]],
    ['setContext', ['farm', { animals: 3 }], 'setContext', ['farm', { animals: 3 }]],
    ['setContext', ['farm', null], 'setContext', ['farm', null]],
    ['captureMessage', ['boom', 'error'], 'captureMessage', ['boom', 'error']],
    ['captureMessage', ['hello'], 'captureMessage', ['hello', 'info']],
    ['crash', [], 'crash', []],
  ];
  for (const [method, args, action, sent] of cases) {
    calls.length = 0;
    api[method](...args);
    assert.equal(calls.length, 1, `${method} sends one call`);
    assert.equal(calls[0].service, 'SentrySdk', `${method} service`);
    assert.equal(calls[0].action, action, `${method} action`);
    assert.deepEqual(calls[0].args, sent, `${method} arguments`);
  }
});

test('the promise resolves with what native answers, and rejects with what native refuses', async () => {
  const { api, calls } = load();
  const started = api.start(OPTIONS);
  calls[0].success('started');
  assert.equal(await started, 'started');

  const refused = api.start({ dsn: '' });
  calls[1].failure('start needs an options object with a dsn');
  await assert.rejects(refused, /needs an options object with a dsn/);
});

test('the module exports exactly the six calls the README documents', () => {
  const { api } = load();
  assert.deepEqual(Object.keys(api).sort(), ['captureMessage', 'crash', 'setContext', 'setTags', 'setUser', 'start']);
});

/**
 * What a call comes to: the reason it was refused with, or 'sent' when it went to native, where the recorder never answers. A call that
 * should have been refused and was not therefore fails the test, and does not leave it waiting for a promise that never settles.
 */
const outcome = (attempt) =>
  Promise.race([attempt().then(() => 'answered', (reason) => reason), new Promise((resolve) => setImmediate(() => resolve('sent')))]);

test('a user is settled before it is sent: a number is its text, an empty value and null are left out, the rest is dropped', () => {
  const { api, calls } = load();
  const cases = [
    [{ id: 42 }, { id: '42' }],
    [{ id: '', email: null, username: undefined }, {}],
    [{ id: '1', email: 'a@b.c', username: 'u', ip_address: '10.0.0.1' }, { id: '1', email: 'a@b.c', username: 'u' }],
  ];
  for (const [given, sent] of cases) {
    calls.length = 0;
    api.setUser(given);
    assert.deepEqual(calls[0].args, [sent], JSON.stringify(given));
  }
});

test('what native would read differently on the two platforms is refused before it is sent, as a string that names the call', async () => {
  const { api, calls } = load();
  const refused = [
    ...['42', [], 7, { id: {} }, { id: [] }, { email: true }, { id: Number.NaN }, { username: Number.POSITIVE_INFINITY }].map((user) =>
      ['setUser', () => api.setUser(user)],
    ),
    ...[null, [], 'x', 7, { a: {} }, { a: [1] }, { a: Number.NaN }, { a: undefined }].map((tags) => ['setTags', () => api.setTags(tags)]),
    ...[['', {}], [7, {}], ['k', []], ['k', 'x'], ['k', 7], ['k', undefined]].map(([key, value]) => ['setContext', () => api.setContext(key, value)]),
    ...[[''], [7], ['x', 'loud'], ['x', 'INFO'], ['x', 3]].map(([message, level]) => ['captureMessage', () => api.captureMessage(message, level)]),
  ];
  for (const [call, attempt] of refused) {
    const reason = await outcome(attempt);
    assert.ok(typeof reason === 'string' && reason !== 'sent' && reason.includes(call), `${call} was not refused with a reason: ${reason}`);
  }
  assert.equal(calls.length, 0, 'nothing reached native');
});

test('what is fine goes through unchanged, null included', () => {
  const { api, calls } = load();
  api.setUser(null);
  api.setTags({ a: 'x', b: 7, c: true, d: false, e: null });
  api.setContext('farm', { animals: 3, nested: { list: [1, 'two', null] } });
  api.setContext('farm', null);
  assert.deepEqual(
    calls.map((call) => [call.action, call.args]),
    [
      ['setUser', [null]],
      ['setTags', [{ a: 'x', b: 7, c: true, d: false, e: null }]],
      ['setContext', ['farm', { animals: 3, nested: { list: [1, 'two', null] } }]],
      ['setContext', ['farm', null]],
    ],
  );
});
