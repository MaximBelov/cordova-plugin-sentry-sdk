# cordova-plugin-sentry-sdk

Starts the native Sentry SDKs ([sentry-cocoa](https://github.com/getsentry/sentry-cocoa),
[sentry-android](https://github.com/getsentry/sentry-java)) in a Cordova app through their **public
API only**, and keeps the user, tags and contexts your JavaScript SDK sets in sync with them. That
is the whole plugin: a native crash, an app hang, a watchdog termination or an ANR reaches Sentry
with the same user and tags as the page's own events.

It deliberately does **not** route the page's events through the native SDK. Use the Sentry
JavaScript SDK of your framework (`@sentry/browser`, `@sentry/angular`, ...) for everything that
happens in the web view, with its own transport, integrations and source maps; this plugin only owns
what the page cannot see.

Why not [sentry-cordova](https://github.com/getsentry/sentry-cordova)? Sentry archived it in 2026.
Its bridge sends the JavaScript envelopes through the native SDK's cache, reaches into private
hybrid-SDK headers that every major version of sentry-cocoa reshuffles, and its last release
replaced the browser SDK's default integrations with its own. A plugin that calls only
`SentrySDK.start`, `setUser` and `configureScope` has nothing to break on the next major.

## Install

```sh
cordova plugin add cordova-plugin-sentry-sdk
```

`SENTRY_ANDROID_SDK_VERSION` (default `8.52.0`) picks `io.sentry:sentry-android` from Maven; Kotlin must
be enabled in the Android build (`<preference name="GradlePluginKotlinEnabled" value="true" />`).
On iOS the plugin is a Swift package (cordova-ios 8+): `Package.swift` pins sentry-cocoa, which SPM
serves as a prebuilt xcframework, so nothing is compiled from source and no CocoaPods is involved.

## Use

```ts
document.addEventListener('deviceready', async () => {
  await window.SentryNative.start({
    dsn: '<your dsn>',
    release: 'my-app@1.2.3',   // the same value the JavaScript SDK reports
    environment: 'production',
    appHangTimeoutInterval: 7, // iOS: seconds of a blocked main thread before a hang is reported
  });
  await window.SentryNative.setUser({ id: '42', email: 'user@example.com' });
  await window.SentryNative.setTags({ 'account.region': 'IE', plan: 'pro' });
  await window.SentryNative.setContext('account', { animals: 120, premium: true });
});
```

| Call | What it does |
| --- | --- |
| `start(options)` | `SentrySDK.start` / `SentryAndroid.init` with the DSN, release, environment and dist. A second call answers "already started" and changes nothing. |
| `setUser(user \| null)` | sets or clears the user on the native scope |
| `setTags({ key: value \| null })` | sets tags; a `null` value removes the tag |
| `setContext(key, object \| null)` | sets or removes a named context |
| `crash()` | crashes the process natively. For a device test only; the promise never resolves |

### Options

| Option | Default | Platform |
| --- | --- | --- |
| `dsn` | required | both |
| `release`, `environment`, `dist` | unset | both |
| `enableAutoSessionTracking` | `true` | both |
| `enableAppHangTracking` | `true` | iOS |
| `appHangTimeoutInterval` | the SDK's `2` | iOS |
| `enableCaptureFailedRequests` | **`false`** (the SDK's default is `true`; in a web view it turns every failed HTTP request into an event) | iOS |
| `enableAnrTracking` | `true` | Android |

## What arrives, and what does not

Native events carry the native SDK's own device and OS contexts plus whatever you set through this
plugin. They are separate from the page's events: no shared trace, no shared breadcrumbs, and the
session (crash-free rate) is counted per SDK. If that matters to you, you want a hybrid SDK such as
[sentry-capacitor](https://github.com/getsentry/sentry-capacitor), not this plugin.

## Verifying on a device

`crash()` kills the process; the native SDK sends the report on the **next launch**, so relaunch the
app and wait a few seconds before looking in Sentry. Native stack traces need the debug symbols
uploaded (`sentry-cli debug-files upload`), which this plugin does not do.

## Licence

Apache-2.0
