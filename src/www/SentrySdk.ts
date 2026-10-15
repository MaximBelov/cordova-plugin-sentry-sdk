/**
 * cordova-plugin-sentry-sdk
 *
 * The native Sentry SDKs, started and kept in sync from the page. Errors in the page go through
 * `@sentry/angular` on their own; this plugin only owns what the page cannot see: a native crash,
 * an app hang, a watchdog termination, an ANR. Every call returns a promise.
 */
declare const cordova: {
  exec(
    success: (result: unknown) => void,
    failure: (error: string) => void,
    service: string,
    action: string,
    args: unknown[],
  ): void;
};

const SERVICE = 'SentrySdk';

export interface SentrySdkStartOptions {
  dsn: string;
  /** The same value the JS SDK reports, so native and JS events of one build land on one release. */
  release?: string;
  environment?: string;
  dist?: string;
  /**
   * Default true. A hang is a main thread blocked for `appHangTimeoutInterval` seconds (iOS only).
   * @deprecated sentry-cocoa removes app hang tracking in v10 and points at MetricKit (`enableMetricKit`) instead.
   */
  enableAppHangTracking?: boolean;
  /**
   * Seconds, default 2 on the SDK. iOS only.
   * @deprecated Goes with `enableAppHangTracking`: sentry-cocoa removes both in v10.
   */
  appHangTimeoutInterval?: number;
  /**
   * Default FALSE here, against the SDK's true. The SDK watches the requests the app's own code makes (another plugin's HTTP calls, for
   * one); a request the page makes is made by WebKit's own processes and is not among them. iOS only.
   */
  enableCaptureFailedRequests?: boolean;
  /**
   * MetricKit diagnostics (hangs, CPU and disk-write exceptions) delivered by the system. Unset, the SDK's own default applies: false
   * in sentry-cocoa 9, true in 10. iOS only.
   */
  enableMetricKit?: boolean;
  /** Default true: sessions and the crash-free rate per release. */
  enableAutoSessionTracking?: boolean;
  /** Default true (Android): an ANR is reported as an event. */
  enableAnrTracking?: boolean;
  /**
   * Default false: `crash()` is refused. It takes the process down, so it is for a device test, and the page has to say so here, which
   * keeps a stray call from ending the app. The last accepted `start` decides.
   */
  allowCrash?: boolean;
}

export interface SentrySdkUser {
  id?: string;
  email?: string;
  username?: string;
}

/** A tag value; `null` removes the tag. */
export type SentrySdkTagValue = string | number | boolean | null;

/** What `start` answers: `started`, or `already started` when the SDK was running before, whoever started it. */
export type SentrySdkStartAnswer = 'started' | 'already started';

/** What `setUser` answers: `queued` while the SDK is not running, and `start` applies it. */
export type SentrySdkUserAnswer = 'set' | 'cleared' | 'queued';

/** What `setTags`, `setContext` and `setExtras` answer: `queued` while the SDK is not running, and `start` applies it. */
export type SentrySdkScopeAnswer = 'set' | 'queued';

/** What `close` answers: `closed`, or `not running` when there was no SDK to close. */
export type SentrySdkCloseAnswer = 'closed' | 'not running';

const call = <T>(action: string, ...args: unknown[]) =>
  new Promise<T>((resolve, reject) => cordova.exec((r) => resolve(r as T), reject, SERVICE, action, args));

/** A refusal reaches the page the way native's do: the promise rejects, with the reason as a string. */
const refuse = (reason: string): never => {
  throw reason;
};

const USER_FIELDS = ['id', 'email', 'username'] as const;

