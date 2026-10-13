export interface SentryNativeStartOptions {
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
export interface SentryNativeUser {
    id?: string;
    email?: string;
    username?: string;
}
/** A tag value; `null` removes the tag. */
export type SentryNativeTagValue = string | number | boolean | null;
/** Starts the native SDK. Call once, after `deviceready`; a second call is answered without restarting. */
export declare const start: (options: SentryNativeStartOptions) => Promise<void>;
/** Sets the user on the native scope, or clears it with `null`. */
export declare const setUser: (user: SentryNativeUser | null) => Promise<void>;
/** Sets tags on the native scope; a `null` value removes that tag. */
export declare const setTags: (tags: Record<string, SentryNativeTagValue>) => Promise<void>;
/** Sets a context (a named object) on the native scope, or removes it with `null`. */
export declare const setContext: (key: string, value: Record<string, unknown> | null) => Promise<void>;
/** Crashes the process natively. For a device probe, never for the app: the promise never resolves. */
export declare const crash: () => Promise<void>;
