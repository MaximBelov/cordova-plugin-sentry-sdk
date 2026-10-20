// recordPluginErrors, on Node: a `cordova` with a recorder as `exec` and a `callbackFromNative` that stands in for cordova.js's, which
// hands a result to the callback. What has to hold: a failed result becomes one breadcrumb on native and one on the bound scope, the
// bridge delivers every result as it did, and nothing the recording does reaches the page.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const wrapper = fileURLToPath(new URL('../../www/SentrySdk.js', import.meta.url));
const scopeSync = fileURLToPath(new URL('../../www/scope-sync.js', import.meta.url));
const SHARED = Symbol.for('cordova-plugin-sentry-sdk.pluginErrors');

/** A fresh plugin: `delivered` is what the original callbackFromNative was given, `calls` what native was sent. */
function load({ bridge = true, throws = false } = {}) {
  delete globalThis[SHARED];
  const calls = [];
  const delivered = [];
  globalThis.cordova = {
    exec: (success, failure, service, action, args) => calls.push({ success, failure, service, action, args }),
  };
  if (bridge) {
    globalThis.cordova.callbackFromNative = function (callbackId, isSuccess, status, args, keepCallback) {
      delivered.push({ self: this, args: [callbackId, isSuccess, status, args, keepCallback] });
      if (throws) {
        throw new TypeError('the callback failed');
      }
      return 'delivered';
    };
  }
  delete require.cache[wrapper];
  delete require.cache[scopeSync];
  return { api: require(wrapper), bindScope: require(scopeSync).bindScope, calls, delivered };
}

const crumbsTo = (calls) => calls.filter((c) => c.action === 'addBreadcrumb').map((c) => c.args[0]);

/** Starts with the given options and answers it, the way native does. */
async function started(api, calls, options) {
  const answer = api.start({ dsn: 'https://key@example.invalid/1', ...options });
  calls.find((c) => c.action === 'start' && !c.answered).success('started');
  calls.forEach((c) => (c.answered = true));
  await answer;
}

const fail = (callbackId, payload, status = 9) => globalThis.cordova.callbackFromNative(callbackId, false, status, payload === undefined ? [] : [payload], false);

test('a failed result is a breadcrumb on native, of the documented shape, and the result is still delivered as it was', async () => {
  const { api, calls, delivered } = load();
  await started(api, calls, { recordPluginErrors: true });
  const before = Date.now() / 1000;
  const answer = fail('Camera1234', 'No camera available');
  assert.equal(answer, 'delivered', 'the original answer is returned');
  assert.equal(delivered.length, 1);
  assert.equal(delivered[0].self, globalThis.cordova, 'called on the same this');
  assert.deepEqual(delivered[0].args, ['Camera1234', false, 9, ['No camera available'], false]);
  const [crumb] = crumbsTo(calls);
  assert.ok(crumb.timestamp >= before && crumb.timestamp <= Date.now() / 1000 + 1, 'the time of the failure, in seconds');
  delete crumb.timestamp;
  assert.deepEqual(crumb, {
    category: 'cordova.plugin',
    level: 'error',
    message: 'Camera answered with an error',
    data: { service: 'Camera', status: 9, error: 'No camera available' },
  });
  assert.equal(calls.find((c) => c.action === 'addBreadcrumb').service, 'SentrySdk');
});

test('a successful result is not recorded, and is delivered untouched', async () => {
  const { api, calls, delivered } = load();
  await started(api, calls, { recordPluginErrors: true });
  const payload = { secret: 'x' };
  globalThis.cordova.callbackFromNative('File7', true, 1, [payload], true);
  assert.equal(crumbsTo(calls).length, 0);
  assert.deepEqual(delivered[0].args, ['File7', true, 1, [payload], true]);
  assert.equal(delivered[0].args[3][0], payload, 'the same objects');
});