// What native makes of a value it did not expect is not the same on the two platforms (a number is its text on Android and dropped
// on iOS, a JSON null is the text "null" on one and nothing on the other, an array is a removal on both), so what is settled here is
// settled once: a number becomes its text, an empty string and null are left out, and anything else is refused.
const checkUser = (user: SentrySdkUser | null): SentrySdkUser | null => {
  if (user === null) {
    return null;
  }
  if (typeof user !== 'object' || Array.isArray(user)) {
    return refuse('setUser needs an object or null');
  }
  const checked: SentrySdkUser = {};
  for (const field of USER_FIELDS) {
    const value: unknown = user[field];
    if (value === undefined || value === null || value === '') {
      continue;
    }
    if (typeof value === 'string') {
      checked[field] = value;
    } else if (typeof value === 'number' && Number.isFinite(value)) {
      checked[field] = String(value);
    } else {
      return refuse(`setUser: ${field} has to be a string or a number`);
    }
  }
  return checked;
};

const checkTags = (tags: Record<string, SentrySdkTagValue>): Record<string, SentrySdkTagValue> => {
  if (typeof tags !== 'object' || tags === null || Array.isArray(tags)) {
    return refuse('setTags needs an object');
  }
  for (const [key, value] of Object.entries(tags)) {
    const fine = value === null || typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value));
    if (!fine) {
      return refuse(`setTags: the value of ${key} has to be a string, a number, a boolean or null`);
    }
  }
  return tags;
};

const checkContext = (key: string, value: Record<string, unknown> | null): [string, Record<string, unknown> | null] => {
  if (typeof key !== 'string' || key === '') {
    return refuse('setContext needs a key');
  }
  if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
    return refuse('setContext needs an object or null');
  }
  return [key, value];
};

// An extra is text on Android (sentry-android's scope takes a string), so what is settled here, once, is that it is text on both: a string
// stays as it is, `null` and `undefined` remove the extra (an undefined value would be dropped by the JSON the bridge sends, and the key
// with it), and anything else is its JSON.
const checkExtras = (extras: Record<string, unknown>): Record<string, string | null> => {
  if (typeof extras !== 'object' || extras === null || Array.isArray(extras)) {
    return refuse('setExtras needs an object');
  }
  const checked: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(extras)) {
    if (value === undefined || value === null) {
      checked[key] = null;
    } else if (typeof value === 'string') {
      checked[key] = value;
    } else {
      let text: string | undefined;
      try {
        text = JSON.stringify(value);
      } catch {
        return refuse(`setExtras: the value of ${key} cannot be sent as JSON`);
      }
      if (text === undefined) {
        return refuse(`setExtras: the value of ${key} cannot be sent as JSON`);
      }
      checked[key] = text;
    }
  }
  return checked;
};

/** Starts the native SDK. Call once, after `deviceready`; a second call is answered without restarting. */
export const start = (options: SentrySdkStartOptions) => call<SentrySdkStartAnswer>('start', options);

/** Sets the user on the native scope, or clears it with `null`. */
export const setUser = async (user: SentrySdkUser | null) => call<SentrySdkUserAnswer>('setUser', checkUser(user));

/** Sets tags on the native scope; a `null` value removes that tag. */
export const setTags = async (tags: Record<string, SentrySdkTagValue>) => call<SentrySdkScopeAnswer>('setTags', checkTags(tags));

/** Sets a context (a named object) on the native scope, or removes it with `null`. */
export const setContext = async (key: string, value: Record<string, unknown> | null) =>
  call<SentrySdkScopeAnswer>('setContext', ...checkContext(key, value));

/**
 * Sets extras on the native scope: each value is its text on both platforms (a string as it is, anything else as JSON), and `null` or
 * `undefined` removes the extra. Extras are the older, flatter relative of a context; prefer `setContext`.
 */
export const setExtras = async (extras: Record<string, unknown>) => call<SentrySdkScopeAnswer>('setExtras', checkExtras(extras));

/**
 * Stops the native SDK, flushing what it holds. A later `start` starts it again, and what the page set while it was down is kept for that
 * start. `allowCrash` is taken back: the next `start` has to give it again.
 */
export const close = () => call<SentrySdkCloseAnswer>('close');

/** Whether the native SDK is running, whoever started it. */
export const isEnabled = () => call<boolean>('isEnabled');

/** Crashes the process natively, when `start` was given `allowCrash: true`. For a device probe, never for the app: the promise never settles, the app is gone. */
export const crash = () => call<never>('crash');
