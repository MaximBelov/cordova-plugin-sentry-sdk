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
/** Starts the native SDK. Call once, after `deviceready`; a second call is answered without restarting. */
export declare const start: (options: SentrySdkStartOptions) => Promise<SentrySdkStartAnswer>;
/** Sets the user on the native scope, or clears it with `null`. */
export declare const setUser: (user: SentrySdkUser | null) => Promise<SentrySdkUserAnswer>;
/** Sets tags on the native scope; a `null` value removes that tag. */
export declare const setTags: (tags: Record<string, SentrySdkTagValue>) => Promise<SentrySdkScopeAnswer>;
/** Sets a context (a named object) on the native scope, or removes it with `null`. */
export declare const setContext: (key: string, value: Record<string, unknown> | null) => Promise<SentrySdkScopeAnswer>;
/**
 * Adds a breadcrumb to the native scope, so a native crash carries what the page did before it. While the SDK is not running it is
 * kept, in order and up to the last hundred, and `start` adds them.
 */
export declare const addBreadcrumb: (breadcrumb: SentrySdkBreadcrumb) => Promise<SentrySdkBreadcrumbAnswer>;
/** Clears the native scope's breadcrumbs, and the ones kept for `start`. */
export declare const clearBreadcrumbs: () => Promise<"cleared">;
/**
 * Sets extras on the native scope: each value is its text on both platforms (a string as it is, anything else as JSON), and `null` or
 * `undefined` removes the extra. Extras are the older, flatter relative of a context; prefer `setContext`.
 */
export declare const setExtras: (extras: Record<string, unknown>) => Promise<SentrySdkScopeAnswer>;
/**
 * Stops the native SDK, flushing what it holds. A later `start` starts it again, and what the page set while it was down is kept for that
 * start. `allowCrash` is taken back: the next `start` has to give it again.
 */
export declare const close: () => Promise<SentrySdkCloseAnswer>;
/** Whether the native SDK is running, whoever started it. */
export declare const isEnabled: () => Promise<boolean>;
/** Reads the OS, the device and the app from the system. Needs no running SDK, and changes nothing. */
export declare const getDeviceInfo: () => Promise<SentrySdkDeviceInfo>;
/** Crashes the process natively, when `start` was given `allowCrash: true`. For a device probe, never for the app: the promise never settles, the app is gone. */
export declare const crash: () => Promise<never>;
