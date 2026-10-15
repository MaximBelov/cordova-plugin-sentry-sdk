// The scope helper, on Node, with a scope shaped like @sentry/core's (methods on the prototype, a list of breadcrumbs with a limit, chained
// answers) and a plugin that records what it is sent. What has to hold: the scope behaves as it did, and each setter reaches the plugin with
// what the plugin takes.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { bindScope } = require(fileURLToPath(new URL('../../www/scope-sync.js', import.meta.url)));

/** A scope the way @sentry/core has it: the methods live on the prototype, a setter answers the scope, a breadcrumb gets a timestamp. */
class FakeScope {
  user = null;
  tags = {};
  extras = {};
  contexts = {};
  breadcrumbs = [];
  setUser(user) {
    this.user = user;
    return this;
  }
  setTag(key, value) {
    this.tags[key] = value;
    return this;
  }
  setTags(tags) {
    Object.assign(this.tags, tags);
    return this;
  }
  setExtra(key, value) {
    this.extras[key] = value;
    return this;
  }
  setExtras(extras) {
    Object.assign(this.extras, extras);
    return this;
  }
  setContext(key, context) {
    if (context === null) delete this.contexts[key];
    else this.contexts[key] = context;
    return this;
  }
  addBreadcrumb(crumb, max = 100) {
    if (max <= 0) return this;
    this.breadcrumbs = [...this.breadcrumbs, { timestamp: 1700000000.5, ...crumb }].slice(-max);
    return this;
  }
  clearBreadcrumbs() {
    this.breadcrumbs = [];
    return this;
  }
  getLastBreadcrumb() {
    return this.breadcrumbs[this.breadcrumbs.length - 1];
  }
}

/** A plugin that records every call, and answers like the real one: a promise. */
function fakeSdk() {
  const calls = [];
  const sdk = {};
  for (const name of ['setUser', 'setTags', 'setExtras', 'setContext', 'addBreadcrumb', 'clearBreadcrumbs']) {
    sdk[name] = (...args) => {
      calls.push([name, ...args]);
      return Promise.resolve('set');
    };
  }
  return { sdk, calls };
}

const bound = (options = {}) => {
  const scope = new FakeScope();
  const { sdk, calls } = fakeSdk();
  const unbind = bindScope(scope, { sdk, ...options });
  return { scope, calls, unbind, sdk };
};

test('setUser is forwarded, null clears, and the scope keeps its own answer and state', () => {
  const { scope, calls } = bound();
  assert.equal(scope.setUser({ id: '1', email: 'a@b.c' }), scope, 'the answer is the scope\'s');
  scope.setUser(null);
  scope.setUser(undefined);
  assert.deepEqual(calls, [['setUser', { id: '1', email: 'a@b.c' }], ['setUser', null], ['setUser', null]]);
  assert.equal(scope.user, undefined, 'the scope took what it was given');
});

test('setTag and setTags go as one setTags, with a value the plugin takes: null and undefined remove, the odd ones are their text', () => {
  const { scope, calls } = bound();
  scope.setTag('a', 'x');
  scope.setTag('n', 7);
  scope.setTag('b', true);
  scope.setTag('gone', undefined);
  scope.setTag('nan', Number.NaN);
  scope.setTag('big', 12n);
  scope.setTag('unprintable', Object.create(null));
  scope.setTags({ p: 1, q: 'z', r: null });
  assert.deepEqual(calls, [
    ['setTags', { a: 'x' }],
    ['setTags', { n: 7 }],
    ['setTags', { b: true }],
    ['setTags', { gone: null }],
    ['setTags', { nan: 'NaN' }],
    ['setTags', { big: '12' }],
    ['setTags', { unprintable: null }],
    ['setTags', { p: 1, q: 'z', r: null }],
  ]);
  assert.equal(scope.tags.n, 7);
  assert.equal(scope.tags.big, 12n);
  assert.equal(scope.tags.q, 'z');
});

test('setExtra and setExtras go as setExtras, and an extra that cannot be JSON is left out and reported, not sent', () => {
  const errors = [];
  const { scope, calls } = bound({ onError: (error, method) => errors.push([method, String(error.message)]) });
  const cycle = {};
  cycle.self = cycle;
  scope.setExtra('a', { n: 1 });
  scope.setExtra('cycle', cycle);
  scope.setExtras({ b: 'x', big: 12n, fn: () => 1, gone: undefined, none: null });
  assert.deepEqual(calls, [
    ['setExtras', { a: { n: 1 } }],
    ['setExtras', {}],
    ['setExtras', { b: 'x', gone: undefined, none: null }],
  ]);
  assert.deepEqual(errors, [
    ['setExtras', 'the extra cycle cannot be sent as JSON'],
    ['setExtras', 'the extra big cannot be sent as JSON'],
    ['setExtras', 'the extra fn cannot be sent as JSON'],
  ]);
  assert.equal(scope.extras.cycle, cycle, 'the scope still has it');
});

