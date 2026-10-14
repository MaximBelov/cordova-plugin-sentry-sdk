// The same API on two platforms, written down once: the actions the JavaScript sends, the methods the Swift plugin has, the actions
// the Kotlin plugin dispatches, and the README that documents them have to agree. Adding a call to one side without the others, or
// without its documentation, fails here before anything slower runs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const read = (path) => readFileSync(join(root, path), 'utf8');

const js = read('www/sentryNative.js');
/** JavaScript export name -> the native action it sends. */
const actionOf = Object.fromEntries(
  [...js.matchAll(/^const (\w+) = \([^)]*\) => call\('(\w+)'/gm)].map((match) => [match[1], match[2]]),
);
const methods = Object.keys(actionOf);

const iosActions = new Set([...read('src/ios/SentryNative.swift').matchAll(/^\s*@objc\((\w+):\)/gm)].map((m) => m[1]));
const androidActions = new Set([...read('src/android/SentryNative.kt').matchAll(/^\s*"(\w+)" -> /gm)].map((m) => m[1]));

test('the JavaScript sends an action per export, and both platforms handle exactly those', () => {
  assert.ok(methods.length >= 5, 'the exports were found');
  const actions = methods.map((name) => actionOf[name]).sort();
  assert.deepEqual([...iosActions].sort(), actions, 'iOS handles every action and nothing else');
  assert.deepEqual([...androidActions].sort(), actions, 'Android handles every action and nothing else');
});

const readme = read('README.md');

test('the README has a section and an index entry for every call, and every index link finds its section', () => {
  const sections = [...readme.matchAll(/^## (\w+)\s*$/gm)].map((m) => m[1]);
  const index = [...readme.matchAll(/^- \[SentryNative\.(\w+)\]\(#(\w+)\)/gm)].map((m) => [m[1], m[2]]);
  assert.deepEqual(methods.filter((name) => !sections.includes(name)), [], 'a section for every call');
  assert.deepEqual(methods.filter((name) => !index.some(([indexed]) => indexed === name)), [], 'an index entry for every call');
  assert.deepEqual(index.filter(([, anchor]) => !sections.includes(anchor)), [], 'every index link finds its section');
});

test('plugin.xml, package.json and the Swift package agree on the plugin id and version', () => {
  const pkg = JSON.parse(read('package.json'));
  const xml = read('plugin.xml');
  assert.match(xml, new RegExp(`<plugin[^>]*\\sid="${pkg.name}"[^>]*\\sversion="${pkg.version}"`), 'plugin.xml id and version');
  assert.equal(pkg.cordova.id, pkg.name, 'cordova.id');
  assert.match(read('Package.swift'), new RegExp(`name: "${pkg.name}"`), 'Package.swift product');
  assert.ok(pkg.files.includes('Package.swift'), 'Package.swift ships, or the iOS side cannot be installed');
});

test('test/android compiles with the Kotlin the plugin asks an app for', () => {
  const asked = /GradlePluginKotlinVersion" value="([\d.]+)"/.exec(read('plugin.xml'))?.[1];
  const tested = /org\.jetbrains\.kotlin\.android' version '([\d.]+)'/.exec(read('test/android/build.gradle'))?.[1];
  assert.ok(asked, 'plugin.xml names a Kotlin version');
  assert.equal(tested, asked, 'Kotlin: test/android against plugin.xml');
});

test('the test projects pin the SDK versions the plugin installs', () => {
  const cocoa = (path) => /sentryCocoaVersion: Version = "([\d.]+)"/.exec(read(path))?.[1];
  assert.equal(cocoa('test/ios/Package.swift'), cocoa('Package.swift'), 'sentry-cocoa: test/ios against the plugin');
  const android = /SENTRY_ANDROID_SDK_VERSION" default="([\d.]+)"/.exec(read('plugin.xml'))?.[1];
  const gradle = /io\.sentry:sentry-android:([\d.]+)/.exec(read('test/android/plugin/build.gradle'))?.[1];
  assert.equal(gradle, android, 'sentry-android: test/android against plugin.xml');
  const pkg = JSON.parse(read('package.json'));
  const framework = /org\.apache\.cordova:framework:([\d.]+)/.exec(read('test/android/plugin/build.gradle'))?.[1];
  assert.equal(`^${framework}`, pkg.devDependencies['cordova-android'], 'cordova-android: test/android against the dev dependency');
});
