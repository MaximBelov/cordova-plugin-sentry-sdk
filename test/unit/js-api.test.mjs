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
    ['addBreadcrumb', [{ category: 'ui.click', message: 'save', level: 'info', data: { id: 1 } }], 'addBreadcrumb', [{ category: 'ui.click', message: 'save', level: 'info', data: { id: 1 } }]],
    ['clearBreadcrumbs', [], 'clearBreadcrumbs', []],
    ['setExtras', [{ a: 'x', b: null }], 'setExtras', [{ a: 'x', b: null }]],
    ['close', [], 'close', []],
    ['isEnabled', [], 'isEnabled', []],
    ['getDeviceInfo', [], 'getDeviceInfo', []],
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

test('the module exports exactly the calls the README documents', () => {
  const { api } = load();
  assert.deepEqual(Object.keys(api).sort(), ['addBreadcrumb', 'clearBreadcrumbs', 'close', 'crash', 'getDeviceInfo', 'isEnabled', 'setContext', 'setExtras', 'setTags', 'setUser', 'start']);
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
  ];
  for (const [call, attempt] of refused) {
    const reason = await outcome(attempt);
    assert.ok(typeof reason === 'string' && reason !== 'sent' && reason.includes(call), `${call} was not refused with a reason: ${reason}`);
  }
  assert.equal(calls.length, 0, 'nothing reached native');
});

test('a breadcrumb is settled before it is sent: the JavaScript levels are native ones, what is not read is dropped, empty fields are left out', () => {
  const { api, calls } = load();
  const cases = [
    [{ level: 'log', message: 'm' }, { level: 'debug', message: 'm' }],
    [{ level: 'critical' }, { level: 'fatal' }],
    ...['fatal', 'error', 'warning', 'info', 'debug'].map((level) => [{ level }, { level }]),
    [{ event_id: 'x', type: 'http', category: 'fetch', message: 'm', timestamp: 1_760_000_000.5 }, { type: 'http', category: 'fetch', message: 'm', timestamp: 1_760_000_000.5 }],
    [{ type: null, category: undefined, message: 'm', level: null, timestamp: null, data: null }, { message: 'm' }],
    [{ data: { a: 1, nested: { list: [1, 'two', null], when: new Date(0) }, gone: undefined } }, { data: { a: 1, nested: { list: [1, 'two', null], when: '1970-01-01T00:00:00.000Z' } } }],
    [{}, {}],
  ];
  for (const [given, sent] of cases) {
    calls.length = 0;
    api.addBreadcrumb(given);
    assert.deepEqual(calls[0].args, [sent], JSON.stringify(given));
  }
});

test('a breadcrumb native could not read the same on both platforms is refused with the reason, and nothing is sent', async () => {
  const { api, calls } = load();
  const cycle = {};
  cycle.self = cycle;
  const refused = [
    ...[null, undefined, 'x', 7, []].map((breadcrumb) => [breadcrumb, /needs an object/]),
    ...[{ message: 7 }, { category: {} }, { type: true }].map((breadcrumb) => [breadcrumb, /has to be a string/]),
    ...[{ level: 'loud' }, { level: 7 }, { level: 'toString' }].map((breadcrumb) => [breadcrumb, /level has to be one of/]),
    ...[{ timestamp: '1' }, { timestamp: Number.NaN }, { timestamp: Number.POSITIVE_INFINITY }].map((breadcrumb) => [breadcrumb, /timestamp has to be a number/]),
    ...[{ data: [] }, { data: 'x' }, { data: 7 }].map((breadcrumb) => [breadcrumb, /data has to be an object/]),
    ...[{ data: cycle }, { data: { big: 10n } }].map((breadcrumb) => [breadcrumb, /data cannot be sent as JSON/]),
  ];
  for (const [breadcrumb, reason] of refused) {
    const outcomeOf = await outcome(() => api.addBreadcrumb(breadcrumb));
    assert.ok(typeof outcomeOf === 'string' && outcomeOf !== 'sent' && outcomeOf.startsWith('addBreadcrumb') && reason.test(outcomeOf), `${String(breadcrumb)}: ${outcomeOf}`);
  }
  assert.equal(calls.length, 0, 'nothing reached native');
});

