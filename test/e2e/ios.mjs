#!/usr/bin/env node
/* eslint-disable no-console */
// End to end on iOS: the demo app, built with the plugin installed the way an app installs it, runs on a simulator, sets a user and a
// context, starts the SDK against a DSN that points at an ingest endpoint on this machine, sets tags and crashes. The next launch sends
// the report. The test reads what arrived, as test/e2e/android.mjs does for Android.
//
//   node test/e2e/ios.mjs build [--port 9099] [--run <name>]                    writes the demo's e2e.js and builds it for a simulator
//   node test/e2e/ios.mjs run   [--port 9099] [--run <name>] [--device <udid>]  installs it, crashes it, relaunches it, checks the envelope
//
// A simulator shares this machine's network, so the DSN's host is 127.0.0.1 and nothing has to be forwarded. Without --device the run
// takes the first iPhone of the newest iOS runtime installed, which is the one test/ios/simulator.mjs picks for the XCTest.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath } from 'node:url';
import { eventArrived, expectation, sleep, waitFor, writeE2eConfig } from './common.mjs';
import { crashProblems } from './expect.mjs';
import { startIngest } from './ingest.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const demo = join(root, 'demo');
const APP_ID = 'io.github.maximbelov.sentry.demo';
const BUILD_DIR = join(demo, 'platforms/ios/build/Debug-iphonesimulator');

const [command, ...rest] = process.argv.slice(2);
const { values } = parseArgs({
  args: rest,
  options: { port: { type: 'string', default: '9099' }, run: { type: 'string' }, device: { type: 'string' } },
});
const port = Number(values.port);
const runId = values.run ?? process.env.E2E_RUN ?? 'local';
const release = `e2e@${runId}`;

const simctl = (...args) => spawnSync('xcrun', ['simctl', ...args], { encoding: 'utf8' });
const simctlOk = (...args) => {
  const result = simctl(...args);
  if (result.status !== 0) {
    throw new Error(`simctl ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`);
  }
  return result.stdout;
};

/** The first iPhone of the newest iOS runtime (never below 15) that is installed and usable. */
function pickSimulator() {
  const { devices } = JSON.parse(simctlOk('list', 'devices', 'available', '-j'));
  const version = (runtime) => (/iOS-([\d-]+)$/.exec(runtime)?.[1] ?? '').split('-').map(Number);
  const newest = Object.keys(devices)
    .filter((runtime) => /SimRuntime\.iOS-/.test(runtime) && (version(runtime)[0] ?? 0) >= 15)
    .sort((a, b) => {
      const [x, y] = [version(a), version(b)];
      return (y[0] - x[0]) || ((y[1] ?? 0) - (x[1] ?? 0));
    })[0];
  const iPhone = (devices[newest] ?? []).find((device) => /^iPhone /.test(device.name));
  if (!iPhone) {
    throw new Error('no iPhone simulator is installed (Xcode > Settings > Components)');
  }
  return iPhone.udid;
}

/**
 * Launches the app and returns its process id. An app on a simulator is a process of this machine, so a signal of 0 says whether it is
 * alive, with nothing to ask the simulator (`launchctl list` inside it answered nothing on a CI runner, which read as an app that never
 * started).
 */
function launchApp(udid) {
  const output = simctlOk('launch', udid, APP_ID);
  const pid = Number(/:\s*(\d+)\s*$/m.exec(output)?.[1]);
  if (!pid) {
    throw new Error(`simctl launch did not say a process id: ${output.trim()}`);
  }
  return pid;
}

const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

function build() {
  writeE2eConfig({ demo, host: '127.0.0.1', port, release });
  const env = { ...process.env, PATH: `${join(root, 'node_modules/.bin')}${delimiter}${process.env.PATH}` };
  const run = (file, args) => execFileSync(file, args, { cwd: demo, stdio: 'inherit', env });
  run('npm', ['install', '--no-audit', '--no-fund']);
  // A clean platform every time: what an earlier build left in platforms/ios is not what this plugin ships.
  rmSync(join(demo, 'platforms/ios'), { recursive: true, force: true });
  run('cordova', ['platform', 'add', 'ios', '--nosave']);
  run('node', ['scripts/pack-plugin.mjs']);
  run('cordova', ['build', 'ios', '--emulator', '--debug']);
  console.log(`built ${appPath()}`);
}

function appPath() {
  const app = existsSync(BUILD_DIR) ? readdirSync(BUILD_DIR).find((name) => name.endsWith('.app')) : undefined;
  if (!app) {
    throw new Error(`no .app in ${BUILD_DIR}: run "build" first`);
  }
  return join(BUILD_DIR, app);
}

async function runOnSimulator() {
  const app = appPath();
  const udid = values.device ?? pickSimulator();
  const sdkVersion = /sentryCocoaVersion: Version = "([\d.]+)"/.exec(readFileSync(join(root, 'Package.swift'), 'utf8'))?.[1];
  const ingest = await startIngest({ port });
  console.log(`ingest endpoint on port ${ingest.port}; simulator ${udid}`);
  try {
    if (!/Booted/.test(simctl('list', 'devices', udid).stdout)) {
      simctlOk('boot', udid);
    }
    simctlOk('bootstatus', udid, '-b');
    simctl('uninstall', udid, APP_ID);
    simctlOk('install', udid, app);

    const pid = launchApp(udid);
    console.log(`first launch: the app is up (process ${pid}), it sets its scope and crashes`);
    await waitFor('the app to crash', () => !alive(pid), 90_000);
    console.log('the app went down');

    // sentry-cocoa writes the crash report when it happens and sends it at the next start of the SDK, which the second launch makes.
    launchApp(udid);
    await waitFor('the crash to arrive', () => eventArrived(ingest.received), 90_000);
    console.log(`arrived: ${ingest.received.length} envelope(s)`);

    const problems = crashProblems(
      ingest.received,
      expectation({
        release,
        sdkName: 'sentry.cocoa',
        sdkVersion,
        exception: { type: 'EXC_BAD_ACCESS', valueIncludes: '' },
      }),
    );
    if (problems.length > 0) {
      throw new Error(`the envelope is not what was sent:\n  ${problems.join('\n  ')}`);
    }
    console.log(`PASS: sentry.cocoa ${sdkVersion}, release ${release}, user, tags, context and exception all arrived`);
  } catch (error) {
    console.error(`FAIL: ${error.message}`);
    console.error('--- simulator log (the SDK and the page)');
    console.error(
      simctl('spawn', udid, 'log', 'show', '--last', '4m', '--style', 'compact', '--predicate', 'process == "SentryDemo" OR subsystem CONTAINS "sentry"').stdout
        .split('\n')
        .slice(-120)
        .join('\n'),
    );
    process.exitCode = 1;
  } finally {
    await ingest.close();
    await sleep(100);
  }
}

if (command === 'build') {
  build();
} else if (command === 'run') {
  await runOnSimulator();
} else {
  console.error('usage: node test/e2e/ios.mjs build|run [--port 9099] [--run <name>] [--device <udid>]');
  process.exitCode = 2;
}
