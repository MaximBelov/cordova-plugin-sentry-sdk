import { itemsOf } from './envelope.mjs';

/**
 * What the crash the demo app raises has to look like when it arrives. Returns the problems, one sentence each; none is a pass.
 * `want` is what the demo was told to send: the DSN's key and project, the release and environment, and the SDK the plugin installs.
 */
export function crashProblems(received, want) {
  const events = received.flatMap(({ envelope, key, project }) =>
    itemsOf(envelope, 'event').map((event) => ({ event, key, project })),
  );
  const found = events.find(({ event }) => event.release === want.release);
  if (!found) {
    const seen = events.map(({ event }) => `${event.release ?? 'no release'}`).join(', ') || 'no event at all';
    return [`no event with release ${want.release} arrived (${received.length} envelope(s); events: ${seen})`];
  }
  const { event } = found;
  const problems = [];
  const check = (what, actual, expected) => {
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      problems.push(`${what}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
    }
  };
  check('the DSN key the request carried', found.key, want.key);
  check('the project the request went to', found.project, want.project);
  check('sdk.name', event.sdk?.name, want.sdkName);
  check('sdk.version', event.sdk?.version, want.sdkVersion);
  check('environment', event.environment, want.environment);
  check('level', event.level, 'fatal');
  const exception = event.exception?.values?.at(-1);
  check('exception.type', exception?.type, want.exception.type);
  if (!String(exception?.value ?? '').includes(want.exception.valueIncludes)) {
    problems.push(`exception.value: expected to include ${JSON.stringify(want.exception.valueIncludes)}, got ${JSON.stringify(exception?.value)}`);
  }
  check('exception.mechanism.handled', exception?.mechanism?.handled, false);
  for (const field of ['id', 'email', 'username']) {
    check(`user.${field}`, event.user?.[field], want.user[field]);
  }
  for (const [tag, value] of Object.entries(want.tags)) {
    check(`tags.${tag}`, event.tags?.[tag], value);
  }
  for (const tag of want.absentTags) {
    check(`tags.${tag} (removed with null)`, event.tags?.[tag], undefined);
  }
  for (const [context, values] of Object.entries(want.contexts)) {
    for (const [name, value] of Object.entries(values)) {
      check(`contexts.${context}.${name}`, event.contexts?.[context]?.[name], value);
    }
  }
  // A breadcrumb's data is read by the fields the demo knows (the status code is the platform's own), and in the order they were made.
  const list = Array.isArray(event.breadcrumbs) ? event.breadcrumbs : event.breadcrumbs?.values ?? [];
  const crumbs = list.filter((crumb) => crumb?.category === 'cordova.plugin');
  const seen = crumbs.map((crumb) => ({
    category: crumb.category,
    level: crumb.level,
    message: crumb.message,
    service: crumb.data?.service,
    error: crumb.data?.error,
  }));
  check('the cordova.plugin breadcrumbs', seen, want.pluginErrors ?? []);
  if (crumbs.some((crumb) => typeof crumb.data?.status !== 'number')) {
    problems.push(`every cordova.plugin breadcrumb has a numeric data.status, got ${JSON.stringify(crumbs.map((crumb) => crumb.data?.status))}`);
  }
  return problems;
}
