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
  /** Default false. The SDK writes what it is doing to the system log (logcat, the Xcode console). */
  debug?: boolean;
  /**
   * Default true. False turns the crash handling off, which is what reports a crash: the uncaught exception handler, the ANR watch and the
   * NDK integration on Android, the crash handler on iOS. The plugin then reports what the page hands it and nothing the process dies of.
   * It also takes `enableAnrTracking` with it on Android.
   */
  enableNativeCrashHandling?: boolean;
  /** Default true (iOS): the app was killed by the system, with no crash, because it was out of memory or hung. */
  enableWatchdogTerminationTracking?: boolean;
  /** Default false, the SDKs' own: the user's IP address and what else the SDK adds about the user, beyond what `setUser` sets. */
  sendDefaultPii?: boolean;
  /** How many breadcrumbs the scope keeps, the SDKs' default 100. */
  maxBreadcrumbs?: number;
  /** The share of error events that is sent, 0 to 1, default 1. */
  sampleRate?: number;
  /** Default true: an event without an exception gets the stack trace of where it was captured. */
  attachStacktrace?: boolean;
  /** Default false (Android): every event carries the stack traces of all the threads. */
  attachThreads?: boolean;
  /** How long the app has to be in the background before the session is over, in milliseconds. The SDKs' default 30000. */
  sessionTrackingIntervalMillis?: number;
  /** Default true (Android, with the NDK artifact): the scope is kept in sync with the NDK's, so a crash in native code has the user and the tags. */
  enableNdkScopeSync?: boolean;
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

/** The severity of a message, as Sentry names them. */
export type SentrySdkLevel = 'debug' | 'info' | 'warning' | 'error' | 'fatal';

/** What `captureMessage` answers when the message was handed to the SDK. */
export type SentrySdkCaptureAnswer = 'sent';

const LEVELS: readonly string[] = ['debug', 'info', 'warning', 'error', 'fatal'];

/** The level of a breadcrumb. `log` and `critical` are the JavaScript SDK's own: native has `debug` and `fatal` instead, and gets those. */
export type SentrySdkBreadcrumbLevel = 'fatal' | 'critical' | 'error' | 'warning' | 'log' | 'info' | 'debug';

/** A breadcrumb as the JavaScript SDK has it; what the plugin does not read (`event_id`, say) is left out. */
export interface SentrySdkBreadcrumb {
  type?: string;
  category?: string;
  message?: string;
  level?: SentrySdkBreadcrumbLevel;
  /** Seconds since the epoch, as in the JavaScript SDK. Unset, native takes the time of the call. */
  timestamp?: number;
  /** Anything JSON can carry, nested or not. */
  data?: Record<string, unknown>;
}

/** What `addBreadcrumb` answers: `queued` while the SDK is not running, and `start` adds it. */
export type SentrySdkBreadcrumbAnswer = 'added' | 'queued';

/** What `close` answers: `closed`, or `not running` when there was no SDK to close. */
export type SentrySdkCloseAnswer = 'closed' | 'not running';

/**
 * What the system says about the device and the app, as the platforms spell it. It exists because a web view cannot be asked: its user
 * agent is not the truth (see the README), and a page that sets the OS version or the device model on an event should set the real one.
 */
export interface SentrySdkDeviceInfo {
  /** `iOS`, `iPadOS` or `Android`, as the system names itself. */
  osName: string;
  /** The OS version the way the system gives it: `26.3`, `15`. */
  osVersion: string;
  /** iOS: the hardware identifier, `iPhone17,1` (a simulator gives the model it stands in for). Android: the model, `Pixel 10a`. */
  deviceModel: string;
  /** The version a store shows: `CFBundleShortVersionString`, `versionName`. Empty when the app declares none. */
  appRelease: string;
  /** The build number, as text on both: `CFBundleVersion`, `versionCode`. */
  appBuild: string;
}

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

