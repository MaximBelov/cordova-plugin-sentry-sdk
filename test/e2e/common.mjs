// What the Android and the iOS end-to-end tests share: the DSN the demo is given, what the demo sets and so what has to arrive, and the waiting.
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** The public key of the DSN: the endpoint on this machine takes any, and the test checks that the request carried this one. */
export const KEY = 'e2ekey';

export const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

/** Polls `test` until it is true, or throws saying what was being waited for. */
export async function waitFor(what, test, timeoutMs, everyMs = 500) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await test()) {
      return;
    }
    await sleep(everyMs);
  }
  throw new Error(`timed out after ${timeoutMs / 1000}s waiting for ${what}`);
}

/** Tells the demo, through www/e2e.js, which DSN, release and environment to run with. Absent in a normal build. */
export function writeE2eConfig({ demo, host, port, release }) {
  const config = { dsn: `http://${KEY}@${host}:${port}/1`, release, environment: 'e2e' };
  writeFileSync(join(demo, 'www/e2e.js'), `window.E2E = ${JSON.stringify(config)};\n`);
}

/**
 * Installs demo/failing-plugin, whose every call fails, so recordPluginErrors has a failed result to record. Only the end-to-end build
 * has it: the demo a person builds stays the bare app.
 */
export function addFailingPlugin({ demo, env }) {
  try {
    execFileSync('cordova', ['plugin', 'rm', 'sentry-demo-failing-plugin', '--nosave'], { cwd: demo, stdio: 'ignore', env });
  } catch {
    // not installed yet
  }
  execFileSync('cordova', ['plugin', 'add', join(demo, 'failing-plugin'), '--nosave'], { cwd: demo, stdio: 'inherit', env });
}

/** The two failed results the demo makes, one before `start` and one after it, as their breadcrumbs have to arrive. */
export const PLUGIN_ERRORS = [
  { category: 'cordova.plugin', level: 'error', message: 'DemoFailure answered with an error', service: 'DemoFailure', error: 'failed before start' },
  { category: 'cordova.plugin', level: 'error', message: 'DemoFailure answered with an error', service: 'DemoFailure', error: 'failed after start' },
];

/**
 * What has to arrive: the same on both platforms except the SDK and the exception. The user and the context are what the demo sets
 * BEFORE it starts the SDK and the tags what it sets after it, so all three paths of the plugin are in it. The breadcrumbs of the two failed
 * plugin calls take both paths of recordPluginErrors: kept until `start`, and recorded after it.
 */
export function expectation({ release, sdkName, sdkVersion, exception }) {
  return {
    key: KEY,
    project: '1',
    sdkName,
    sdkVersion,
    release,
    environment: 'e2e',
    exception,
    user: { id: '42', email: 'demo@example.com', username: 'demo' },
    tags: { 'account.region': 'IE', premium: 'true' },
    absentTags: ['gone'],
    contexts: { account: { animals: 120, premium: true } },
    pluginErrors: PLUGIN_ERRORS,
  };
}

/** Whether an event, and not only a session or a client report, has arrived. */
export const eventArrived = (received) =>
  received.some(({ envelope }) => envelope.items.some((item) => item.header.type === 'event'));
