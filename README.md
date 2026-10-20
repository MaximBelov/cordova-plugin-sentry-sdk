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
- [SentrySdk.addBreadcrumb](#addBreadcrumb)
- [SentrySdk.clearBreadcrumbs](#clearBreadcrumbs)
- [SentrySdk.setExtras](#setExtras)
- [SentrySdk.close](#close)
- [SentrySdk.isEnabled](#isEnabled)
- [SentrySdk.getDeviceInfo](#getDeviceInfo)
- [SentrySdk.captureMessage](#captureMessage)
- [SentrySdk.crash](#crash)

## start

`start(options): Promise<'started' | 'already started'>`

`SentrySDK.start` / `SentryAndroid.init` with the options below. Answers `started`. If the SDK is
already running, whoever started it, it answers `already started` and changes nothing: the SDK is
one per process, and a plugin instance only lives as long as its web view, so after Android
recreates an Activity the new instance finds the SDK still up. Call it once, after `deviceready`,
on **every launch**: sentry-cocoa sends a crash report on the next start of the SDK, so an app that
starts it only sometimes loses the crashes in between.

An option that is not given is left to the SDK, so what each platform does by default is the SDK's own. An option of the wrong type (a
number as text, a `sampleRate` of 2, a negative count) is **refused** by the JavaScript half, with the option's name in the reason, instead of
being read one way on Android and another on iOS. An option that a platform does not have is accepted and ignored there.

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
| `enableNativeCrashHandling` | `true`. `false` turns off what reports a crash: on Android the handler for an uncaught exception, the ANR watch (so `enableAnrTracking` too) and the NDK integration, on iOS the crash handler. The plugin then sends what the page gives it and no crash | both |
| `enableWatchdogTerminationTracking` | the SDK's `true`. The app was killed by the system, out of memory or hung, with no crash | iOS |
| `debug` | `false`. The SDK writes what it does to the system log (logcat, the Xcode console) | both |
| `sendDefaultPii` | `false`. The user's IP address and what else the SDK adds about a user beyond what [`setUser`](#setuser) sets. sentry-android deprecates the option in 8.61.0 for its finer data-collection options and still honours it | both |
| `maxBreadcrumbs` | the SDK's `100`. A whole number, 0 or more | both |
| `sampleRate` | `1`. The share of error events that is sent, 0 to 1 | both |
| `attachStacktrace` | the SDK's `true`. An event that has no exception gets the stack trace of where it was captured | both |
| `attachThreads` | `false`. Every event carries the stack traces of all the threads | Android |
| `sessionTrackingIntervalMillis` | the SDK's `30000`. How long the app has to stay in the background for the session to be over. A whole number, 0 or more | both |
| `enableNdkScopeSync` | `true`. With the NDK artifact: the scope is kept in sync with the NDK's, so a crash in C or C++ code has the user and the tags | Android |
| `allowCrash` | `false`. [`crash()`](#crash) is refused unless the last accepted `start` gave this, so a stray call cannot end the app | both |
| `recordPluginErrors` | `false`. Every plugin result that comes back as an error becomes a breadcrumb, also the ones from before `start`: see [Failed plugin calls as breadcrumbs](#failed-plugin-calls-as-breadcrumbs) | both |

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
change of each key (the user, each tag, each context, each extra), in no particular order between keys. The
order of the calls does not matter, which is what an app needs when the user is known before the
SDK is up. Nothing is kept for an SDK that never starts. Breadcrumbs are a trail and not a key, so
they are kept in the order they came, the last hundred, and [`clearBreadcrumbs`](#clearBreadcrumbs)
drops them.

### What is refused

The wrapper settles what the two platforms would otherwise read differently, so a call means the same on both. In a user, a number in
`id`, `email` or `username` becomes its text, an empty string or `null` leaves the field out, and any other type is refused; a user
that is not an object or `null` is refused too. `setTags` takes an object whose values are strings, finite numbers, booleans or
`null`, and `setContext` takes a key that is not empty and an object or `null`: an array, a string or no value is refused, where
native used to take it as a removal. The promise rejects with the reason, a string that names the call, and nothing is sent.

## addBreadcrumb

`addBreadcrumb(breadcrumb): Promise<'added' | 'queued'>`

Adds a breadcrumb to the native scope, so a native crash carries what the page did before it: a route,
a tap, a request. `breadcrumb` is the JavaScript SDK's, and what is read is `type`, `category`,
`message`, `level`, `timestamp` (seconds since the epoch, as there; unset, the time of the call) and
`data` (any JSON, nested). Answers `added`, or `queued` while the SDK is not running: see
[Before `start`](#before-start).

The levels are the JavaScript SDK's, and `log` and `critical`, which native does not have, are sent as
`debug` and `fatal`. No level is `info`, on both platforms. Like the rest, a breadcrumb that the two
platforms would read differently is refused before it is sent: a field that is not text, a level that
is none of the above, a `timestamp` that is not a number, `data` that is not an object or that JSON
cannot carry. On iOS a breadcrumb without a `category` has an empty one, which the SDK requires.

The native SDKs add breadcrumbs of their own (lifecycle, system events, network on iOS). The page's
are not forwarded by themselves: either call this for the ones that matter, or bind the page SDK's
scope to the plugin, which does it for every breadcrumb.

## clearBreadcrumbs

`clearBreadcrumbs(): Promise<'cleared'>`

Clears the native scope's breadcrumbs, and the ones kept for `start`.

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

## getDeviceInfo

`getDeviceInfo(): Promise<{ osName, osVersion, deviceModel, appRelease, appBuild }>`

Reads the operating system, the device and the app from the system, all text. It needs no running SDK and sets nothing.

| Field | iOS | Android |
| --- | --- | --- |
| `osName` | `UIDevice.systemName`: `iOS`, or `iPadOS` on an iPad | `Android` |
| `osVersion` | `UIDevice.systemVersion`, `26.3` | `Build.VERSION.RELEASE`, `15` |
| `deviceModel` | the hardware identifier, `iPhone17,1` (a simulator gives the model it stands in for) | `Build.MODEL`, `Pixel 10a` |
| `appRelease` | `CFBundleShortVersionString`, empty when the app declares none | `versionName`, empty when none |
| `appBuild` | `CFBundleVersion`, empty when it is not text | `versionCode`, which is a `Long` and is sent as its text |

**Why this exists:** the page cannot get these from its own web view, because the user agent is not the system's answer. Measured: Safari
on an iOS 26.3 simulator sends `CPU iPhone OS 18_7` in its user agent (and `Version/26.3`), so an event that takes the OS version from it
is wrong by a major version. Chrome documents a reduced user agent too, `Android 10; K` in its example, with the model behind a client
hint ([Privacy Sandbox](https://privacysandbox.google.com/protections/user-agent)); that page does not mention Android WebView, and no
web view was measured on Android here. The JS SDK reads its `os` and `device` contexts from the user agent, so a page that wants the true
ones can set them from this answer, for instance with `setContext('os', ...)` in its own SDK.

## captureMessage

`captureMessage(message: string, level?: 'debug' | 'info' | 'warning' | 'error' | 'fatal'): Promise<'sent'>`

Sends a message event of the app's own, at `level` (default `info`): `SentrySDK.capture(message:)` on iOS,
`Sentry.captureMessage` on Android. Use it for a problem the app got over, which a crash report would never show.

Unlike `setUser`, `setTags` and `setContext`, it is not queued. A message needs the SDK running, so a call before
`start` is answered with the reason and the promise rejects; the page knows it was not sent. An empty message and a level
other than the five names are refused before they reach native.

## crash

`crash(): Promise<never>`

Crashes the process natively: `SentrySDK.crash()` on iOS, an uncaught exception on the main thread
on Android. For a device test only; the promise never settles, the app is gone. Relaunch and start
the SDK again before looking in Sentry: sentry-cocoa sends the report at the next start of the SDK,
and sentry-android flushes what it can to disk at the crash and sends what is left at the next start.

It is refused, the promise rejecting, unless the last accepted `start` was given `allowCrash: true`. That keeps a stray call
from ending the app. It is not a lock against a script that can call `start` itself.

## Keeping the page's scope in sync

`bindScope(scope, options?)` in `www/scope-sync` is a helper for an app whose page uses the JavaScript SDK. It wraps the setters of a scope so
that what the page sets there also goes to this plugin, and a native crash carries what the page knew. It is not part of `window.SentrySdk`
and the plugin does not inject it: a bundler imports it from the package, and it needs nothing else, the scope being taken by its shape.

```ts
import * as Sentry from '@sentry/browser';
import { bindScope } from 'cordova-plugin-sentry-sdk/www/scope-sync';

document.addEventListener('deviceready', async () => {
  await window.SentrySdk?.start({ dsn: '...' });
  bindScope(Sentry.getGlobalScope(), { onError: (error, method) => console.warn(method, error) });
  bindScope(Sentry.getIsolationScope());
  bindScope(Sentry.getCurrentScope());
});
```

| The scope's method | What the plugin is sent |
| --- | --- |
| `setUser(user \| null)` | [`setUser`](#setUser), `null` for a removal. The plugin keeps `id`, `email` and `username` |
| `setTag(key, value)`, `setTags(tags)` | [`setTags`](#setTags). `null` and `undefined` remove the tag; a value the plugin would refuse (`NaN`, a BigInt, an object) is sent as its text |
| `setExtra(key, value)`, `setExtras(extras)` | `setExtras`. An extra that cannot be made JSON (a cycle, a BigInt, a function) is left out and goes to `onError` |
| `setContext(key, context \| null)` | [`setContext`](#setContext), as plain JSON. A context that cannot be made JSON goes to `onError` |
| `addBreadcrumb(crumb, max)` | `addBreadcrumb` with the crumb the scope ended with, its timestamp included: `type`, `category`, `message`, `level`, `timestamp` and `data` as plain JSON. Nothing is sent when the scope took no crumb (a `max` of 0) |
| `clearBreadcrumbs()` | `clearBreadcrumbs` |

- The scope behaves as it did. The original method runs first, its answer is the one returned, and whatever happens on the way to native, a
  refusal by the plugin included, never reaches the page: it goes to `onError(error, method)` when you gave one.
- `window.SentrySdk` is looked up at every call, so binding before `deviceready` is fine, and in a browser, where there is no plugin, nothing
  is sent. Give `sdk` in the options to forward to something else, a test double for one.
- Binding a scope twice does nothing the second time. The function `bindScope` returns takes the wrapping off again, and leaves a method that
  somebody wrapped after it.
- A scope made by `withScope` is a copy that does not carry the wrapping, and `scope.update(...)` does not go through the setters, so
  neither is sent. The global, isolation and current scopes are where an app puts the user and the tags.
- A scope without one of the methods is left without it, and a plugin without one of the calls is not sent it.

## Failed plugin calls as breadcrumbs

A plugin call that fails often reaches the page as a bare message: cordova-android catches what a plugin's `execute` throws and hands the
page only the exception's message, a `NullPointerException` with no plugin name. With `recordPluginErrors: true`, every failed result of
every plugin becomes a breadcrumb, so the next event, native or JavaScript, says which plugin failed and how:

```ts
await window.SentrySdk?.start({ dsn: '...', recordPluginErrors: true });
```

```json
{
  "category": "cordova.plugin",
  "level": "error",
  "message": "Camera answered with an error",
  "data": { "service": "Camera", "status": 9, "error": "No camera available" }
}
```

- Both platforms' `cordova.js` hand every native result to `cordova.callbackFromNative`, and the plugin wraps that, once, as its own
  JavaScript loads. So it sees every plugin, one that kept `cordova/exec` from before included, and the failures from before `start`: they
  are kept, the last hundred, and added by a `start` with the option, or dropped, with the recording, by a `start` without it.
- `service` is the plugin's service name (the callback id without its counter), `status` Cordova's status code, and `error` the first
  value of the answer as text: a string as it is, anything else as its JSON, cut to 200 characters. The arguments of the call are never
  read. The timestamp is the time of the failure. This plugin's own results are not recorded.
- The breadcrumb goes to the native scope, so a native crash carries it, and to the first scope given to [`bindScope`](#keeping-the-pages-scope-in-sync)
  (the global scope in the example there), so the page's events carry it. That scope takes it directly, without the scope sync sending it
  to native a second time and without the JavaScript SDK's `beforeBreadcrumb`. Without `bindScope`, it is on the native scope only.
- The result is delivered as it was, to the same callback with the same arguments. A failure while recording is swallowed; an exception
  thrown by the plugin's own callback still reaches the page.

## What arrives, and what does not

Native events carry the native SDK's own device and OS contexts plus whatever you set through this
plugin. They are separate from the page's events: no shared trace, and the page's breadcrumbs only
when it forwards them ([`addBreadcrumb`](#addBreadcrumb)). If a shared trace matters to you, you
want a hybrid SDK such as [sentry-capacitor](https://github.com/getsentry/sentry-capacitor), not this
plugin.

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

### The SDKs' own log

What the SDKs print about themselves, with [`start`](#start)'s `debug` option on, goes to logcat on Android and to the console on iOS. The
plugin does not forward it to the page, so a session that is debugged from the browser's DevTools does not see it; read it where it is written. This was
checked against sentry-android 8.61.0 and sentry-cocoa 9.30.2, and left out on purpose:

- sentry-android takes a logger in its options, `SentryOptions.setLogger(ILogger)`, which is a stable API.
- sentry-cocoa has one hook, `SentrySDK.internal.setLogOutput`. It is `public`, and its source says it is for hybrid SDKs and "may change,
  be renamed, or be removed in any minor release without prior deprecation". The plugin otherwise calls only the API an app is meant to
  call, so that is the one call whose removal would arrive as a failing build in a pull request that moves the pin.
- A forward that works on one platform and not on the other is a call that works half of the time. It would also be the first call that
  answers more than once, where every call of the plugin answers exactly once, so the page would register a callback that native keeps.

If you need it, open an issue: the Android half is the easy one, and the iOS half is the decision about depending on that hook.

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
tests and publishes the new version to npm through trusted publishing (no stored token), then tags it `v<version>` on the
commit it was published from and makes a GitHub release of its block of `CHANGES.txt` (`scripts/release.mjs`).

## Licence

Apache-2.0