test('an extra is its text on both platforms: a string as it is, anything else as JSON, null and undefined as a removal', () => {
  const { api, calls } = load();
  api.setExtras({ text: 'plain', quoted: '"q"', count: 12, flag: false, list: [1, 'two'], nested: { a: { b: null } }, gone: null, missing: undefined, when: new Date(0) });
  assert.deepEqual(calls[0].args, [
    { text: 'plain', quoted: '"q"', count: '12', flag: 'false', list: '[1,"two"]', nested: '{"a":{"b":null}}', gone: null, missing: null, when: '"1970-01-01T00:00:00.000Z"' },
  ]);
});

test('extras that native could not read the same on both platforms are refused with the reason, and nothing is sent', async () => {
  const { api, calls } = load();
  const cycle = {};
  cycle.self = cycle;
  const refused = [
    ...[null, undefined, 'x', 7, []].map((extras) => [extras, /setExtras needs an object/]),
    ...[{ a: cycle }, { a: 10n }, { a: () => 1 }, { a: Symbol('s') }].map((extras) => [extras, /the value of a cannot be sent as JSON/]),
  ];
  for (const [extras, reason] of refused) {
    const outcomeOf = await outcome(() => api.setExtras(extras));
    assert.ok(typeof outcomeOf === 'string' && outcomeOf !== 'sent' && outcomeOf.startsWith('setExtras') && reason.test(outcomeOf), `${String(extras)}: ${outcomeOf}`);
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

const FULL_START = {
  ...OPTIONS,
  debug: true,
  enableNativeCrashHandling: false,
  enableWatchdogTerminationTracking: false,
  sendDefaultPii: true,
  maxBreadcrumbs: 0,
  sampleRate: 0.25,
  attachStacktrace: false,
  attachThreads: true,
  sessionTrackingIntervalMillis: 60000,
  enableNdkScopeSync: false,
};

test('the start options go to native as they are, the ones a platform would read differently excepted', () => {
  const { api, calls } = load();
  api.start(FULL_START);
  api.start({ ...OPTIONS, sampleRate: 1 });
  api.start({ ...OPTIONS, sampleRate: 0, maxBreadcrumbs: 100 });
  assert.deepEqual(
    calls.map((call) => call.args),
    [[FULL_START], [{ ...OPTIONS, sampleRate: 1 }], [{ ...OPTIONS, sampleRate: 0, maxBreadcrumbs: 100 }]],
  );
});

test('options that are not an object are not this wrapper\'s to refuse: native does, with its own reason', () => {
  const { api, calls } = load();
  for (const given of [undefined, null, [], 'dsn']) {
    api.start(given);
  }
  assert.deepEqual(
    calls.map((call) => call.args),
    [[undefined], [null], [[]], ['dsn']],
  );
});

test('a start option of the wrong type is refused before it is sent, with a reason that names the option', async () => {
  const { api, calls } = load();
  const wrong = [
    ...['debug', 'enableNativeCrashHandling', 'enableWatchdogTerminationTracking', 'sendDefaultPii', 'attachStacktrace', 'attachThreads', 'enableNdkScopeSync'].flatMap(
      (name) => ['true', 1, 0, null, {}].map((value) => [name, value]),
    ),
    ...['maxBreadcrumbs', 'sessionTrackingIntervalMillis'].flatMap((name) => ['5', -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, null, true].map((value) => [name, value])),
    ...['0.5', -0.1, 1.1, 2, Number.NaN, Number.POSITIVE_INFINITY, null, true].map((value) => ['sampleRate', value]),
  ];
  for (const [name, value] of wrong) {
    const reason = await outcome(() => api.start({ ...OPTIONS, [name]: value }));
    assert.ok(typeof reason === 'string' && reason !== 'sent' && reason.includes(`start: ${name}`), `${name}: ${String(value)} was not refused with its name: ${reason}`);
  }
  assert.equal(calls.length, 0, 'nothing reached native');
});

test('an option that is not given is not sent, so native keeps the SDK default', () => {
  const { api, calls } = load();
  api.start(OPTIONS);
  for (const name of Object.keys(FULL_START)) {
    if (name in OPTIONS) continue;
    assert.ok(!(name in calls[0].args[0]), name);
  }
});
