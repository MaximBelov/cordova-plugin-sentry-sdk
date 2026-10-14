// scripts/check-pins.mjs says where the two SDK pins stand against the latest releases. What it can say without the network is here:
// how versions are ordered, where each pin is read from, and what a pin that is behind comes to.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { SDKS, assess, compareVersions, readPin } from '../../scripts/check-pins.mjs';

test('versions are compared as numbers, so 9.9.0 is older than 9.30.0', () => {
  assert.ok(compareVersions('9.30.1', '9.30.2') < 0);
  assert.ok(compareVersions('9.9.0', '9.30.0') < 0);
  assert.ok(compareVersions('10.0.0', '9.30.2') > 0);
  assert.equal(compareVersions('8.60.0', '8.60.0'), 0);
  assert.equal(compareVersions('8.60', '8.60.0'), 0);
});

test('each pin is read out of the file that holds it, and a file without one is an error', () => {
  for (const sdk of SDKS) {
    assert.match(readPin(sdk), /^\d+\.\d+\.\d+$/, `${sdk.name} in ${sdk.file}`);
  }
  assert.equal(readPin(SDKS[0], () => 'let sentryCocoaVersion: Version = "9.1.2"'), '9.1.2');
  assert.equal(readPin(SDKS[1], () => '<preference name="SENTRY_ANDROID_SDK_VERSION" default="8.1.0" />'), '8.1.0');
  assert.throws(() => readPin(SDKS[1], () => '<plugin/>'), /names no version/);
});

test('a pin behind the latest release says so, with the title and the body of its issue', () => {
  const behind = assess(SDKS[0], '9.30.1', '9.30.2');
  assert.equal(behind.behind, true);
  assert.equal(behind.line, 'sentry-cocoa: pinned 9.30.1, latest 9.30.2 (behind)');
  assert.equal(behind.title, 'sentry-cocoa 9.30.2 is out (pinned 9.30.1)');
  assert.match(behind.body, /https:\/\/github\.com\/getsentry\/sentry-cocoa\/releases\/tag\/9\.30\.2/);

  assert.equal(assess(SDKS[0], '9.30.2', '9.30.2').behind, false);
  assert.equal(assess(SDKS[1], '8.61.0', '8.60.0').behind, false, 'a pin ahead of the latest release is not behind');
});