test('the error is text cut to 200 characters: an object is its JSON, one JSON cannot carry is what it prints as, no payload is none', async () => {
  const { api, calls } = load();
  await started(api, calls, { recordPluginErrors: true });
  fail('Geo1', 'x'.repeat(500));
  fail('Geo2', { code: 1, message: 'denied' });
  fail('Geo3', 12n);
  fail('Geo4');
  fail('Geo5', Object.create(null));
  const errors = crumbsTo(calls).map((c) => c.data);
  assert.equal(errors[0].error, 'x'.repeat(200));
  assert.equal(errors[1].error, '{"code":1,"message":"denied"}');
  assert.equal(errors[2].error, '12');
  assert.deepEqual(errors[3], { service: 'Geo', status: 9 }, 'no error field without a payload');
  assert.equal(errors[4].error, '{}');
});

test('only the first argument of the answer is read, never more', async () => {
  const { api, calls } = load();
  await started(api, calls, { recordPluginErrors: true });
  globalThis.cordova.callbackFromNative('Http3', false, 9, ['refused', { body: 'token=abc' }], false);
  assert.equal(JSON.stringify(crumbsTo(calls)).includes('token'), false);
});

test("the plugin's own service is not recorded", async () => {
  const { api, calls } = load();
  await started(api, calls, { recordPluginErrors: true });
  fail('SentrySdk12', 'captureMessage needs a running SDK');
  assert.equal(crumbsTo(calls).length, 0);
});

test('a recording that throws is swallowed, and the result is still delivered', async () => {
  const { api, calls, delivered } = load();
  await started(api, calls, { recordPluginErrors: true });
  globalThis.cordova.exec = () => {
    throw new Error('bridge gone');
  };
  const unprintable = { toJSON: () => { throw new Error('no'); }, toString: () => { throw new Error('no'); } };
  assert.equal(fail('Camera1', 'x'), 'delivered');
  assert.equal(fail('Camera2', unprintable), 'delivered');
  assert.equal(globalThis.cordova.callbackFromNative('Camera3', false, 9, null, false), 'delivered', 'args that are not an array');
  assert.equal(delivered.length, 3);
});

test('an exception thrown by the callback itself still reaches the page, after the breadcrumb is recorded', async () => {
  const { api, calls, delivered } = load({ throws: true });
  await started(api, calls, { recordPluginErrors: true });
  assert.throws(() => fail('Camera1', 'denied'), /the callback failed/);
  assert.equal(delivered.length, 1);
  assert.equal(crumbsTo(calls).length, 1);
});

test('the bridge is wrapped once, however many times the module loads', () => {
  const { delivered } = load();
  const once = globalThis.cordova.callbackFromNative;
  delete require.cache[wrapper];
  require(wrapper);
  assert.equal(globalThis.cordova.callbackFromNative, once, 'a second load leaves the wrapper alone');
  fail('Camera1', 'x');
  assert.equal(delivered.length, 1, 'the original runs once per result');
});

test('no bridge to wrap, as in a page without cordova.js or an older one, is no error', () => {
  assert.doesNotThrow(() => load({ bridge: false }));
  delete globalThis.cordova;
  delete require.cache[wrapper];
  assert.doesNotThrow(() => require(wrapper));
});

test('failures before start are kept and recorded by a start with the option, in order, the last hundred', async () => {
  const { api, calls } = load();
  for (let i = 0; i < 105; i++) {
    fail(`Plugin${i}`, `error ${i}`);
  }
  assert.equal(crumbsTo(calls).length, 0, 'nothing is sent before start');
  await started(api, calls, { recordPluginErrors: true });
  const errors = crumbsTo(calls).map((c) => c.data.error);
  assert.equal(errors.length, 100);
  assert.equal(errors[0], 'error 5');
  assert.equal(errors[99], 'error 104');
  assert.ok(calls.findIndex((c) => c.action === 'start') < calls.findIndex((c) => c.action === 'addBreadcrumb'), 'after start');
});

test('a start without the option drops what was kept and records nothing after it', async () => {
  const { api, calls, delivered } = load();
  fail('Camera1', 'before');
  await started(api, calls, {});
  fail('Camera2', 'after');
  assert.equal(crumbsTo(calls).length, 0);
  assert.equal(delivered.length, 2, 'the results are delivered all the same');
});

