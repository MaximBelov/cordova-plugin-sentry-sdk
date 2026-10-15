import Cordova
import Foundation
import Sentry
import UIKit

/// The native Sentry SDK, started and kept in sync from the page. Only the public API of sentry-cocoa:
/// `SentrySDK.start`, `setUser`, `configureScope`, `crash`. No transport, no envelope bridge, no
/// private headers -- the JS SDK sends its own events, this only owns what the page cannot see.
@objc(SentrySdk) class SentrySdk: CDVPlugin {

    /// Whether the SDK is running is the SDK's to say (`SentrySDK.isEnabled`): it is one per process, and a plugin instance only as
    /// long as its view controller. What the plugin does remember is what the page set before the SDK was running: the last change of
    /// each key, applied by `start`.
    private var pending: [String: () -> Void] = [:]

    /// Breadcrumbs are a trail, not a key, so what the page adds before the SDK is running is kept in order, up to the last
    /// `maxPendingBreadcrumbs`, and `start` adds them. A clear drops them, as it would drop the SDK's own.
    private var pendingBreadcrumbs: [Breadcrumb] = []
    static let maxPendingBreadcrumbs = 100

    /// `crash` takes the process down, so it is refused unless the page said so in an accepted `start`: that it is a device test. It is the
    /// page's word and not a lock, so it keeps a stray call from ending the app, not a script that can call `start` itself.
    private var crashAllowed = false

    /// What `crash` does once it is allowed: a property, so that a test can see it called without the test process going down.
    var crashAction: () -> Void = { SentrySDK.crash() }

    @objc(start:)
    func start(_ command: CDVInvokedUrlCommand) {
        guard let options = command.argument(at: 0) as? [String: Any], let dsn = options["dsn"] as? String, !dsn.isEmpty else {
            reply(command, ok: false, "start needs an options object with a dsn")
            return
        }
        let allowCrash = (options["allowCrash"] as? Bool) ?? false
        // Started by an earlier instance of this plugin, or by the app itself: either way it is running, and its options are its own.
        if SentrySDK.isEnabled {
            crashAllowed = allowCrash
            reply(command, ok: true, "already started")
            return
        }
        // A dsn the SDK cannot parse does not stop `SentrySDK.start`: the SDK starts without a dsn, sends nothing, and says so only in its
        // own log. So the SDK's parser, on a scratch Options, decides first, and a refused start leaves the page free to try again.
        let probe = Options()
        probe.dsn = dsn
        guard probe.parsedDsn != nil else {
            reply(command, ok: false, "start was refused: the dsn does not parse")
            return
        }
        SentrySDK.start { SentrySdk.configure($0, from: options) }
        guard SentrySDK.isEnabled else {
            reply(command, ok: false, "start was refused: the SDK did not start")
            return
        }
        pending.values.forEach { $0() }
        pending.removeAll()
        pendingBreadcrumbs.forEach { SentrySDK.addBreadcrumb($0) }
        pendingBreadcrumbs.removeAll()
        crashAllowed = allowCrash
        reply(command, ok: true, "started")
    }

    /// Runs a change of the scope now, or, while the SDK is not running, keeps the last change of its key for `start`: a call before the
    /// SDK is up changes a scope that is thrown away when it starts. Says which it did.
    @discardableResult
    private func applyOrKeep(_ key: String, _ change: @escaping () -> Void) -> Bool {
        if SentrySDK.isEnabled {
            change()
            return true
        }
        pending[key] = change
        return false
    }

