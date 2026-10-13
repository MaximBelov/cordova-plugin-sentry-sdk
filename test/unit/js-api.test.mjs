// The JavaScript half of the plugin, run on Node with `cordova.exec` replaced by a recorder: every call has to reach native under the
// service, action and arguments native reads them by, and the promise has to follow the callbacks. Whether native answers is for
// tests/ (on a phone) and test/ios, test/android (the native code on its own).
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const wrapper = fileURLToPath(new URL('../../www/sentryNative.js', import.meta.url));

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

test('every method sends its action to the SentryNative service, with the arguments native reads', () => {
  const { api, calls } = load();
  const cases = [
    ['start', [OPTIONS], 'start', [OPTIONS]],
    ['setUser', [{ id: '42', email: 'a@b.c' }], 'setUser', [{ id: '42', email: 'a@b.c' }]],
    ['setUser', [null], 'setUser', [null]],
    ['setTags', [{ 'farm.region': 'IE', gone: null }], 'setTags', [{ 'farm.region': 'IE', gone: null }]],
    ['setContext', ['farm', { animals: 3 }], 'setContext', ['farm', { animals: 3 }]],
    ['setContext', ['farm', null], 'setContext', ['farm', null]],
    ['crash', [], 'crash', []],
  ];
  for (const [method, args, action, sent] of cases) {
    calls.length = 0;
    api[method](...args);
    assert.equal(calls.length, 1, `${method} sends one call`);
    assert.equal(calls[0].service, 'SentryNative', `${method} service`);
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

test('the module exports exactly the five calls the README documents', () => {
  const { api } = load();
  assert.deepEqual(Object.keys(api).sort(), ['crash', 'setContext', 'setTags', 'setUser', 'start']);
});
