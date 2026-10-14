#!/usr/bin/env node
/* eslint-disable no-console */
// The two native SDKs are pinned in this repository, and Dependabot cannot move either pin: its Swift jobs fail on the local path to
// cordova-ios in test/ios, and plugin.xml is not a manifest it reads. This compares both pins with the latest release of each SDK on
// GitHub and says which are behind. `--issue` also opens one issue for each SDK that is, unless an open one already names that version.
//
//   node scripts/check-pins.mjs           print where each pin stands
//   node scripts/check-pins.mjs --issue   the same, and open an issue per SDK that is behind (needs `gh` and GH_TOKEN)
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** A label the repository has; Dependabot's `dependencies` was never created here, because Dependabot never opened one of these. */
const LABEL = 'enhancement';

/** The SDKs, where each is pinned, and where its releases are. */
export const SDKS = [
  { name: 'sentry-cocoa', repo: 'getsentry/sentry-cocoa', file: 'Package.swift', pin: /sentryCocoaVersion: Version = "([\d.]+)"/ },
  { name: 'sentry-android', repo: 'getsentry/sentry-java', file: 'plugin.xml', pin: /SENTRY_ANDROID_SDK_VERSION" default="([\d.]+)"/ },
];

/** The version a pin names, read out of the file that holds it. */
export function readPin(sdk, read = (file) => readFileSync(join(root, file), 'utf8')) {
  const version = sdk.pin.exec(read(sdk.file))?.[1];
  if (!version) {
    throw new Error(`${sdk.file} names no version for ${sdk.name}`);
  }
  return version;
}

/** Negative when a is older than b, zero when they are the same, positive when a is newer: numeric, so 9.9.0 is older than 9.30.0. */
export function compareVersions(a, b) {
  const [x, y] = [a, b].map((version) => version.split('.').map(Number));
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const order = (x[i] ?? 0) - (y[i] ?? 0);
    if (order !== 0) {
      return order;
    }
  }
  return 0;
}

/** What to say, and which issue to open, for a pin and the latest release. */
export function assess(sdk, pinned, latest) {
  const behind = compareVersions(pinned, latest) < 0;
  return {
    sdk: sdk.name,
    pinned,
    latest,
    behind,
    line: `${sdk.name}: pinned ${pinned}, latest ${latest}${behind ? ' (behind)' : ''}`,
    title: `${sdk.name} ${latest} is out (pinned ${pinned})`,
    body: `${sdk.name} ${latest} is the latest release (https://github.com/${sdk.repo}/releases/tag/${latest}), and this plugin pins ${pinned} in ${sdk.file}. Read the release notes, move the pin (and the test project's, which a test holds equal), and run the iOS and Android tests and the end-to-end test.`,
  };
}

/** The latest release of a repository that is not a prerelease, as its tag. */
async function latestRelease(repo, token) {
  const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  });
  if (!response.ok) {
    throw new Error(`GitHub answered ${response.status} for the latest release of ${repo}`);
  }
  return (await response.json()).tag_name.replace(/^v/, '');
}

function openIssue({ title, body }) {
  const names = JSON.parse(execFileSync('gh', ['issue', 'list', '--state', 'open', '--label', LABEL, '--json', 'title'], { encoding: 'utf8' }));
  if (names.some((issue) => issue.title === title)) {
    console.log(`already open: ${title}`);
    return;
  }
  execFileSync('gh', ['issue', 'create', '--title', title, '--body', body, '--label', LABEL], { stdio: 'inherit' });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const issues = process.argv.includes('--issue');
  const token = process.env.GH_TOKEN ?? process.env.GITHUB_TOKEN;
  for (const sdk of SDKS) {
    const result = assess(sdk, readPin(sdk), await latestRelease(sdk.repo, token));
    console.log(result.line);
    if (issues && result.behind) {
      openIssue(result);
    }
  }
}