    /// The options the page passes, applied to the SDK's. On its own so the mapping can be tested without a running SDK.
    static func configure(_ sentryOptions: Options, from options: [String: Any]) {
        sentryOptions.dsn = options["dsn"] as? String
        if let release = options["release"] as? String { sentryOptions.releaseName = release }
        if let environment = options["environment"] as? String { sentryOptions.environment = environment }
        if let dist = options["dist"] as? String { sentryOptions.dist = dist }
        // Both app hang options are deprecated in sentry-cocoa 9 and gone in 10, which points at MetricKit instead.
        sentryOptions.enableAppHangTracking = (options["enableAppHangTracking"] as? Bool) ?? true
        // NSNumber, not Double: a JSON 7 arrives as an integer NSNumber, which `as? Double` refuses.
        if let interval = options["appHangTimeoutInterval"] as? NSNumber { sentryOptions.appHangTimeoutInterval = interval.doubleValue }
        // The SDK's default is true. It watches the URLSession tasks of the app's own process, so what it would turn into events are
        // the failed requests that native code makes (another plugin's HTTP calls); the requests the page makes go through WebKit's own
        // processes and are not seen at all. Off here: the page's own SDK reports what it wants to.
        sentryOptions.enableCaptureFailedRequests = (options["enableCaptureFailedRequests"] as? Bool) ?? false
        // Only when the page asks, so the SDK's own default stays otherwise (false in sentry-cocoa 9, true in 10).
        if let metricKit = options["enableMetricKit"] as? Bool { sentryOptions.enableMetricKit = metricKit }
        sentryOptions.enableAutoSessionTracking = (options["enableAutoSessionTracking"] as? Bool) ?? true
        // What reports a crash. One name on both platforms, which is the SDK's `enableCrashHandler` here.
        if let crashHandling = options["enableNativeCrashHandling"] as? Bool { sentryOptions.enableCrashHandler = crashHandling }
        if let watchdog = options["enableWatchdogTerminationTracking"] as? Bool { sentryOptions.enableWatchdogTerminationTracking = watchdog }
        if let debug = options["debug"] as? Bool { sentryOptions.debug = debug }
        if let pii = options["sendDefaultPii"] as? Bool { sentryOptions.sendDefaultPii = pii }
        if let stacktrace = options["attachStacktrace"] as? Bool { sentryOptions.attachStacktrace = stacktrace }
        // The SDK counts in unsigned integers, and a negative number has no meaning there: the wrapper refuses one, and a call that
        // reaches here without it leaves the SDK's default.
        if let count = (options["maxBreadcrumbs"] as? NSNumber).flatMap({ UInt(exactly: $0.intValue) }) { sentryOptions.maxBreadcrumbs = count }
        if let rate = options["sampleRate"] as? NSNumber { sentryOptions.sampleRate = rate }
        if let interval = (options["sessionTrackingIntervalMillis"] as? NSNumber).flatMap({ UInt(exactly: $0.intValue) }) {
            sentryOptions.sessionTrackingIntervalMillis = interval
        }
    }

    @objc(setUser:)
    func setUser(_ command: CDVInvokedUrlCommand) {
        let dict = command.argument(at: 0) as? [String: Any]
        let applied = applyOrKeep("user") {
            guard let dict = dict else {
                SentrySDK.setUser(nil)
                return
            }
            let user = User()
            if let id = dict["id"] as? String { user.userId = id }
            if let email = dict["email"] as? String { user.email = email }
            if let username = dict["username"] as? String { user.username = username }
            SentrySDK.setUser(user)
        }
        reply(command, ok: true, !applied ? "queued" : (dict == nil ? "cleared" : "set"))
    }

    @objc(setTags:)
    func setTags(_ command: CDVInvokedUrlCommand) {
        guard let tags = command.argument(at: 0) as? [String: Any] else {
            reply(command, ok: false, "setTags needs an object")
            return
        }
        var applied = true
        for (key, value) in tags {
            let change = {
                SentrySDK.configureScope { scope in
                    if value is NSNull {
                        scope.removeTag(key: key)
                    } else {
                        scope.setTag(value: SentrySdk.tagText(value), key: key)
                    }
                }
            }
            applied = applyOrKeep("tag:\(key)", change) && applied
        }
        reply(command, ok: true, applied ? "set" : "queued")
    }

