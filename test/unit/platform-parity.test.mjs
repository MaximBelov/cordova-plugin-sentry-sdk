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

const js = read('www/SentrySdk.js');
/** JavaScript export name -> the native action it sends. */
const actionOf = Object.fromEntries(
  [...js.matchAll(/^const (\w+) = (?:async )?\([^)]*\) => call\('(\w+)'/gm)].map((match) => [match[1], match[2]]),
);
const methods = Object.keys(actionOf);

const iosActions = new Set([...read('src/ios/SentrySdk.swift').matchAll(/^\s*@objc\((\w+):\)/gm)].map((m) => m[1]));
const androidActions = new Set([...read('src/android/SentrySdk.kt').matchAll(/^\s*"(\w+)" -> /gm)].map((m) => m[1]));

test('the JavaScript sends an action per export, and both platforms handle exactly those', () => {
  assert.ok(methods.length >= 5, 'the exports were found');
  const actions = methods.map((name) => actionOf[name]).sort();
  assert.deepEqual([...iosActions].sort(), actions, 'iOS handles every action and nothing else');
  assert.deepEqual([...androidActions].sort(), actions, 'Android handles every action and nothing else');
});

const readme = read('README.md');

test('the README has a section and an index entry for every call, and every index link finds its section', () => {
  const sections = [...readme.matchAll(/^## (\w+)\s*$/gm)].map((m) => m[1]);
  const index = [...readme.matchAll(/^- \[SentrySdk\.(\w+)\]\(#(\w+)\)/gm)].map((m) => [m[1], m[2]]);
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

test('plugin.xml turns Kotlin on for an app and leaves its version to the app and to cordova-android', () => {
  const xml = read('plugin.xml');
  assert.match(xml, /<preference name="GradlePluginKotlinEnabled" value="true"/, 'the Kotlin plugin is applied, or the .kt is never compiled');
  // A version set here would give an app that declares none an older Kotlin than cordova-android's own default.
  assert.doesNotMatch(xml, /<preference name="GradlePluginKotlinVersion"/, 'no Kotlin version is injected');
});

test('the engine floors are not above the versions CI builds with', () => {
  const xml = read('plugin.xml');
  const pkg = JSON.parse(read('package.json'));
  const compare = (a, b) => {
    const [x, y] = [a, b].map((version) => version.split('.').map(Number));
    return x.reduce((order, part, index) => order || part - (y[index] ?? 0), 0);
  };
  for (const platform of ['cordova-android', 'cordova-ios']) {
    const floor = new RegExp(`<engine name="${platform}" version=">=([\\d.]+)"`).exec(xml)?.[1];
    const tested = /\^([\d.]+)/.exec(pkg.devDependencies[platform])?.[1];
    assert.ok(floor, `plugin.xml has an engine floor for ${platform}`);
    assert.ok(tested, `package.json has a dev dependency on ${platform}`);
    assert.ok(compare(floor, tested) <= 0, `${platform}: the floor ${floor} is above ${tested}, the version the tests build with`);
  }
});

test('tests/ is released with the plugin: the same version in its package.json and its plugin.xml', () => {
  const version = JSON.parse(read('package.json')).version;
  assert.equal(JSON.parse(read('tests/package.json')).version, version, 'tests/package.json');
  assert.match(read('tests/plugin.xml'), new RegExp(`<plugin[^>]*\\sversion="${version.replaceAll('.', '\\.')}"`), 'tests/plugin.xml');
});

test('the test projects pin the SDK versions the plugin installs', () => {
  const cocoa = (path) => /sentryCocoaVersion: Version = "([\d.]+)"/.exec(read(path))?.[1];
  assert.equal(cocoa('test/ios/Package.swift'), cocoa('Package.swift'), 'sentry-cocoa: test/ios against the plugin');
  const xml = read('plugin.xml');
  const android = /SENTRY_ANDROID_SDK_VERSION" default="([\d.]+)"/.exec(xml)?.[1];
  const artifact = /SENTRY_ANDROID_ARTIFACT" default="([\w-]+)"/.exec(xml)?.[1];
  assert.match(xml, /<framework src="io\.sentry:\$SENTRY_ANDROID_ARTIFACT:\$SENTRY_ANDROID_SDK_VERSION"/, 'plugin.xml takes the artifact and its version from the two variables');
  const gradle = new RegExp(`io\\.sentry:${artifact}:([\\d.]+)`).exec(read('test/android/plugin/build.gradle'))?.[1];
  assert.equal(gradle, android, `${artifact}: test/android against plugin.xml`);
  const pkg = JSON.parse(read('package.json'));
  const framework = /org\.apache\.cordova:framework:([\d.]+)/.exec(read('test/android/plugin/build.gradle'))?.[1];
  assert.equal(`^${framework}`, pkg.devDependencies['cordova-android'], 'cordova-android: test/android against the dev dependency');
});
