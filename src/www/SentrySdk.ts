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
  /** Default true. A hang is a main thread blocked for `appHangTimeoutInterval` seconds (iOS only). */
  enableAppHangTracking?: boolean;
  /** Seconds, default 2 on the SDK. iOS only. */
  appHangTimeoutInterval?: number;
  /** Default FALSE here, against the SDK's true: in a web view every failed HTTP request would become an event. iOS only. */
  enableCaptureFailedRequests?: boolean;
  /** Default true: sessions and the crash-free rate per release. */
  enableAutoSessionTracking?: boolean;
  /** Default true (Android): an ANR is reported as an event. */
  enableAnrTracking?: boolean;
}

export interface SentrySdkUser {
  id?: string;
  email?: string;
  username?: string;
}

/** A tag value; `null` removes the tag. */
export type SentrySdkTagValue = string | number | boolean | null;

const call = <T = void>(action: string, ...args: unknown[]) =>
  new Promise<T>((resolve, reject) => cordova.exec((r) => resolve(r as T), reject, SERVICE, action, args));

/** Starts the native SDK. Call once, after `deviceready`; a second call is answered without restarting. */
export const start = (options: SentrySdkStartOptions) => call('start', options);

/** Sets the user on the native scope, or clears it with `null`. */
export const setUser = (user: SentrySdkUser | null) => call('setUser', user);

/** Sets tags on the native scope; a `null` value removes that tag. */
export const setTags = (tags: Record<string, SentrySdkTagValue>) => call('setTags', tags);

/** Sets a context (a named object) on the native scope, or removes it with `null`. */
export const setContext = (key: string, value: Record<string, unknown> | null) => call('setContext', key, value);

/** Crashes the process natively. For a device probe, never for the app: the promise never resolves. */
export const crash = () => call('crash');