const checkCapture = (message: string, level: SentrySdkLevel): [string, SentrySdkLevel] => {
  if (typeof message !== 'string' || message === '') {
    return refuse('captureMessage needs a message');
  }
  if (!LEVELS.includes(level)) {
    return refuse('captureMessage: the level has to be debug, info, warning, error or fatal');
  }
  return [message, level];
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

// The two platforms read a value of the wrong type differently (Android's JSON reader makes the text "true" a boolean, Swift's cast
// drops it), so a start option that is not what it says is refused here, once. An option that is not given is left to the SDK's default.
const BOOLEAN_OPTIONS = [
  'debug',
  'enableNativeCrashHandling',
  'enableWatchdogTerminationTracking',
  'sendDefaultPii',
  'attachStacktrace',
  'attachThreads',
  'enableNdkScopeSync',
] as const;
const COUNT_OPTIONS = ['maxBreadcrumbs', 'sessionTrackingIntervalMillis'] as const;

const checkStartOptions = (options: SentrySdkStartOptions): SentrySdkStartOptions => {
  if (typeof options !== 'object' || options === null || Array.isArray(options)) {
    return options;
  }
  for (const name of BOOLEAN_OPTIONS) {
    const value: unknown = options[name];
    if (value !== undefined && typeof value !== 'boolean') {
      return refuse(`start: ${name} has to be true or false`);
    }
  }
  for (const name of COUNT_OPTIONS) {
    const value: unknown = options[name];
    if (value !== undefined && (typeof value !== 'number' || !Number.isInteger(value) || value < 0)) {
      return refuse(`start: ${name} has to be a whole number, 0 or more`);
    }
  }
  const rate: unknown = options.sampleRate;
  if (rate !== undefined && (typeof rate !== 'number' || !(rate >= 0 && rate <= 1))) {
    return refuse('start: sampleRate has to be a number from 0 to 1');
  }
  return options;
};

const BREADCRUMB_TEXT_FIELDS = ['type', 'category', 'message'] as const;
const BREADCRUMB_LEVELS: Record<SentrySdkBreadcrumbLevel, string> = {
  fatal: 'fatal',
  critical: 'fatal',
  error: 'error',
  warning: 'warning',
  log: 'debug',
  info: 'info',
  debug: 'debug',
};

// The levels `log` and `critical` do not exist natively, so they are mapped here, once, for both platforms. Data is sent as the JSON it
// is, so a value JSON cannot carry (a cycle, a BigInt) is refused here and not dropped by one platform and kept by the other.
const checkBreadcrumb = (breadcrumb: SentrySdkBreadcrumb): SentrySdkBreadcrumb => {
  if (typeof breadcrumb !== 'object' || breadcrumb === null || Array.isArray(breadcrumb)) {
    return refuse('addBreadcrumb needs an object');
  }
  const checked: SentrySdkBreadcrumb = {};
  for (const field of BREADCRUMB_TEXT_FIELDS) {
    const value: unknown = breadcrumb[field];
    if (value === undefined || value === null) {
      continue;
    }
    if (typeof value !== 'string') {
      return refuse(`addBreadcrumb: ${field} has to be a string`);
    }
    checked[field] = value;
  }
  if (breadcrumb.level !== undefined && breadcrumb.level !== null) {
    if (typeof breadcrumb.level !== 'string' || !Object.prototype.hasOwnProperty.call(BREADCRUMB_LEVELS, breadcrumb.level)) {
      return refuse(`addBreadcrumb: level has to be one of ${Object.keys(BREADCRUMB_LEVELS).join(', ')}`);
    }
    checked.level = BREADCRUMB_LEVELS[breadcrumb.level] as SentrySdkBreadcrumbLevel;
  }
  if (breadcrumb.timestamp !== undefined && breadcrumb.timestamp !== null) {
    if (typeof breadcrumb.timestamp !== 'number' || !Number.isFinite(breadcrumb.timestamp)) {
      return refuse('addBreadcrumb: timestamp has to be a number of seconds');
    }
    checked.timestamp = breadcrumb.timestamp;
  }
  if (breadcrumb.data !== undefined && breadcrumb.data !== null) {
    if (typeof breadcrumb.data !== 'object' || Array.isArray(breadcrumb.data)) {
      return refuse('addBreadcrumb: data has to be an object');
    }
    try {
      checked.data = JSON.parse(JSON.stringify(breadcrumb.data));
    } catch {
      return refuse('addBreadcrumb: data cannot be sent as JSON');
    }
  }
  return checked;
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
export const start = async (options: SentrySdkStartOptions) => call<SentrySdkStartAnswer>('start', checkStartOptions(options));

/** Sets the user on the native scope, or clears it with `null`. */
export const setUser = async (user: SentrySdkUser | null) => call<SentrySdkUserAnswer>('setUser', checkUser(user));

/** Sets tags on the native scope; a `null` value removes that tag. */
export const setTags = async (tags: Record<string, SentrySdkTagValue>) => call<SentrySdkScopeAnswer>('setTags', checkTags(tags));

/** Sets a context (a named object) on the native scope, or removes it with `null`. */
export const setContext = async (key: string, value: Record<string, unknown> | null) =>
  call<SentrySdkScopeAnswer>('setContext', ...checkContext(key, value));

/**
 * Adds a breadcrumb to the native scope, so a native crash carries what the page did before it. While the SDK is not running it is
 * kept, in order and up to the last hundred, and `start` adds them.
 */
export const addBreadcrumb = async (breadcrumb: SentrySdkBreadcrumb) =>
  call<SentrySdkBreadcrumbAnswer>('addBreadcrumb', checkBreadcrumb(breadcrumb));

/** Clears the native scope's breadcrumbs, and the ones kept for `start`. */
export const clearBreadcrumbs = () => call<'cleared'>('clearBreadcrumbs');

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

/** Reads the OS, the device and the app from the system. Needs no running SDK, and changes nothing. */
export const getDeviceInfo = () => call<SentrySdkDeviceInfo>('getDeviceInfo');

/**
 * Sends a message event at the given level (default `info`). Unlike a scope change it is not queued: a message needs the SDK running,
 * and while it is not, the promise rejects with the reason, so the caller knows it was not sent.
 */
export const captureMessage = async (message: string, level: SentrySdkLevel = 'info') =>
  call<SentrySdkCaptureAnswer>('captureMessage', ...checkCapture(message, level));

/** Crashes the process natively, when `start` was given `allowCrash: true`. For a device probe, never for the app: the promise never settles, the app is gone. */
export const crash = () => call<never>('crash');
