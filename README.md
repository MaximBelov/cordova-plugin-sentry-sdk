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

## Supported platforms

| Platform | SDK | How it is taken | Minimum |
| --- | --- | --- | --- |
| iOS | sentry-cocoa 9.30.1 | Swift package (`Package.swift`), prebuilt xcframework from SPM; no CocoaPods, no Carthage | cordova-ios 8, iOS 15, Xcode 26 |
| Android | sentry-android 8.60.0 | `io.sentry:sentry-android` from Maven (`SENTRY_ANDROID_SDK_VERSION`) | cordova-android 12, Kotlin enabled |

The plugin enables Kotlin in the Android build and sets the iOS deployment target to 15.0 through its own `plugin.xml`
(an app that declares a higher target inside its `<platform name="ios">` block keeps it). The CocoaPods trunk stopped
at sentry-cocoa 9.19.1, which is why iOS is a Swift package. Xcode 26 is needed because SwiftPM 6.1 (Xcode 16.4) refuses
sentry-cocoa 9.x pinned by version: the manifest it reads depends on KSCrash by revision, which SwiftPM 6.2 leaves out as
unused and 6.1 does not.

## Installing

```sh
cordova plugin add cordova-plugin-sentry-sdk
```

Variables: `SENTRY_ANDROID_SDK_VERSION` (default `8.60.0`). The iOS version is pinned in `Package.swift`.

## Names

Every name derives from the plugin id, `cordova-plugin-sentry-sdk`, the way the fixture plugins of cordova-android derive theirs
(`cordova-plugin-fake` is `Fake`, `dummyplugin` is a class `DummyPlugin` in a package ending in `dummyplugin`), and both platforms use the
same ones:

| What | Name |
| --- | --- |
| plugin `<name>`, JS module, `cordova.exec` service, `<feature>` | `SentrySdk` |
| global | `window.SentrySdk` |
| iOS class (`ios-package`), Swift target | `SentrySdk` |
| Android class and package (`android-package`) | `io.github.maximbelov.sentrysdk.SentrySdk` |

## Use

```ts
document.addEventListener('deviceready', async () => {
  await window.SentrySdk.start({
    dsn: '<your dsn>',
    release: 'my-app@1.2.3',   // the same value the JavaScript SDK reports
    environment: 'production',
    appHangTimeoutInterval: 7, // iOS: seconds of a blocked main thread before a hang is reported
  });
  await window.SentrySdk.setUser({ id: '42', email: 'user@example.com' });
  await window.SentrySdk.setTags({ 'account.region': 'IE', plan: 'pro' });
  await window.SentrySdk.setContext('account', { animals: 120, premium: true });
});
```

Every call returns a promise. Native answers through Cordova's callbacks, and a refused call (no DSN,
no key) rejects with the reason as a string. Types ship in `types/index.d.ts` (`window.SentrySdk`).

# API

- [SentrySdk.start](#start)
- [SentrySdk.setUser](#setUser)
- [SentrySdk.setTags](#setTags)
- [SentrySdk.setContext](#setContext)
- [SentrySdk.crash](#crash)

## start

`start(options): Promise<string>`

`SentrySDK.start` / `SentryAndroid.init` with the options below. Answers `started`; a second call
answers `already started` and changes nothing. Call it once, after `deviceready`, on **every
launch**: sentry-cocoa sends a crash report on the next start of the SDK, so an app that starts it
only sometimes loses the crashes in between.

| Option | Default | Platform |
| --- | --- | --- |
| `dsn` | required | both |
| `release`, `environment`, `dist` | unset | both |
| `enableAutoSessionTracking` | `true` | both |
| `enableAppHangTracking` | `true` | iOS |
| `appHangTimeoutInterval` | the SDK's `2` | iOS |
| `enableCaptureFailedRequests` | **`false`** (the SDK's default is `true`; in a web view it turns every failed HTTP request into an event) | iOS |
| `enableAnrTracking` | `true` | Android |

## setUser

`setUser(user | null): Promise<string>`

Sets the user on the native scope (`id`, `email`, `username`), or clears it with `null`. Answers
`set` or `cleared`.

## setTags

`setTags({ key: value | null }): Promise<string>`

Sets tags on the native scope; a `null` value removes that tag. A boolean reaches Sentry as `true`
or `false`, a number as its text. Answers `set`.

## setContext

`setContext(key, object | null): Promise<string>`

Sets a named context (an object) on the native scope, or removes it with `null`. Answers `set`.

## crash

`crash(): Promise<never>`

Crashes the process natively: `SentrySDK.crash()` on iOS, an uncaught exception on the main thread
on Android. For a device test only; the promise never resolves, the app is gone. The native SDK
sends the report on the **next launch**, so relaunch and start the SDK again before looking in Sentry.

## What arrives, and what does not

Native events carry the native SDK's own device and OS contexts plus whatever you set through this
plugin. They are separate from the page's events: no shared trace, no shared breadcrumbs, and the
session (crash-free rate) is counted per SDK. If that matters to you, you want a hybrid SDK such as
[sentry-capacitor](https://github.com/getsentry/sentry-capacitor), not this plugin.

Native stack traces need the debug symbols uploaded (`sentry-cli debug-files upload`), which this
plugin does not do.

# Development

```sh
npm install
npm test                      # the JavaScript on Node: the API, the parity of the two platforms and the README, the device tests
npm run test:ios              # the Swift against cordova-ios and sentry-cocoa, XCTest on a simulator (test/ios)
npm run test:android          # the Kotlin against cordova-android and sentry-android, JVM with Robolectric (test/android)
npm run test:e2e:android:build && npm run test:e2e:android   # the demo app crashes itself on a device or an emulator and its report is read (test/e2e)
npm run test:paramedic:ios:simulator      # tests/ in an app on a simulator (cordova-paramedic)
npm run test:paramedic:android:emulator   # the same on an emulator (ANDROID_AVD=<name>)
```

| Path | What |
| --- | --- |
| `src/ios/SentrySdk.swift`, `Package.swift` | the iOS plugin, a Swift package: cordova-ios 8 links it, SPM brings sentry-cocoa |
| `src/android/SentrySdk.kt` | the Android plugin |
| `src/www/SentrySdk.ts` | the TypeScript wrapper (promises); compiled into `www/` (committed) with `npm run build` |
| `types/index.d.ts` | the `window.SentrySdk` global |
| `tests/` | the test plugin for cordova-paramedic (`defineAutoTests`, and the crash as a manual test) |
| `test/unit/` | `node --test`, no device: the JavaScript, the parity test, and `tests/` run against a fake native |
| `test/ios/`, `test/android/` | the native code compiled and tested for real, without an app |
| `test/coverage/` | the coverage floors each layer holds |
| `demo/` | a Cordova app with one button per call, for a phone |

A release is a version bump in `package.json`, `plugin.xml` and `tests/`, merged to `main`: CI runs the
tests and publishes the new version to npm through trusted publishing (no stored token).

## Licence

Apache-2.0