test('setContext is forwarded as plain JSON, and null or undefined remove it', () => {
  const errors = [];
  const { scope, calls } = bound({ onError: (error, method) => errors.push([method, error.message]) });
  scope.setContext('farm', { animals: 3, when: new Date(0), nested: { list: [1, undefined] } });
  scope.setContext('farm', null);
  scope.setContext('farm', undefined);
  const cycle = {};
  cycle.self = cycle;
  scope.setContext('bad', cycle);
  assert.deepEqual(calls, [
    ['setContext', 'farm', { animals: 3, when: '1970-01-01T00:00:00.000Z', nested: { list: [1, null] } }],
    ['setContext', 'farm', null],
    ['setContext', 'farm', null],
  ]);
  assert.deepEqual(errors, [['setContext', 'the context bad cannot be sent as JSON']]);
});

test('a breadcrumb is sent as the scope completed it, with the fields the plugin takes and data as plain JSON', () => {
  const { scope, calls } = bound();
  scope.addBreadcrumb({ category: 'ui.click', message: 'tap', level: 'info', type: 'user', data: { a: 1, drop: undefined }, event_id: 'x', extra: 1 });
  assert.deepEqual(calls, [
    ['addBreadcrumb', { type: 'user', category: 'ui.click', message: 'tap', level: 'info', timestamp: 1700000000.5, data: { a: 1 } }],
  ]);
  assert.equal(scope.breadcrumbs.length, 1);
});

test('a breadcrumb the scope did not take (a limit of 0) is not sent, and one with data that cannot be JSON is sent without it', () => {
  const { scope, calls } = bound();
  scope.addBreadcrumb({ message: 'taken' });
  calls.length = 0;
  scope.addBreadcrumb({ message: 'refused by the limit' }, 0);
  assert.deepEqual(calls, [], 'the crumb the scope still ends with is not sent again');
  const cycle = {};
  cycle.self = cycle;
  scope.addBreadcrumb({ message: 'kept', data: cycle, level: 5, category: 'c' });
  assert.deepEqual(calls, [['addBreadcrumb', { category: 'c', message: 'kept', timestamp: 1700000000.5 }]]);
});

test('a scope without getLastBreadcrumb sends the breadcrumb it was given', () => {
  const scope = new FakeScope();
  scope.getLastBreadcrumb = undefined;
  const { sdk, calls } = fakeSdk();
  bindScope(scope, { sdk });
  scope.addBreadcrumb({ message: 'm' });
  assert.deepEqual(calls, [['addBreadcrumb', { message: 'm' }]]);
  scope.addBreadcrumb('not a breadcrumb');
  assert.equal(calls.length, 1, 'something that is not a breadcrumb is not sent');
});

test('clearBreadcrumbs is forwarded and the scope is cleared', () => {
  const { scope, calls } = bound();
  scope.addBreadcrumb({ message: 'm' });
  calls.length = 0;
  assert.equal(scope.clearBreadcrumbs(), scope);
  assert.deepEqual(calls, [['clearBreadcrumbs']]);
  assert.deepEqual(scope.breadcrumbs, []);
});

test('a failure of the plugin never reaches the page: a rejection and a throw go to onError, with the call they came from', async () => {
  const errors = [];
  const scope = new FakeScope();
  const sdk = {
    setTags: () => Promise.reject('setTags: refused'),
    setUser: () => {
      throw new Error('bridge is down');
    },
  };
  bindScope(scope, { sdk, onError: (error, method) => errors.push([method, String(error)]) });
  assert.equal(scope.setTag('a', 'b'), scope);
  assert.equal(scope.setUser({ id: '1' }), scope);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(errors, [['setUser', 'Error: bridge is down'], ['setTags', 'setTags: refused']]);
  assert.deepEqual(scope.tags, { a: 'b' });
});

test('a handler of errors that throws is not one more failure, and no handler is fine too', async () => {
  const scope = new FakeScope();
  bindScope(scope, {
    sdk: { setTags: () => Promise.reject(new Error('no')), setUser: () => { throw new Error('no'); } },
    onError: () => {
      throw new Error('the handler is broken');
    },
  });
  scope.setTag('a', 'b');
  scope.setUser({});
  await new Promise((resolve) => setImmediate(resolve));
  const plain = new FakeScope();
  bindScope(plain, { sdk: { setUser: () => { throw new Error('no'); } } });
  plain.setUser({});
});