test('a start that native refuses decides nothing: the kept failures wait for the next one', async () => {
  const { api, calls } = load();
  fail('Camera1', 'before');
  const refused = api.start({ dsn: 'nonsense', recordPluginErrors: true });
  calls[0].failure('start was refused: the dsn');
  await assert.rejects(refused);
  assert.equal(crumbsTo(calls).length, 0);
  calls[0].answered = true;
  await started(api, calls, { recordPluginErrors: true });
  assert.equal(crumbsTo(calls).length, 1);
});

test('recordPluginErrors that is not a boolean is refused, as the other options are', async () => {
  const { api, calls } = load();
  await assert.rejects(api.start({ dsn: 'x', recordPluginErrors: 'yes' }), (reason) => reason === 'start: recordPluginErrors has to be true or false');
  assert.equal(calls.length, 0);
});

/** A scope shaped like @sentry/core's, enough for breadcrumbs. */
class FakeScope {
  breadcrumbs = [];
  addBreadcrumb(crumb, max = 100) {
    this.breadcrumbs = [...this.breadcrumbs, { timestamp: 1, ...crumb }].slice(-max);
    return this;
  }
  getLastBreadcrumb() {
    return this.breadcrumbs[this.breadcrumbs.length - 1];
  }
}

test('the crumb reaches the first bound scope once, and native once: the scope sync does not send it back', async () => {
  const { api, bindScope, calls } = load();
  const global = new FakeScope();
  const isolation = new FakeScope();
  const sdk = { addBreadcrumb: (crumb) => calls.push({ action: 'addBreadcrumb', args: [crumb], viaScope: true }) };
  bindScope(global, { sdk });
  bindScope(isolation, { sdk });
  await started(api, calls, { recordPluginErrors: true });
  fail('Camera1', 'denied');
  assert.equal(crumbsTo(calls).length, 1, 'one copy to native');
  assert.equal(calls.some((c) => c.viaScope), false, 'none through the scope sync');
  assert.equal(global.breadcrumbs.length, 1);
  assert.equal(global.breadcrumbs[0].message, 'Camera answered with an error');
  assert.equal(global.breadcrumbs[0].timestamp, crumbsTo(calls)[0].timestamp, 'the time of the failure, not of the scope');
  assert.equal(isolation.breadcrumbs.length, 0, 'one scope only');

  global.addBreadcrumb({ message: 'the page\'s own' });
  assert.equal(calls.filter((c) => c.viaScope).length, 1, 'the page\'s own crumbs are still forwarded');
});

test('crumbs recorded before any scope is bound reach the scope when it is bound; unbinding hands over to the next', async () => {
  const { api, bindScope, calls } = load();
  fail('Camera1', 'before start');
  await started(api, calls, { recordPluginErrors: true });
  fail('Camera2', 'before bind');
  const first = new FakeScope();
  const second = new FakeScope();
  const sdk = { addBreadcrumb: () => assert.fail('nothing goes back to native') };
  const unbind = bindScope(first, { sdk });
  bindScope(second, { sdk });
  assert.deepEqual(first.breadcrumbs.map((c) => c.data.error), ['before start', 'before bind']);
  unbind();
  fail('Camera3', 'after unbind');
  assert.equal(first.breadcrumbs.length, 2);
  assert.deepEqual(second.breadcrumbs.map((c) => c.data.error), ['after unbind']);
  assert.equal(crumbsTo(calls).length, 3);
});

test('a scope that throws on the crumb does not break the bridge', async () => {
  const { api, bindScope, calls, delivered } = load();
  const scope = new FakeScope();
  bindScope(scope, { sdk: {} });
  scope.addBreadcrumb = () => {
    throw new Error('scope broken');
  };
  await started(api, calls, { recordPluginErrors: true });
  assert.equal(fail('Camera1', 'x'), 'delivered');
  assert.equal(delivered.length, 1);
  assert.equal(crumbsTo(calls).length, 1, 'native still has it');
});
