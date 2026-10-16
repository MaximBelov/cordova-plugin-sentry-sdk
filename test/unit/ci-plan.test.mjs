// The `plan` step of .github/workflows/ci.yaml decides, from what started a run, which of the longer tests it needs and whether it ends in
// a publish. It is shell inside YAML, so it is run here. A run started by hand or by the pins workflow (workflow_dispatch) tests everything
// and must never publish: trusted publishing is tied to the file name, not to the branch, so a run of any branch could otherwise
// publish the version it carries.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const workflow = readFileSync(join(root, '.github', 'workflows', 'ci.yaml'), 'utf8');

/** The shell of the `plan` step, taken out of the YAML and dedented. */
function planScript() {
  const step = workflow.slice(workflow.indexOf('- id: plan'));
  const body = / {8}run: \|\n((?: {10}.*\n|\n)+)/.exec(step)?.[1];
  assert.ok(body, 'ci.yaml has a plan step with a run block');
  return body.replace(/^ {10}/gm, '');
}

const git = (cwd, ...args) =>
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.com', '-c', 'commit.gpgsign=false', ...args], { cwd, encoding: 'utf8' }).trim();

/** What the plan says for a run started by `event`, in a repository whose last commit changed `changed` since its base. */
function plan(event, changed = ['README.md'], extraEnv = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'ci-plan-'));
  try {
    git(dir, 'init', '--quiet');
    writeFileSync(join(dir, 'start.txt'), 'start');
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '--message', 'base');
    const base = git(dir, 'rev-parse', 'HEAD');
    for (const file of changed) {
      mkdirSync(dirname(join(dir, file)), { recursive: true });
      writeFileSync(join(dir, file), 'changed');
    }
    git(dir, 'add', '.');
    git(dir, 'commit', '--quiet', '--message', 'change');
    const output = join(dir, 'github-output');
    writeFileSync(output, '');
    execFileSync('bash', ['-c', planScript()], { cwd: dir, env: { ...process.env, EVENT: event, REF: 'refs/heads/main', PUBLISH_INPUT: '', ...extraEnv, BASE: event === 'pull_request' ? base : '', GITHUB_OUTPUT: output }, stdio: 'pipe' });
    return Object.fromEntries(
      readFileSync(output, 'utf8')
        .trim()
        .split('\n')
        .map((line) => line.split('=')),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('a push to main runs only the fast checks and publishes: the pull request already ran the platform suites', () => {
  assert.deepEqual(plan('push'), { ios: 'false', android: 'false', publish: 'true' });
});

test('a run by hand with publish ticked, on main, publishes at once; on another branch or unticked it does not', () => {
  const tick = { PUBLISH_INPUT: 'true' };
  assert.deepEqual(plan('workflow_dispatch', ['README.md'], tick), { ios: 'false', android: 'false', publish: 'true' });
  assert.deepEqual(plan('workflow_dispatch', ['README.md'], { ...tick, REF: 'refs/heads/pin-sentry-cocoa-99.0.0' }), { ios: 'true', android: 'true', publish: 'false' });
  assert.deepEqual(plan('workflow_dispatch', ['README.md'], { PUBLISH_INPUT: 'false' }), { ios: 'true', android: 'true', publish: 'false' });
});

test('a run started by hand or by the pins workflow tests everything and does not publish', () => {
  assert.deepEqual(plan('workflow_dispatch'), { ios: 'true', android: 'true', publish: 'false' });
});

test('a pull request runs the tests its change needs, and never publishes', () => {
  assert.deepEqual(plan('pull_request', ['README.md']), { ios: 'false', android: 'false', publish: 'false' });
  assert.deepEqual(plan('pull_request', ['src/ios/SentrySdk.swift']), { ios: 'true', android: 'false', publish: 'false' });
  assert.deepEqual(plan('pull_request', ['src/android/SentrySdk.kt']), { ios: 'false', android: 'true', publish: 'false' });
  assert.deepEqual(plan('pull_request', ['plugin.xml']), { ios: 'true', android: 'true', publish: 'false' });
});

test('ci.yaml can be started by hand, with a publish input, and only main reaches the publish job', () => {
  assert.match(workflow, /^on:\n(?: {2}.*\n)*? {2}workflow_dispatch:/m);
  assert.match(workflow, /workflow_dispatch:\n {4}inputs:\n {6}publish:/);
  assert.match(workflow, /publish:\n {4}needs: \[plan, ci\]\n(?: {4}#.*\n)* {4}if: \$\{\{ !cancelled\(\) && needs\.ci\.result == 'success' && needs\.plan\.outputs\.publish == 'true' \}\}/);
  // a skipped suite above `ci` must not skip the publish: `success()` would
  assert.ok(!/publish:\n(?: {4}.*\n)*? {4}if: success\(\)/.test(workflow));
});