    @objc(setContext:)
    func setContext(_ command: CDVInvokedUrlCommand) {
        guard let key = command.argument(at: 0) as? String, !key.isEmpty else {
            reply(command, ok: false, "setContext needs a key")
            return
        }
        let value = command.argument(at: 1) as? [String: Any]
        let applied = applyOrKeep("context:\(key)") {
            SentrySDK.configureScope { scope in
                if let value = value {
                    scope.setContext(value: value, key: key)
                } else {
                    scope.removeContext(key: key)
                }
            }
        }
        reply(command, ok: true, applied ? "set" : "queued")
    }

    @objc(addBreadcrumb:)
    func addBreadcrumb(_ command: CDVInvokedUrlCommand) {
        guard let dict = command.argument(at: 0) as? [String: Any] else {
            reply(command, ok: false, "addBreadcrumb needs an object")
            return
        }
        let breadcrumb = SentrySdk.breadcrumb(from: dict)
        if SentrySDK.isEnabled {
            SentrySDK.addBreadcrumb(breadcrumb)
            reply(command, ok: true, "added")
            return
        }
        pendingBreadcrumbs.append(breadcrumb)
        if pendingBreadcrumbs.count > SentrySdk.maxPendingBreadcrumbs {
            pendingBreadcrumbs.removeFirst(pendingBreadcrumbs.count - SentrySdk.maxPendingBreadcrumbs)
        }
        reply(command, ok: true, "queued")
    }

    @objc(clearBreadcrumbs:)
    func clearBreadcrumbs(_ command: CDVInvokedUrlCommand) {
        pendingBreadcrumbs.removeAll()
        if SentrySDK.isEnabled {
            SentrySDK.configureScope { $0.clearBreadcrumbs() }
        }
        reply(command, ok: true, "cleared")
    }

    /// A breadcrumb from what the page sent. The wrapper has mapped `log` and `critical` to `debug` and `fatal`, and settled the types:
    /// here a field is read, not checked. On its own so the mapping can be tested without a running SDK.
    static func breadcrumb(from dict: [String: Any]) -> Breadcrumb {
        let level: SentryLevel
        switch dict["level"] as? String {
        case "fatal": level = .fatal
        case "error": level = .error
        case "warning": level = .warning
        case "debug": level = .debug
        default: level = .info
        }
        let breadcrumb = Breadcrumb(level: level, category: (dict["category"] as? String) ?? "")
        if let type = dict["type"] as? String, !type.isEmpty { breadcrumb.type = type }
        if let message = dict["message"] as? String, !message.isEmpty { breadcrumb.message = message }
        // NSNumber, as for the app hang interval: a JSON 1.7e9 arrives as an NSNumber, which `as? Double` can refuse.
        if let seconds = dict["timestamp"] as? NSNumber { breadcrumb.timestamp = Date(timeIntervalSince1970: seconds.doubleValue) }
        if let data = dict["data"] as? [String: Any] { breadcrumb.data = data }
        return breadcrumb
    }

    /// The wrapper has made every value text, or null for a removal.
    @objc(setExtras:)
    func setExtras(_ command: CDVInvokedUrlCommand) {
        guard let extras = command.argument(at: 0) as? [String: Any] else {
            reply(command, ok: false, "setExtras needs an object")
            return
        }
        var applied = true
        for (key, value) in extras {
            let change = {
                SentrySDK.configureScope { scope in
                    if let text = value as? String {
                        scope.setExtra(value: text, key: key)
                    } else {
                        scope.removeExtra(key: key)
                    }
                }
            }
            applied = applyOrKeep("extra:\(key)", change) && applied
        }
        reply(command, ok: true, applied ? "set" : "queued")
    }

    /// `SentrySDK.close` flushes, which can take a while, so it does not run on the thread Cordova called the plugin on. What the page set
    /// while the SDK was down stays kept for the next `start`, and `allowCrash` does not: it was the word of the `start` that is over.
    @objc(close:)
    func close(_ command: CDVInvokedUrlCommand) {
        commandDelegate.run(inBackground: { [self] in
            guard SentrySDK.isEnabled else {
                reply(command, ok: true, "not running")
                return
            }
            SentrySDK.close()
            crashAllowed = false
            reply(command, ok: true, "closed")
        })
    }

