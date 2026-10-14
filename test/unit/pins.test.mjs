// scripts/check-pins.mjs says where the two SDK pins stand against the latest releases, and opens a pull request for each that is behind.
// What it can do without the network is here: how versions are ordered, where each pin is read from, what a bump writes (also on the
// files of this repository, so a format that drifts away from what the script looks for fails here and not on a Monday), which pull
// request is opened or left alone, and the commands that open one.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { SDKS, assess, bump, compareVersions, decide, describePullRequest, propose, readPin, superseded, versionOf } from '../../scripts/check-pins.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const real = (file) => readFileSync(join(root, file), 'utf8');
const [cocoa, android] = SDKS;

/** Files in memory that fall back to this repository's own, and remember what was written. */
function tree(entries = {}) {
  const written = new Map(Object.entries(entries));
  return { read: (file) => written.get(file) ?? real(file), write: (file, text) => written.set(file, text), written };
}

/** Whether a line carries a version as a whole version: 8.60.0 is in "at 8.60.0." and is not in 18.60.0, 8.60.01 or 8.60.0.1. */
const carries = (line, version) => new RegExp(`(?<![0-9])(?<![0-9]\\.)${version.replaceAll('.', '\\.')}(?![0-9])(?!\\.[0-9])`).test(line);

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
  assert.equal(readPin(cocoa, () => 'let sentryCocoaVersion: Version = "9.1.2"'), '9.1.2');
  assert.equal(readPin(android, () => '<preference name="SENTRY_ANDROID_SDK_VERSION" default="8.1.0" />'), '8.1.0');
  assert.throws(() => readPin(android, () => '<plugin/>'), /names no version/);
});

test('a release tag is a version of three numbers, and nothing else gets into a branch name, a file or a title', () => {
  assert.equal(versionOf('9.30.2'), '9.30.2');
  assert.equal(versionOf('v8.61.0'), '8.61.0');
  for (const tag of ['9.30', '9.30.2-rc.1', '9.30.2.1', 'latest', '9.30.2; rm -rf']) {
    assert.throws(() => versionOf(tag), /not a version of three numbers/, tag);
  }
});

test('a pin behind the latest release says so, with the title and the branch of its pull request, and a major says it is one', () => {
  const behind = assess(cocoa, '9.30.1', '9.30.2');
  assert.equal(behind.behind, true);
  assert.equal(behind.major, false);
  assert.equal(behind.line, 'sentry-cocoa: pinned 9.30.1, latest 9.30.2 (behind)');
  assert.equal(behind.title, 'Take sentry-cocoa 9.30.2');
  assert.equal(behind.branch, 'pins/sentry-cocoa-9.30.2');

  assert.equal(assess(cocoa, '9.30.2', '10.0.0').major, true);
  assert.equal(assess(cocoa, '9.30.2', '9.31.0').major, false);
  assert.equal(assess(cocoa, '9.30.2', '9.30.2').behind, false);
  assert.equal(assess(android, '8.61.0', '8.60.0').behind, false, 'a pin ahead of the latest release is not behind');
  assert.equal(assess(android, '9.0.0', '8.99.0').major, false, 'a pin ahead is not a major release either');
});

for (const sdk of SDKS) {
  test(`${sdk.name}: a bump of this repository's files moves the pin, what follows it and the README, and writes a line to CHANGES`, () => {
    const from = readPin(sdk);
    const files = tree();
    const written = bump(sdk, from, '99.1.0', files);

    assert.deepEqual(written, [sdk.file, ...sdk.followers.map(({ file }) => file), 'README.md', 'CHANGES.txt']);
    assert.equal(readPin(sdk, files.read), '99.1.0');
    for (const { file, pin } of sdk.followers) {
      assert.equal(pin.exec(files.read(file))[1], '99.1.0', file);
    }

    const readme = files.read('README.md').split('\n');
    assert.ok(readme.some((line) => sdk.mention.test(line) && carries(line, '99.1.0')), 'the README names the new version');
    assert.deepEqual(
      readme.filter((line) => sdk.mention.test(line) && carries(line, from)),
      [],
      'no README line that names the SDK still carries the old version',
    );

    const changes = files.read('CHANGES.txt').split('\n');
    assert.equal(changes[0], '= next =');
    assert.equal(changes[1], `${sdk.platform}: ${sdk.name} 99.1.0 (it was ${from})`);
    const history = (text) => text.slice(text.indexOf('\n= 0.1.2 ='));
    assert.equal(history(files.read('CHANGES.txt')), history(real('CHANGES.txt')), 'the released versions are left as they were');
  });
}

