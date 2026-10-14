// What an app's TypeScript sees of `window.SentrySdk`, written the way an app writes it. test/unit/types.test.mjs compiles this with
// `tsc --noEmit`: a line has to compile, and a line under `@ts-expect-error` has to FAIL to, so the shipped declarations are held from
// both sides: too narrow and too wide both break it.
export {};

const sdk = window.SentrySdk;

// The global only exists inside a Cordova app, so it is optional and the app has to say what it does without it.
// @ts-expect-error `window.SentrySdk` can be undefined
void sdk.start({ dsn: 'x' });

async function app(): Promise<void> {
  if (!sdk) {
    return;
  }

  const started: 'started' | 'already started' = await sdk.start({
    dsn: 'https://key@example.com/1',
    release: 'app@1.2.3',
    environment: 'production',
    dist: '7',
    enableAutoSessionTracking: true,
    enableAnrTracking: true,
    enableCaptureFailedRequests: false,
    enableMetricKit: true,
  });
  // @ts-expect-error start answers `started` or `already started`, never `set`
  const wrongStart: 'set' = await sdk.start({ dsn: 'x' });
  // @ts-expect-error a dsn is required
  await sdk.start({});

  const user: 'set' | 'cleared' | 'queued' = await sdk.setUser({ id: '42', email: 'user@example.com', username: 'user' });
  const cleared: 'set' | 'cleared' | 'queued' = await sdk.setUser(null);
  // @ts-expect-error a user is an object or null
  await sdk.setUser('42');

  const tags: 'set' | 'queued' = await sdk.setTags({ plan: 'pro', beta: true, build: 7, gone: null });
  // @ts-expect-error `cleared` is an answer of setUser only
  const wrongTags: 'cleared' = await sdk.setTags({});
  // @ts-expect-error a tag value is a string, a number, a boolean or null
  await sdk.setTags({ nested: { a: 1 } });

  const context: 'set' | 'queued' = await sdk.setContext('account', { animals: 120, premium: true });
  const removed: 'set' | 'queued' = await sdk.setContext('account', null);
  // @ts-expect-error a context is an object or null
  await sdk.setContext('account', 'text');

  // The process is gone, so the promise never settles: `never`, not `void`.
  const crashed: never = await sdk.crash();

  void [started, wrongStart, user, cleared, tags, wrongTags, context, removed, crashed];
}

void app;