    @objc(isEnabled:)
    func isEnabled(_ command: CDVInvokedUrlCommand) {
        commandDelegate.send(CDVPluginResult(status: CDVCommandStatus_OK, messageAs: SentrySDK.isEnabled), callbackId: command.callbackId)
    }

    /// What the system says, which the web view's user agent does not: WebKit keeps the OS version in it where it was.
    @objc(getDeviceInfo:)
    func getDeviceInfo(_ command: CDVInvokedUrlCommand) {
        let device = UIDevice.current
        let info = SentrySdk.deviceInfo(
            systemName: device.systemName, systemVersion: device.systemVersion, model: SentrySdk.hardwareModel(), bundleInfo: Bundle.main.infoDictionary)
        commandDelegate.send(CDVPluginResult(status: CDVCommandStatus_OK, messageAs: info), callbackId: command.callbackId)
    }

    /// The answer of `getDeviceInfo`, from what the system gave. On its own so it can be tested with values the test device does not have.
    static func deviceInfo(systemName: String, systemVersion: String, model: String, bundleInfo: [String: Any]?) -> [String: String] {
        [
            "osName": systemName,
            "osVersion": systemVersion,
            "deviceModel": model,
            "appRelease": (bundleInfo?["CFBundleShortVersionString"] as? String) ?? "",
            "appBuild": (bundleInfo?["CFBundleVersion"] as? String) ?? "",
        ]
    }

    /// The hardware identifier, `iPhone17,1`. A simulator runs on the Mac's architecture, so `uname` says `arm64` there; it names the
    /// device it stands in for in its environment.
    static func hardwareModel() -> String {
        if let simulated = ProcessInfo.processInfo.environment["SIMULATOR_MODEL_IDENTIFIER"], !simulated.isEmpty { return simulated }
        var system = utsname()
        uname(&system)
        return withUnsafeBytes(of: &system.machine) { String(decoding: $0.prefix { $0 != 0 }, as: UTF8.self) }
    }

    /// Sends a message event. Not queued: a message needs the SDK running, so a call before `start` is answered with an error, and the
    /// page knows the message was not sent.
    @objc(captureMessage:)
    func captureMessage(_ command: CDVInvokedUrlCommand) {
        guard let message = command.argument(at: 0) as? String, !message.isEmpty else {
            reply(command, ok: false, "captureMessage needs a message")
            return
        }
        let level: SentryLevel
        switch command.argument(at: 1) as? String {
        case "debug": level = .debug
        case "info": level = .info
        case "warning": level = .warning
        case "error": level = .error
        case "fatal": level = .fatal
        default:
            reply(command, ok: false, "captureMessage: the level has to be debug, info, warning, error or fatal")
            return
        }
        guard SentrySDK.isEnabled else {
            reply(command, ok: false, "captureMessage needs a running SDK: start has to be answered first")
            return
        }
        SentrySDK.capture(message: message) { scope in
            scope.setLevel(level)
        }
        reply(command, ok: true, "sent")
    }

    /// For a device probe: the process goes down, so this never answers. Refused unless `start` allowed it.
    @objc(crash:)
    func crash(_ command: CDVInvokedUrlCommand) {
        guard crashAllowed else {
            reply(command, ok: false, "crash is refused: it is for a device test, and start has to be given allowCrash: true")
            return
        }
        crashAction()
    }

    /// A JSON boolean arrives as an NSNumber and would print as 0 or 1; Sentry filters on `true`/`false`.
    private static func tagText(_ value: Any) -> String {
        if let number = value as? NSNumber, CFGetTypeID(number) == CFBooleanGetTypeID() {
            return number.boolValue ? "true" : "false"
        }
        return String(describing: value)
    }

    private func reply(_ command: CDVInvokedUrlCommand, ok: Bool, _ message: String) {
        let result = CDVPluginResult(status: ok ? CDVCommandStatus_OK : CDVCommandStatus_ERROR, messageAs: message)
        commandDelegate.send(result, callbackId: command.callbackId)
    }
}
