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
/** What `setTags` and `setContext` answer: `queued` while the SDK is not running, and `start` applies it. */
export type SentrySdkScopeAnswer = 'set' | 'queued';
/** Starts the native SDK. Call once, after `deviceready`; a second call is answered without restarting. */
export declare const start: (options: SentrySdkStartOptions) => Promise<SentrySdkStartAnswer>;
/** Sets the user on the native scope, or clears it with `null`. */
export declare const setUser: (user: SentrySdkUser | null) => Promise<SentrySdkUserAnswer>;
/** Sets tags on the native scope; a `null` value removes that tag. */
export declare const setTags: (tags: Record<string, SentrySdkTagValue>) => Promise<SentrySdkScopeAnswer>;
/** Sets a context (a named object) on the native scope, or removes it with `null`. */
export declare const setContext: (key: string, value: Record<string, unknown> | null) => Promise<SentrySdkScopeAnswer>;
/** Crashes the process natively, when `start` was given `allowCrash: true`. For a device probe, never for the app: the promise never settles, the app is gone. */
export declare const crash: () => Promise<never>;