test('without a plugin nothing is sent and the scope works: the browser, and the time before deviceready', () => {
  delete globalThis.SentrySdk;
  const scope = new FakeScope();
  bindScope(scope);
  scope.setTag('a', 'b');
  scope.addBreadcrumb({ message: 'm' });
  assert.deepEqual(scope.tags, { a: 'b' });
  const { sdk, calls } = fakeSdk();
  globalThis.SentrySdk = sdk;
  try {
    scope.setTag('c', 'd');
    assert.deepEqual(calls, [['setTags', { c: 'd' }]], 'window.SentrySdk is looked up at the call, so what arrives later is used');
  } finally {
    delete globalThis.SentrySdk;
  }
});

test('a plugin without a call is not sent it, and a scope without a setter is left without it', () => {
  const scope = { setTag(key, value) { this[key] = value; return this; } };
  const calls = [];
  const errors = [];
  const onError = (error, method) => errors.push([method, String(error)]);
  const unbind = bindScope(scope, { sdk: { setTags: (tags) => calls.push(tags) }, onError });
  scope.setTag('a', 'b');
  assert.deepEqual(calls, [{ a: 'b' }]);
  assert.equal(scope.setUser, undefined);
  unbind();
  const lacking = new FakeScope();
  bindScope(lacking, { sdk: { setTags: () => 'x' }, onError });
  lacking.setUser({ id: '1' });
  lacking.addBreadcrumb({ message: 'm' });
  lacking.clearBreadcrumbs();
  assert.deepEqual(lacking.user, { id: '1' });
  assert.deepEqual(errors, [], 'a call the plugin does not have is skipped, not reported as a failure');
});

test('binding a scope twice does nothing the second time, and the function it returns takes the wrapping off', () => {
  const scope = new FakeScope();
  const { sdk, calls } = fakeSdk();
  const first = bindScope(scope, { sdk });
  const second = bindScope(scope, { sdk });
  assert.equal(first, second, 'the same unbind');
  scope.setTag('a', 'b');
  assert.equal(calls.length, 1, 'one forward, not two');
  first();
  assert.ok(!Object.prototype.hasOwnProperty.call(scope, 'setTag'), 'a method that came from the prototype is the prototype\'s again');
  scope.setTag('c', 'd');
  assert.equal(calls.length, 1, 'nothing is sent after');
  bindScope(scope, { sdk });
  scope.setTag('e', 'f');
  assert.equal(calls.length, 2, 'and it can be bound again');
});

test('unbinding puts back a method the scope had of its own, and leaves one that somebody else wrapped after', () => {
  const scope = new FakeScope();
  const own = function (key, value) {
    this.tags[key] = value;
    return this;
  };
  scope.setTag = own;
  const { sdk } = fakeSdk();
  const unbind = bindScope(scope, { sdk });
  assert.notEqual(scope.setTag, own);
  unbind();
  assert.equal(scope.setTag, own, 'its own method is back');

  const wrapped = new FakeScope();
  const undo = bindScope(wrapped, { sdk });
  const later = (key, value) => wrapped.tags && Object.getPrototypeOf(wrapped).setTag.call(wrapped, key, value);
  wrapped.setTag = later;
  undo();
  assert.equal(wrapped.setTag, later, 'the later wrapper is not undone');
});

test('bound to the plugin\'s own wrapper, every setter reaches native as an action it takes, and the wrapper refuses none of them', async () => {
  const sent = [];
  globalThis.cordova = { exec: (success, failure, service, action, args) => sent.push([action, args]) };
  const wrapper = fileURLToPath(new URL('../../www/SentrySdk.js', import.meta.url));
  delete require.cache[wrapper];
  const sdk = require(wrapper);
  const errors = [];
  const scope = new FakeScope();
  bindScope(scope, { sdk, onError: (error, method) => errors.push([method, error]) });
  try {
    scope.setUser({ id: '1', email: 'a@b.c' });
    scope.setTag('a', 'b');
    scope.setTags({ n: 1, gone: undefined });
    scope.setExtra('e', { x: 1 });
    scope.setExtras({ t: 'x', u: undefined });
    scope.setContext('farm', { animals: 3 });
    scope.setContext('farm', null);
    scope.addBreadcrumb({ message: 'm', level: 'log', category: 'c', data: { a: 1 } });
    scope.clearBreadcrumbs();
    await new Promise((resolve) => setImmediate(resolve));
  } finally {
    delete globalThis.cordova;
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(sent, [
    ['setUser', [{ id: '1', email: 'a@b.c' }]],
    ['setTags', [{ a: 'b' }]],
    ['setTags', [{ n: 1, gone: null }]],
    ['setExtras', [{ e: '{"x":1}' }]],
    ['setExtras', [{ t: 'x', u: null }]],
    ['setContext', ['farm', { animals: 3 }]],
    ['setContext', ['farm', null]],
    ['addBreadcrumb', [{ category: 'c', message: 'm', level: 'debug', timestamp: 1700000000.5, data: { a: 1 } }]],
    ['clearBreadcrumbs', []],
  ]);
});
