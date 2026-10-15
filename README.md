# cordova-plugin-sentry-sdk

Starts the native Sentry SDKs ([sentry-cocoa](https://github.com/getsentry/sentry-cocoa),
[sentry-android](https://github.com/getsentry/sentry-java)) in a Cordova app through their **public
API only**, and keeps the user, tags and contexts your JavaScript SDK sets in sync with them. That
is the whole plugin: what goes wrong in native code (a crash, an app hang, a watchdog termination, an
ANR) reaches Sentry with the user and tags the page set.

It deliberately does **not** route the page's events through the native SDK. Use the Sentry
JavaScript SDK of your framework (`@sentry/browser`, `@sentry/angular`, ...) for everything that
happens in the web view, with its own transport, integrations and source maps; this plugin only owns
what the page cannot see.

Why not [sentry-cordova](https://github.com/getsentry/sentry-cordova)? Sentry archived it in March 2026
(its last release, 1.7.3, is from October 2025). Its iOS code pushes the page's envelopes through the
native SDK with `PrivateSentrySDKOnly` and imports private headers (`SentryOptionsInternal.h`), and
sentry-cocoa replaced `PrivateSentrySDKOnly` with `SentrySDK.internal` in 9.19.0, a minor release
([changelog](https://github.com/getsentry/sentry-cocoa/blob/9.30.2/CHANGELOG.md)), and 9.30.2 no longer contains it. A
plugin built that way moves with every such change. This one calls only the public API of the two SDKs
(`SentrySDK.start`, `setUser`, `configureScope`; `SentryAndroid.init`, `Sentry.setUser`, `setTag`,
`configureScope`), so a new major of an SDK changes what it calls, not what it reaches into.

## Supported platforms

| Platform | SDK | How it is taken | Minimum |
| --- | --- | --- | --- |
| iOS | sentry-cocoa 9.30.2 | Swift package (`Package.swift`), prebuilt xcframework from SPM; no CocoaPods, no Carthage | cordova-ios 8.0.1, iOS 15, Xcode 26 |
| Android | sentry-android 8.61.0 | `io.sentry:sentry-android-core` from Maven (`SENTRY_ANDROID_SDK_VERSION`, `SENTRY_ANDROID_ARTIFACT`) | cordova-android 15.1.0 |

What the minimums rest on:

- **cordova-ios 8.0.1.** On 8.0.0 the build fails when the plugin is already in the project as the platform is added, which is
  what `cordova prepare` does on a fresh clone: the app's deployment target becomes 15, the plugins' Swift package stays at iOS 13,
  and SwiftPM refuses it with `The package product 'cordova-plugin-sentry-sdk' requires minimum platform version 15.0 for the iOS
  platform, but this target supports 13.0`. Added after the platform, the plugin builds on 8.0.0. 8.0.1 builds in both orders and
  passed the end-to-end test (built by hand; its release notes list the fixes, GH-1612 and GH-1616). CI builds with the newest 8.x.
- **cordova-android 15.1.0.** The oldest release the tests build with: Gradle 8.14.2, Android Gradle plugin 8.10.1 and Kotlin
  2.1.21, which are its own defaults, and the JVM tests are held to the same versions. Older releases ship older tools (14.0.1
  defaults to Kotlin 1.9.24) and are not built here.
- **iOS 15 and Xcode 26.** sentry-cocoa 9 needs iOS 15. Resolving sentry-cocoa 9.30.1 with Xcode 16.4 (SwiftPM 6.1) failed with
  `'sentry-cocoa' is required using a stable-version but 'sentry-cocoa' depends on an unstable-version package 'kscrash'`
  (GitHub Actions run 38413045350, whose log is no longer available), and Xcode 26 resolved it. Why they differ is not
  established: the manifests sentry-cocoa ships for SwiftPM 6.1 and 6.2 declare that dependency the same way.
- **A Swift package, not CocoaPods.** The newest `Sentry` pod on the CocoaPods trunk is 9.19.1, published on 2026-07-01
  (checked on 2026-10-14 at `https://trunk.cocoapods.org/api/v1/pods/Sentry`), while sentry-cocoa is at 9.30.2.

What the plugin asks of the app's build, and what the app keeps:

- **Android** turns Kotlin on (`GradlePluginKotlinEnabled`) and leaves the version to cordova-android's default (2.1.21 in
  15.1.0) or to the app's `GradlePluginKotlinVersion`. Without Kotlin the plugin is not compiled and the build stays green, and
  then every call hangs.
- **iOS** sets the deployment target to 15.0 for an app that declares none. An app that declares its own
  `<preference name="deployment-target">` keeps it, at the root of its `config.xml` or inside `<platform name="ios">`: cordova
  merges the app's `config.xml` over the plugins' changes, and the later preference wins. A value below 15 fails the build.
- `Package.swift` depends on cordova-ios's `master` branch, as the cordova-ios plugin guide prescribes, and an app does not
  fetch it: cordova-ios rewrites that dependency to the app's own `CordovaLib` when the plugin is installed.

## Installing

```sh
cordova plugin add cordova-plugin-sentry-sdk
```

Variables, set with `cordova plugin add cordova-plugin-sentry-sdk --variable NAME=value`:

| Variable | Default | |
| --- | --- | --- |
| `SENTRY_ANDROID_SDK_VERSION` | `8.61.0` | the sentry-android release |
| `SENTRY_ANDROID_ARTIFACT` | `sentry-android-core` | `sentry-android-core` is the SDK: Java and Kotlin crashes, ANRs, and what this plugin calls. `sentry-android` adds the NDK module, which reports crashes in native C and C++ code from any library in the app, and Session Replay, which the plugin never turns on. It puts native libraries for every ABI into the APK, so take it when the app carries native code whose crashes you want. |

The iOS version is pinned in `Package.swift`.

Coming from sentry-cordova: remove it first (`cordova plugin rm sentry-cordova`). Two starts of the native SDK in one process end
badly: sentry-cocoa warns that "calling start again without close() may lead to undefined behavior", and sentry-android
overwrites the first start's configuration with the second's. What the old plugin did through its native bridge (sending the
page's events through the native SDK, native breadcrumbs, native performance) is not provided here. Your page keeps using the
browser SDK.

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
  await window.SentrySdk?.start({
    dsn: '<your dsn>',
    release: 'my-app@1.2.3',   // the same value the JavaScript SDK reports
    environment: 'production',
  });
  await window.SentrySdk?.setUser({ id: '42', email: 'user@example.com' });
  await window.SentrySdk?.setTags({ 'account.region': 'IE', plan: 'pro' });
  await window.SentrySdk?.setContext('account', { animals: 120, premium: true });
});
```

Call `start` first, on **every launch** (see [Starting late](#starting-late)).

`window.SentrySdk` exists only inside a Cordova app, so the types declare it optional: guard for it in a web build
(`ionic serve`, a test run). Every call returns a promise. Native answers through Cordova's callbacks with a string the types
spell out (`'started' | 'already started'`, `'set' | 'cleared' | 'queued'`, ...), and a refused call (no DSN, no key) rejects with
the reason as a string. Types ship in `types/index.d.ts`.

# API

- [SentrySdk.start](#start)
- [SentrySdk.setUser](#setUser)
- [SentrySdk.setTags](#setTags)
- [SentrySdk.setContext](#setContext)
- [SentrySdk.setExtras](#setExtras)
- [SentrySdk.close](#close)
- [SentrySdk.isEnabled](#isEnabled)
- [SentrySdk.crash](#crash)

## start

`start(options): Promise<'started' | 'already started'>`

`SentrySDK.start` / `SentryAndroid.init` with the options below. Answers `started`. If the SDK is
already running, whoever started it, it answers `already started` and changes nothing: the SDK is
one per process, and a plugin instance only lives as long as its web view, so after Android
recreates an Activity the new instance finds the SDK still up. Call it once, after `deviceready`,
on **every launch**: sentry-cocoa sends a crash report on the next start of the SDK, so an app that
starts it only sometimes loses the crashes in between.

A `dsn` the SDK cannot parse is **refused**, and the SDK stays off, so the page can try again with a
good one: the promise rejects with `start was refused: ...`. (sentry-cocoa alone would start without
a DSN, send nothing and say so only in its log; the plugin checks with the SDK's own parser first.)

| Option | Default | Platform |
| --- | --- | --- |
| `dsn` | required | both |
| `release`, `environment`, `dist` | unset | both |
| `enableAutoSessionTracking` | `true` | both |
| `enableAppHangTracking` | `true`. **Deprecated**: sentry-cocoa removes app hang tracking in v10 | iOS |
| `appHangTimeoutInterval` | the SDK's `2`. **Deprecated** with the option above | iOS |
| `enableMetricKit` | the SDK's own: `false` in sentry-cocoa 9, `true` in 10. MetricKit delivers the system's hang, CPU and disk-write diagnostics, and is where sentry-cocoa sends you instead of app hang tracking | iOS |
| `enableCaptureFailedRequests` | **`false`** (the SDK's default is `true`). The SDK watches the requests the app's own code makes, another plugin's HTTP calls for one; a request the page makes is made by WebKit's own processes and is not among them. Network breadcrumbs (`enableNetworkBreadcrumbs`) stay on, as the SDK has them | iOS |
| `enableAnrTracking` | `true` | Android |
| `allowCrash` | `false`. [`crash()`](#crash) is refused unless the last accepted `start` gave this, so a stray call cannot end the app | both |

## setUser

`setUser(user | null): Promise<'set' | 'cleared' | 'queued'>`

Sets the user on the native scope (`id`, `email`, `username`), or clears it with `null`. Answers
`set` or `cleared`, or `queued`: see below.

## setTags

`setTags({ key: value | null }): Promise<'set' | 'queued'>`

Sets tags on the native scope; a `null` value removes that tag. A boolean reaches Sentry as `true`
or `false`, a number as its text. Answers `set`, or `queued`: see below.

## setContext

`setContext(key, object | null): Promise<'set' | 'queued'>`

Sets a named context (an object) on the native scope, or removes it with `null`. Answers `set`, or
`queued`: see below.

### Before `start`

A scope call made while the SDK is not running would change a scope that the SDK throws away when it
starts. So the plugin keeps it instead, answers `queued`, and `start` applies it: the **last**
change of each key (the user, each tag, each context), in no particular order between keys. The
order of the calls does not matter, which is what an app needs when the user is known before the
SDK is up (an extra is a key like a tag). Nothing is kept for an SDK that never starts.

### What is refused

The wrapper settles what the two platforms would otherwise read differently, so a call means the same on both. In a user, a number in
`id`, `email` or `username` becomes its text, an empty string or `null` leaves the field out, and any other type is refused; a user
that is not an object or `null` is refused too. `setTags` takes an object whose values are strings, finite numbers, booleans or
`null`, and `setContext` takes a key that is not empty and an object or `null`: an array, a string or no value is refused, where
native used to take it as a removal. The promise rejects with the reason, a string that names the call, and nothing is sent.

## setExtras

`setExtras({ key: value | null }): Promise<'set' | 'queued'>`

Sets extras on the native scope, the older and flatter relative of a context: prefer [`setContext`](#setContext) for anything with a
shape. An extra is **text on both platforms** (sentry-android's scope takes only a string), so a string reaches Sentry as it is and
anything else as its JSON: `12` is `12`, `false` is `false`, `[1,"two"]` and `{"a":1}` are those texts. `null` or `undefined`
removes the extra. A value JSON cannot carry (a cycle, a BigInt, a function) is refused. Answers `set`, or `queued`: see
[Before `start`](#before-start), where an extra is a key like a tag.

## close

`close(): Promise<'closed' | 'not running'>`

Stops the native SDK, flushing what it holds (`Sentry.close` / `SentrySDK.close`), for a logout or an environment switch. It
answers `not running` when there was no SDK to close, and nothing else changes. A later [`start`](#start) starts it again. What the
page sets while the SDK is down is kept for that start, as before the first one, and `allowCrash` is not: it was the word of the
`start` that is over, so the next `start` gives it again. Flushing can take as long as the SDK's shutdown timeout, which is why the
call does not hold up the thread Cordova called it on.

## isEnabled

`isEnabled(): Promise<boolean>`

Whether the native SDK is running, whoever started it: the plugin, or the app's own code.

## crash

`crash(): Promise<never>`

Crashes the process natively: `SentrySDK.crash()` on iOS, an uncaught exception on the main thread
on Android. For a device test only; the promise never settles, the app is gone. Relaunch and start
the SDK again before looking in Sentry: sentry-cocoa sends the report at the next start of the SDK,
and sentry-android flushes what it can to disk at the crash and sends what is left at the next start.

It is refused, the promise rejecting, unless the last accepted `start` was given `allowCrash: true`. That keeps a stray call
from ending the app. It is not a lock against a script that can call `start` itself.

## What arrives, and what does not

Native events carry the native SDK's own device and OS contexts plus whatever you set through this
plugin. They are separate from the page's events: no shared trace, no shared breadcrumbs. If that
matters to you, you want a hybrid SDK such as
[sentry-capacitor](https://github.com/getsentry/sentry-capacitor), not this plugin.

What reaches Sentry through this plugin is what the two SDKs catch in native code: a crash, and on
iOS a watchdog termination, an app hang (the deprecated option) and, with `enableMetricKit`, the
system's own diagnostics; on Android an ANR, which the SDK reads from the system's exit records at
the next start (Android 11 and newer). On Android a crash in native C or C++ code needs the NDK
module, which is in the `sentry-android` artifact and not in the default one (see
[Installing](#installing)).

### Starting late

The native SDK starts when the page calls `start`, which is after the web view has loaded and
`deviceready` has fired: in an Ionic or Angular app, seconds after the process began. So:

- A crash, an ANR or a hang before `start` has run is not caught by that launch's SDK. What the
  previous launch left behind is sent when the SDK next starts, which is why `start` belongs in
  every launch.
- An app that crashes before the page runs, in a plugin's `pluginInitialize`, after a bad update,
  out of memory during the first paint, never starts the SDK and is never reported, for as long as
  that lasts.
- Starting from native code earlier (`Application.onCreate`, `didFinishLaunching`) with the DSN in
  the manifest or `config.xml` would close that window, at the price of the page no longer choosing
  the release and environment. This plugin does not do it.

### Crashes of the web view itself

The common "the app went white and restarted" in a Cordova app is not a native crash, and this
plugin does not report it. It hooks neither callback (read from the cordova-android and cordova-ios
sources, not measured on a device):

- Android: when the web view's renderer process dies, cordova-android's `SystemWebViewClient.onRenderProcessGone`
  asks the plugins and, when none handles it, returns `WebViewClient`'s default, which tells Android that the
  host did not handle it.
- iOS: when WebKit's content process terminates, `CDVWebViewEngine` reloads the page
  (`CrashRecoveryBehavior`) and the app lives on.

### Sessions

Both SDKs count sessions: the native one per app run (`enableAutoSessionTracking`, on by default
here) and the browser SDK its own (`browserSessionIntegration`). With the same `release` on both, one launch
puts sessions from two SDKs under one release, and the crash-free figures are a blend of two views.
Decide which SDK owns release health: pass `enableAutoSessionTracking: false` here, or turn session
tracking off in the page's SDK. The plugin keeps the SDK's default.

### Set the user and the tags early

sentry-android writes the scope (user, tags, contexts, breadcrumbs) to disk as it changes
(`enableScopePersistence`, on by default), and sentry-cocoa hands it to its crash handler and
keeps it for watchdog terminations. So an event that is reported at the next start, a crash on iOS,
an ANR or a watchdog termination, carries what was set during the run it happened in. Call `setUser`
and `setTags` early in every run: what you set after the crash cannot be in it. A context is
stored on the device with the rest of the scope, so put nothing in one that must not be on disk.

### Privacy

`setUser` sends what you pass, `id`, `email` and `username`, and nothing else about the user. The
plugin does not touch `sendDefaultPii`: the SDKs' own default applies, which is `false` in both
versions pinned here.

### Symbols

A native stack trace is readable in Sentry only when the build's debug symbols are there: upload
the dSYMs of the iOS build with `sentry-cli debug-files upload`, and the mapping file of an Android
build that is minified (R8 or ProGuard). This plugin uploads nothing.

## Versions of the SDKs

- sentry-cocoa is pinned exactly in `Package.swift`, and an app cannot override it: a fix in the SDK
  reaches your app through a release of this plugin.
- sentry-android comes through two plugin variables, `SENTRY_ANDROID_SDK_VERSION` (8.61.0 by default) and
  `SENTRY_ANDROID_ARTIFACT`, and an app can install the plugin with others.
- `test/unit/platform-parity.test.mjs` holds the pins of `plugin.xml`, `Package.swift`, `test/ios`
  and `test/android` together, and a weekly workflow opens a pull request that moves a pin when its SDK has a newer release, a major one too.
  No promise is made about a future major of either SDK.

# Development

```sh
npm install
npm test                      # the JavaScript on Node: the API, the parity of the two platforms and the README, the types, the device tests
npm run test:ios              # the Swift against cordova-ios and sentry-cocoa, XCTest on a simulator (test/ios)
npm run test:android          # the Kotlin against cordova-android and sentry-android, JVM with Robolectric (test/android)
npm run test:e2e:android:build && npm run test:e2e:android   # the demo app crashes itself on a device or an emulator and its report is read (test/e2e)
npm run test:e2e:ios:build && npm run test:e2e:ios           # the same on an iOS simulator
npm run test:paramedic:ios:simulator      # tests/ in an app on a simulator (cordova-paramedic)
npm run test:paramedic:android:emulator   # the same on an emulator (ANDROID_AVD=<name>)
```

| Path | What |
| --- | --- |
| `src/ios/SentrySdk.swift`, `Package.swift` | the iOS plugin, a Swift package: cordova-ios 8 links it, SPM brings sentry-cocoa |
| `src/android/SentrySdk.kt` | the Android plugin |
| `src/www/SentrySdk.ts` | the TypeScript wrapper (promises); compiled into `www/` (committed) with `npm run build`, and CI fails when they differ |
| `types/index.d.ts` | the `window.SentrySdk` global |
| `tests/` | the test plugin for cordova-paramedic (`defineAutoTests`, and the crash as a manual test) |
| `test/unit/` | `node --test`, no device: the JavaScript, the parity test, the types, and `tests/` run against a fake native |
| `test/types/` | a sample consumer of the shipped types, compiled by `test/unit/types.test.mjs` |
| `test/ios/`, `test/android/` | the native code compiled and tested for real, without an app |
| `test/e2e/` | the demo app crashes itself and its report is read at an endpoint on the runner |
| `test/coverage/` | the coverage floors each layer holds |
| `demo/` | a Cordova app with one button per call, for a phone; a bare app, with no Kotlin or deployment-target setting of its own |
| `scripts/check-pins.mjs` | where the two SDK pins stand against the latest releases; `.github/workflows/pins.yaml` runs it every Monday, opens a pull request for a pin that is behind and starts CI on it |

The `cordova-paramedic` dev dependency is an alias of `cordova-paramedic-hotfix`, which is built from a fork of
apache/cordova-paramedic (`MaximBelov/cordova-paramedic`) that runs the tests on a physical iOS device and on a phone over USB.
It is used for development only and is not part of the published plugin.

A release is a version bump in `package.json`, `plugin.xml` and `tests/` (both of its manifests), merged to `main`: CI runs the
tests and publishes the new version to npm through trusted publishing (no stored token).

## Licence

Apache-2.0