test('a bump changes the README only on lines that name the SDK, and only where the version stands alone', () => {
  const files = tree({
    'plugin.xml': '<preference name="SENTRY_ANDROID_SDK_VERSION" default="8.60.0" />\n',
    'test/android/plugin/build.gradle': "    implementation 'io.sentry:sentry-android-core:8.60.0'\n",
    'README.md': [
      '| Android | sentry-android 8.60.0 | from Maven |',
      'sentry-android is at 8.60.0.',
      '| `SENTRY_ANDROID_SDK_VERSION` | `8.60.0` | the release |',
      'sentry-android 18.60.0, 8.60.01 and 8.60.0.1 are other versions',
      'Xcode 8.60.0 is not the SDK',
    ].join('\n'),
    'CHANGES.txt': '= next =\nsomething\n\n= 0.1.2 =\nAndroid: sentry-android 8.60.0 by default\n',
  });
  bump(android, '8.60.0', '8.61.0', files);
  assert.equal(
    files.written.get('README.md'),
    [
      '| Android | sentry-android 8.61.0 | from Maven |',
      'sentry-android is at 8.61.0.',
      '| `SENTRY_ANDROID_SDK_VERSION` | `8.61.0` | the release |',
      'sentry-android 18.60.0, 8.60.01 and 8.60.0.1 are other versions',
      'Xcode 8.60.0 is not the SDK',
    ].join('\n'),
  );
  assert.equal(files.written.get('CHANGES.txt'), '= next =\nAndroid: sentry-android 8.61.0 (it was 8.60.0)\nsomething\n\n= 0.1.2 =\nAndroid: sentry-android 8.60.0 by default\n');
  assert.match(files.written.get('test/android/plugin/build.gradle'), /sentry-android-core:8\.61\.0'/);

  const umbrella = tree({ 'test/android/plugin/build.gradle': "implementation 'io.sentry:sentry-android:8.60.0'" });
  bump(android, '8.60.0', '8.61.0', umbrella);
  assert.equal(umbrella.written.get('test/android/plugin/build.gradle'), "implementation 'io.sentry:sentry-android:8.61.0'");
});

test('a bump that would change nothing, or what disagrees with the pin, is an error and not a bump that did nothing', () => {
  const missing = tree({ 'test/android/plugin/build.gradle': 'dependencies {}' });
  assert.throws(() => bump(android, readPin(android), '99.1.0', missing), /build\.gradle did not change/);

  const apart = tree({ 'test/android/plugin/build.gradle': "implementation 'io.sentry:sentry-android-core:8.59.0'" });
  assert.throws(() => bump(android, readPin(android), '99.1.0', apart), /pins 8\.59\.0, not/);

  const noSection = tree({ 'CHANGES.txt': '= 0.1.2 =\nsomething\n' });
  assert.throws(() => bump(android, readPin(android), '99.1.0', noSection), /CHANGES\.txt did not change: it has no "= next =" section/);
});

const pull = (number, title, state, headRefName) => ({ number, title, state, headRefName });

test('a pull request is opened for a pin that is behind, unless that version has one, of any state', () => {
  const behind = assess(android, '8.60.0', '8.61.0');
  assert.deepEqual(decide(behind, []), { open: true });
  assert.equal(decide(assess(android, '8.61.0', '8.61.0'), []).open, false);

  const byTitle = decide(behind, [pull(14, 'Take sentry-android 8.61.0', 'OPEN', 'android-8-61-0')]);
  assert.equal(byTitle.open, false, 'a pull request of the same title, from any branch');
  assert.match(byTitle.why, /#14 is already there \(open\)/);

  const declined = decide(behind, [pull(15, 'Something else', 'CLOSED', 'pins/sentry-android-8.61.0')]);
  assert.equal(declined.open, false, 'one that was closed is a version that was declined');
  assert.match(declined.why, /#15 .*closed/);

  assert.equal(decide(behind, [pull(16, 'Take sentry-cocoa 8.61.0', 'OPEN', 'pins/sentry-cocoa-8.61.0')]).open, true, 'another SDK is another pull request');
});

test('an open pull request of this script for an older release of the same SDK is replaced, and nothing else is', () => {
  const result = assess(android, '8.60.0', '8.62.0');
  const older = pull(1, 'Take sentry-android 8.61.0', 'OPEN', 'pins/sentry-android-8.61.0');
  const others = [
    pull(2, 'Take sentry-android 8.59.0', 'CLOSED', 'pins/sentry-android-8.59.0'),
    pull(3, 'Take sentry-cocoa 9.31.0', 'OPEN', 'pins/sentry-cocoa-9.31.0'),
    pull(4, 'Take sentry-android 8.61.0', 'OPEN', 'android-8-61-0'),
    pull(5, 'Take sentry-android 8.62.0', 'OPEN', 'pins/sentry-android-8.62.0'),
  ];
  assert.deepEqual(superseded(result, [older, ...others]), [older]);
});

test('a pull request says which files it moves and, for a major release, that it can break the build', () => {
  const minor = describePullRequest(cocoa, assess(cocoa, '9.30.1', '9.30.2'), ['Package.swift', 'CHANGES.txt']);
  assert.match(minor.body, /sentry-cocoa 9\.30\.2 is out, and this plugin pinned 9\.30\.1: https:\/\/github\.com\/getsentry\/sentry-cocoa\/releases\/tag\/9\.30\.2/);
  assert.match(minor.body, /Package\.swift, CHANGES\.txt/);
  assert.match(minor.body, /workflow_dispatch of ci\.yaml/);
  assert.doesNotMatch(minor.body, /major release/);
  assert.equal(minor.commit, 'Release notes: https://github.com/getsentry/sentry-cocoa/releases/tag/9.30.2');

  assert.match(describePullRequest(cocoa, assess(cocoa, '9.30.2', '10.0.0'), ['Package.swift']).body, /This is a major release/);
});

/** Runs `propose` against the files of this repository with commands that are only written down. */
function run(entries, pulls = []) {
  const calls = [];
  const files = tree();
  const exec = (command, args) => {
    assert.deepEqual([command, ...args.slice(0, 2)], ['gh', 'pr', 'list'], 'only the list of pull requests is read');
    return JSON.stringify(pulls);
  };
  const act = (command, args) => {
    calls.push([command, ...args]);
    return command === 'gh' && args[1] === 'create' ? 'https://github.com/MaximBelov/cordova-plugin-sentry-sdk/pull/21\n' : '';
  };
  propose(entries, { exec, act, files, head: 'abc123' });
  return { calls, files };
}

test('propose opens one pull request per SDK that is behind, from the commit it started on, and starts CI on its branch', () => {
  const entries = [
    { sdk: cocoa, result: assess(cocoa, readPin(cocoa), '99.0.0') },
    { sdk: android, result: assess(android, readPin(android), '8.99.0') },
  ];
  const { calls } = run(entries);
  const subject = (call) => call.filter((arg) => arg !== '-c' && !arg.startsWith('user.')).slice(0, 3).join(' ');
  assert.deepEqual(calls.map(subject), [
    'git switch --create',
    'git add --',
    'git commit --message',
    'git push --set-upstream',
    'gh pr create',
    'gh workflow run',
    'git switch --detach',
    'git switch --create',
    'git add --',
    'git commit --message',
    'git push --set-upstream',
    'gh pr create',
    'gh workflow run',
    'git switch --detach',
  ]);
  assert.deepEqual(calls[0], ['git', 'switch', '--create', 'pins/sentry-cocoa-99.0.0']);
  assert.deepEqual(calls[1], ['git', 'add', '--', 'Package.swift', 'test/ios/Package.swift', 'README.md', 'CHANGES.txt']);
  assert.equal(calls[2].at(-3), 'Take sentry-cocoa 99.0.0');
  assert.deepEqual(calls[3], ['git', 'push', '--set-upstream', 'origin', 'pins/sentry-cocoa-99.0.0']);
  assert.deepEqual(calls[4].slice(0, 9), ['gh', 'pr', 'create', '--base', 'main', '--head', 'pins/sentry-cocoa-99.0.0', '--title', 'Take sentry-cocoa 99.0.0']);
  assert.match(calls[4].at(-1), /This is a major release/);
  assert.deepEqual(calls[5], ['gh', 'workflow', 'run', 'ci.yaml', '--ref', 'pins/sentry-cocoa-99.0.0']);
  assert.deepEqual(calls[6], ['git', 'switch', '--detach', 'abc123']);
  assert.deepEqual(calls[7], ['git', 'switch', '--create', 'pins/sentry-android-8.99.0']);
  assert.match(calls[11].at(-1), /sentry-android 8\.99\.0 is out/);
  assert.doesNotMatch(calls[11].at(-1), /major release/, 'a minor release is not called a major');
});

test('propose commits as the Actions bot, so the pull request is not taken for the work of whoever merges it', () => {
  const { calls } = run([{ sdk: android, result: assess(android, readPin(android), '99.1.0') }]);
  const commit = calls.find((call) => call.includes('commit'));
  assert.deepEqual(commit.slice(0, 5), ['git', '-c', 'user.name=github-actions[bot]', '-c', 'user.email=41898282+github-actions[bot]@users.noreply.github.com']);
});

test('propose leaves a pin that is not behind, and one that has a pull request, alone, and replaces an older pull request of the same SDK', () => {
  const current = { sdk: cocoa, result: assess(cocoa, readPin(cocoa), readPin(cocoa)) };
  assert.deepEqual(run([current]).calls, []);

  const proposed = [pull(14, 'Take sentry-android 99.1.0', 'OPEN', 'android-99-1-0')];
  const behind = { sdk: android, result: assess(android, readPin(android), '99.1.0') };
  assert.deepEqual(run([behind], proposed).calls, []);

  const older = pull(9, 'Take sentry-android 99.0.0', 'OPEN', 'pins/sentry-android-99.0.0');
  const { calls } = run([behind], [older]);
  assert.deepEqual(calls.at(-2), ['gh', 'pr', 'close', '9', '--delete-branch', '--comment', 'Replaced by #21.']);
  assert.deepEqual(calls.at(-1), ['git', 'switch', '--detach', 'abc123']);
});

test('the script refuses a flag it does not know before it asks anyone anything, so a workflow that still says --issue fails', () => {
  for (const args of [['--issue'], ['--dry-run']]) {
    const answer = spawnSync(process.execPath, [join(root, 'scripts', 'check-pins.mjs'), ...args], { encoding: 'utf8' });
    assert.notEqual(answer.status, 0, args.join(' '));
    assert.match(answer.stderr, /usage: check-pins\.mjs/, args.join(' '));
  }
});

test('the workflow that runs the script may write a branch, open a pull request and start CI, and asks for the mode that does', () => {
  const workflow = real('.github/workflows/pins.yaml');
  for (const permission of ['contents: write', 'pull-requests: write', 'actions: write']) {
    assert.match(workflow, new RegExp(`^  ${permission}`, 'm'), permission);
  }
  assert.match(workflow, /run: node scripts\/check-pins\.mjs --pr$/m);
});
