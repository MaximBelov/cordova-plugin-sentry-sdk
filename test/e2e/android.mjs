#!/usr/bin/env node
/* eslint-disable no-console */
// End to end on Android: the demo app, built with the plugin installed the way an app installs it, starts the SDK against a DSN that
// points at an ingest endpoint on this machine, sets a user, tags and a context, and crashes. The next launch sends the report. The
// test reads what arrived: the SDK and its version, the release and the environment, the user, the tags, the context and the exception.
//
//   node test/e2e/android.mjs build [--host 10.0.2.2] [--port 9099]   writes the demo's e2e.js and builds the debug APK
//   node test/e2e/android.mjs run   [--host 10.0.2.2] [--port 9099]   installs it, crashes it, relaunches it and checks the envelope
//
// `--host` is where the app reaches this machine: 10.0.2.2 from an emulator, and 127.0.0.1 from a phone on a cable, where the run
// makes the port reachable with `adb reverse`. The device is the one ANDROID_SERIAL names, or the only one adb sees.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { crashProblems } from './expect.mjs';
import { startIngest } from './ingest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const demo = join(root, 'demo');
const APP_ID = 'io.github.maximbelov.sentry.demo';
const APK = join(demo, 'platforms/android/app/build/outputs/apk/debug/app-debug.apk');
const KEY = 'e2ekey';
const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: { host: { type: 'string', default: '10.0.2.2' }, port: { type: 'string', default: '9099' }, run: { type: 'string' } },
});
const port = Number(values.port);
// One name for the whole run, and the same one in `build` and `run`: the demo reports it as its release, and the test looks for it.
const runId = values.run ?? process.env.E2E_RUN ?? 'local';
const release = `e2e@${runId}`;

const adb = (...args) => spawnSync('adb', args, { encoding: 'utf8' });
const adbOk = (...args) => {
  const result = adb(...args);
  if (result.status !== 0) {
    throw new Error(`adb ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
};
const alive = () => adb('shell', 'pidof', APP_ID).status === 0;
async function waitFor(what, test, timeoutMs, everyMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await test()) {
      return;
    }
    await sleep(everyMs);
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}`);
}
const launch = () => adbOk('shell', 'monkey', '-p', APP_ID, '-c', 'android.intent.category.LAUNCHER', '1');

function build() {
  // What the demo is told to send. The page loads this file when it is there and does nothing special when it is not.
  const config = { dsn: `http://${KEY}@${values.host}:${port}/1`, release, environment: 'e2e' };
  writeFileSync(join(demo, 'www/e2e.js'), `window.E2E = ${JSON.stringify(config)};\n`);
  // cordova is the one this repository installs, not whatever the demo's own package finds: pack-plugin.mjs calls it by name.
  const env = { ...process.env, PATH: `${join(root, 'node_modules/.bin')}${delimiter}${process.env.PATH}` };
  const run = (file, args) => execFileSync(file, args, { cwd: demo, stdio: 'inherit', env });
  run('npm', ['install', '--no-audit', '--no-fund']);
  if (!existsSync(join(demo, 'platforms/android'))) {
    run('cordova', ['platform', 'add', 'android', '--nosave']);
  }
  run('node', ['scripts/pack-plugin.mjs']);
  run('cordova', ['build', 'android', '--debug']);
  console.log(`built ${APK}`);
}

async function runOnDevice() {
  if (!existsSync(APK)) {
    throw new Error(`${APK} is not there: run "build" first`);
  }
  const sdkVersion = /SENTRY_ANDROID_SDK_VERSION" default="([\d.]+)"/.exec(readFileSync(join(root, 'plugin.xml'), 'utf8'))?.[1];
  const ingest = await startIngest({ port });
  console.log(`ingest endpoint on port ${ingest.port}`);
  try {
    if (values.host === '127.0.0.1') {
      adbOk('reverse', `tcp:${port}`, `tcp:${port}`);
    }
    adb('uninstall', APP_ID);
    adbOk('install', '-r', APK);
    adbOk('logcat', '-c');

    launch();
    await waitFor('the app to start', alive, 30_000);
    console.log('first launch: the app is up, it sets its scope and crashes');
    await waitFor('the app to crash', () => !alive(), 90_000);
    console.log('the app went down');

    // sentry-android keeps the crash on disk and sends it from the next start of the SDK.
    launch();
    await waitFor('the crash to arrive', () => ingest.received.some(({ envelope }) => envelope.items.some((item) => item.header.type === 'event')), 90_000);
    console.log(`arrived: ${ingest.received.length} envelope(s)`);

    const problems = crashProblems(ingest.received, {
      key: KEY,
      project: '1',
      sdkName: 'sentry.java.android',
      sdkVersion,
      release,
      environment: 'e2e',
      exception: { type: 'RuntimeException', valueIncludes: 'SentrySdk: test crash' },
      user: { id: '42', email: 'demo@example.com', username: 'demo' },
      tags: { 'account.region': 'IE', premium: 'true' },
      absentTags: ['gone'],
      contexts: { account: { animals: 120, premium: true } },
    });
    if (problems.length > 0) {
      throw new Error(`the envelope is not what was sent:\n  ${problems.join('\n  ')}`);
    }
    console.log(`PASS: sentry.java.android ${sdkVersion}, release ${release}, user, tags, context and exception all arrived`);
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    console.error('--- device log (the SDK and the page)');
    console.error(adb('logcat', '-d', '-t', '400', '-s', 'Sentry:V', 'chromium:I', 'CordovaWebView:V', 'AndroidRuntime:E').stdout);
    process.exitCode = 1;
  } finally {
    await ingest.close();
  }
}

if (command === 'build') {
  build();
} else if (command === 'run') {
  await runOnDevice();
} else {
  console.error('usage: node test/e2e/android.mjs build|run [--host 10.0.2.2] [--port 9099] [--run <name>]');
  process.exitCode = 2;
}
