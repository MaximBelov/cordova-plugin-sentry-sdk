// tests/ is what cordova-paramedic runs on a phone (cordova-plugin-test-framework, Jasmine). A phone is slow and not always at hand,
// so the same `defineAutoTests` also runs here, on Node, against the real JavaScript of the plugin and a native that answers the way
// both platforms do: a test that is wrong, or a plugin that drifted away from it, fails here first.
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const require = createRequire(import.meta.url);
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

test('tests/plugin.xml is the plugin id with "-tests", and loads tests.js', () => {
  const xml = readFileSync(join(root, 'tests', 'plugin.xml'), 'utf8');
  assert.match(xml, new RegExp(`<plugin[^>]*\\sid="${pkg.cordova.id}-tests"`));
  assert.match(xml, /<js-module src="tests\.js" name="tests"/);
  assert.ok(existsSync(join(root, 'tests', 'tests.js')));
});

test('tests/package.json names the same id, and tests/ is not published', () => {
  const testsPkg = JSON.parse(readFileSync(join(root, 'tests', 'package.json'), 'utf8'));
  assert.equal(testsPkg.name, `${pkg.cordova.id}-tests`);
  assert.equal(testsPkg.cordova.id, `${pkg.cordova.id}-tests`);
  assert.ok(!pkg.files.includes('tests'), 'package.json "files" must leave tests/ out');
});

/**
 * What native answers per action, as both platforms do: `started` flips after the first start, a scope call before it is kept
 * ("queued"), and a crash goes ahead only when the last accepted start allowed it.
 */
function fakeNative() {
  let started = false;
  let crashAllowed = false;
  return (success, failure, service, action, args) => {
    assert.equal(service, 'SentrySdk');
    const answer = {
      start: () => {
        if (!args[0] || !args[0].dsn) return failure('start needs an options object with a dsn');
        if (started) {
          crashAllowed = args[0].allowCrash === true;
          return success('already started');
        }
        if (!/^https?:\/\/\w+@[^/]+\/\d+$/.test(args[0].dsn)) return failure('start was refused: the dsn does not parse');
        started = true;
        crashAllowed = args[0].allowCrash === true;
        success('started');
      },
      setUser: () => success(!started ? 'queued' : args[0] === null ? 'cleared' : 'set'),
      setTags: () => (args[0] && typeof args[0] === 'object' ? success(started ? 'set' : 'queued') : failure('setTags needs an object')),
      setContext: () => (args[0] ? success(started ? 'set' : 'queued') : failure('setContext needs a key')),
      crash: () => (crashAllowed ? undefined : failure('crash is refused: it is for a device test, and start has to be given allowCrash: true')),
    }[action];
    if (!answer) return failure(`unknown action ${action}`);
    setTimeout(answer, 0);
  };
}

/** A Jasmine 2 just large enough for tests/tests.js, run on Node's test runner. */
async function runJasmineLike(define) {
  const suites = [];
  const stack = [];
  const api = {
    describe(name, fn) {
      const suite = { name, specs: [] };
      suites.push(suite);
      stack.push(suite);
      fn();
      stack.pop();
    },
    it(name, fn) {
      stack[stack.length - 1].specs.push({ name, fn });
    },
    expect(actual) {
      return {
        toBeDefined: () => assert.notEqual(actual, undefined),
        toBe: (expected) => assert.equal(actual, expected),
        toContain: (item) => assert.ok(actual.includes(item), `${JSON.stringify(actual)} contains ${JSON.stringify(item)}`),
        toMatch: (re) => assert.match(String(actual), re),
      };
    },
    fail: (message) => {
      throw new Error(message);
    },
    pending: () => {},
  };
  const run = (spec) =>
    new Promise((resolve, reject) => {
      const done = () => resolve();
      done.fail = (e) => reject(new Error(String(e)));
      try {
        const result = spec.fn(done);
        if (spec.fn.length === 0) resolve(result);
      } catch (e) {
        reject(e);
      }
    });
  Object.assign(globalThis, api);
  define();
  for (const suite of suites) {
    for (const spec of suite.specs) {
      await test(`${suite.name} > ${spec.name}`, () => run(spec));
    }
  }
}

globalThis.cordova = { exec: fakeNative(), platformId: 'ios' };
const wrapper = join(root, 'www', 'SentrySdk.js');
delete require.cache[wrapper];
globalThis.window = { SentrySdk: require(wrapper) };
const { defineAutoTests, defineManualTests } = require(join(root, 'tests', 'tests.js'));
await runJasmineLike(defineAutoTests);

test('the manual tests exist, for the crash a person has to watch', () => {
  assert.equal(typeof defineManualTests, 'function');
});
