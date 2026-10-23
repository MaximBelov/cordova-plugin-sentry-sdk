// The pieces of the end-to-end test that need no device: the envelope reader, the ingest endpoint, and the expectations.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import { itemsOf, parseEnvelope } from '../e2e/envelope.mjs';
import { PLUGIN_ERRORS } from '../e2e/common.mjs';
import { crashProblems } from '../e2e/expect.mjs';
import { startIngest } from '../e2e/ingest.mjs';

const envelopeText = (event) => {
  const payload = JSON.stringify(event);
  return [
    JSON.stringify({ event_id: 'abc', dsn: 'http://k@host:1/1' }),
    JSON.stringify({ type: 'event', length: Buffer.byteLength(payload) }),
    payload,
    JSON.stringify({ type: 'session' }),
    JSON.stringify({ sid: 's1', status: 'ok' }),
    '',
  ].join('\n');
};

// A crash carries the breadcrumbs of the two failed plugin calls among the SDK's own, the way sentry-cocoa nests them under `values`.
const pluginCrumb = ({ service, error, ...crumb }, status = 9) => ({ ...crumb, timestamp: '2026-10-21T10:00:00Z', data: { service, status, error } });
const crumbs = [{ category: 'app.lifecycle', level: 'info' }, ...PLUGIN_ERRORS.map((crumb) => pluginCrumb(crumb))];

const crash = (overrides = {}) => ({
  release: 'e2e@1',
  environment: 'e2e',
  level: 'fatal',
  sdk: { name: 'sentry.java.android', version: '8.60.0' },
  exception: { values: [{ type: 'RuntimeException', value: 'SentrySdk: test crash', mechanism: { type: 'UncaughtExceptionHandler', handled: false } }] },
  user: { id: '42', email: 'demo@example.com', username: 'demo' },
  tags: { 'account.region': 'IE', premium: 'true' },
  contexts: { account: { animals: 120, premium: true } },
  breadcrumbs: { values: crumbs },
  ...overrides,
});
const want = {
  key: 'k',
  project: '1',
  sdkName: 'sentry.java.android',
  sdkVersion: '8.60.0',
  release: 'e2e@1',
  environment: 'e2e',
  exception: { type: 'RuntimeException', valueIncludes: 'test crash' },
  user: { id: '42', email: 'demo@example.com', username: 'demo' },
  tags: { 'account.region': 'IE', premium: 'true' },
  absentTags: ['gone'],
  contexts: { account: { animals: 120, premium: true } },
  pluginErrors: PLUGIN_ERRORS,
};
const arrived = (event, extra = {}) => [{ key: 'k', project: '1', envelope: parseEnvelope(envelopeText(event)), ...extra }];

test('an envelope is read into its header and items, with or without an item length', () => {
  const envelope = parseEnvelope(envelopeText({ message: 'a\nb' }));
  assert.equal(envelope.header.event_id, 'abc');
  assert.deepEqual(envelope.items.map((item) => item.header.type), ['event', 'session']);
  assert.deepEqual(itemsOf(envelope, 'event'), [{ message: 'a\nb' }], 'a payload with a newline in it is cut by its length');
  assert.deepEqual(itemsOf(envelope, 'session'), [{ sid: 's1', status: 'ok' }], 'an item without a length ends at its line');
});

test('a gzip body, which sentry-java sends, is read like a plain one', () => {
  assert.deepEqual(itemsOf(parseEnvelope(gzipSync(envelopeText({ level: 'fatal' }))), 'event'), [{ level: 'fatal' }]);
});

test('the ingest endpoint keeps what is posted to it, with the key from the header or from the query, and refuses the rest', async () => {
  const ingest = await startIngest({ host: '127.0.0.1' });
  const base = `http://127.0.0.1:${ingest.port}`;
  try {
    const viaHeader = await fetch(`${base}/api/7/envelope/`, { method: 'POST', headers: { 'x-sentry-auth': 'Sentry sentry_version=7, sentry_key=hk' }, body: envelopeText({ level: 'fatal' }) });
    const viaQuery = await fetch(`${base}/api/7/envelope/?sentry_key=qk&sentry_version=7`, { method: 'POST', body: gzipSync(envelopeText({ level: 'error' })) });
    assert.equal(viaHeader.status, 200);
    assert.equal(viaQuery.status, 200);
    assert.deepEqual(ingest.received.map(({ project, key }) => [project, key]), [['7', 'hk'], ['7', 'qk']]);
    assert.equal((await fetch(`${base}/elsewhere`, { method: 'POST', body: 'x' })).status, 404);
    assert.equal((await fetch(`${base}/api/7/envelope/`, { method: 'POST', body: 'not an envelope' })).status, 400);
    assert.equal(ingest.received.length, 2, 'what was refused is not kept');
  } finally {
    await ingest.close();
  }
});

test('the crash that was sent passes, and every difference is named', () => {
  assert.deepEqual(crashProblems(arrived(crash()), want), []);

  const wrong = crash({
    sdk: { name: 'sentry.javascript.browser', version: '1.0.0' },
    user: { id: '43', email: 'demo@example.com', username: 'demo' },
    tags: { 'account.region': 'IE', premium: 'true', gone: 'yes' },
    contexts: { account: { animals: 7, premium: true } },
  });
  const problems = crashProblems(arrived(wrong), want).join('\n');
  for (const part of ['sdk.name', 'sdk.version', 'user.id', 'tags.gone (removed with null)', 'contexts.account.animals']) {
    assert.match(problems, new RegExp(part.replaceAll('.', '\\.').replaceAll('(', '\\(').replaceAll(')', '\\)')), part);
  }
  assert.doesNotMatch(problems, /user\.email|exception/, 'what is right is not reported');
});

test('a request with the wrong key or project, an unhandled=true crash or no event at all fails', () => {
  assert.match(crashProblems(arrived(crash(), { key: 'other' }), want).join(), /DSN key/);
  assert.match(crashProblems(arrived(crash(), { project: '2' }), want).join(), /project/);
  const handled = crash();
  handled.exception.values[0].mechanism.handled = true;
  assert.match(crashProblems(arrived(handled), want).join(), /handled/);
  assert.match(crashProblems(arrived(crash({ release: 'e2e@2' })), want).join(), /no event with release e2e@1 arrived/);
  assert.match(crashProblems([], want).join(), /no event at all/);
});

test('the breadcrumbs of the failed plugin calls have to arrive, both, in order, of their shape, as a list or under values', () => {
  assert.deepEqual(crashProblems(arrived(crash({ breadcrumbs: crumbs })), want), [], 'sentry-java sends a plain list');
  const only = (list) => crashProblems(arrived(crash({ breadcrumbs: { values: list } })), want).join('\n');
  assert.match(only(crumbs.slice(0, 2)), /cordova\.plugin breadcrumbs/, 'the one after start is missing');
  assert.match(only([crumbs[0], crumbs[2], crumbs[1]]), /cordova\.plugin breadcrumbs/, 'out of order');
  assert.match(only([...crumbs, crumbs[2]]), /cordova\.plugin breadcrumbs/, 'one twice');
  assert.match(only([crumbs[0], crumbs[1], { ...crumbs[2], level: 'info' }]), /cordova\.plugin breadcrumbs/, 'the level');
  assert.match(only([crumbs[0], crumbs[1], pluginCrumb(PLUGIN_ERRORS[1], '9')]), /numeric data\.status/);
  assert.match(crashProblems(arrived(crash({ breadcrumbs: undefined })), want).join(), /cordova\.plugin breadcrumbs/, 'none at all');
});
