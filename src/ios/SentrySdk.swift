import Cordova
import Foundation
import Sentry

/// The native Sentry SDK, started and kept in sync from the page. Only the public API of sentry-cocoa:
/// `SentrySDK.start`, `setUser`, `configureScope`, `crash`. No transport, no envelope bridge, no
/// private headers -- the JS SDK sends its own events, this only owns what the page cannot see.
@objc(SentrySdk) class SentrySdk: CDVPlugin {

    /// Whether the SDK is running is the SDK's to say (`SentrySDK.isEnabled`): it is one per process, and a plugin instance only as
    /// long as its view controller. What the plugin does remember is what the page set before the SDK was running: the last change of
    /// each key, applied by `start`.
    private var pending: [String: () -> Void] = [:]

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
