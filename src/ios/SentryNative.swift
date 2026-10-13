import Cordova
import Foundation
import Sentry

/// The native Sentry SDK, started and kept in sync from the page. Only the public API of sentry-cocoa:
/// `SentrySDK.start`, `setUser`, `configureScope`, `crash`. No transport, no envelope bridge, no
/// private headers -- the JS SDK sends its own events, this only owns what the page cannot see.
@objc(SentryNative) class SentryNative: CDVPlugin {

    private var started = false

    @objc(start:)
    func start(_ command: CDVInvokedUrlCommand) {
        guard let options = command.argument(at: 0) as? [String: Any], let dsn = options["dsn"] as? String, !dsn.isEmpty else {
            reply(command, ok: false, "start needs an options object with a dsn")
            return
        }
        if started {
            reply(command, ok: true, "already started")
            return
        }
        SentrySDK.start { SentryNative.configure($0, from: options) }
        started = true
        reply(command, ok: true, "started")
    }

    /// The options the page passes, applied to the SDK's. On its own so the mapping can be tested without a running SDK.
    static func configure(_ sentryOptions: Options, from options: [String: Any]) {
        sentryOptions.dsn = options["dsn"] as? String
        if let release = options["release"] as? String { sentryOptions.releaseName = release }
        if let environment = options["environment"] as? String { sentryOptions.environment = environment }
        if let dist = options["dist"] as? String { sentryOptions.dist = dist }
        sentryOptions.enableAppHangTracking = (options["enableAppHangTracking"] as? Bool) ?? true
        // NSNumber, not Double: a JSON 7 arrives as an integer NSNumber, which `as? Double` refuses.
        if let interval = options["appHangTimeoutInterval"] as? NSNumber { sentryOptions.appHangTimeoutInterval = interval.doubleValue }
        // The SDK's default is true, and in a web view it turns every failed HTTP request into an event,
        // which buries the crashes; the page's own SDK already reports what it wants to.
        sentryOptions.enableCaptureFailedRequests = (options["enableCaptureFailedRequests"] as? Bool) ?? false
        sentryOptions.enableAutoSessionTracking = (options["enableAutoSessionTracking"] as? Bool) ?? true
    }

    @objc(setUser:)
    func setUser(_ command: CDVInvokedUrlCommand) {
        guard let dict = command.argument(at: 0) as? [String: Any] else {
            SentrySDK.setUser(nil)
            reply(command, ok: true, "cleared")
            return
        }
        let user = User()
        if let id = dict["id"] as? String { user.userId = id }
        if let email = dict["email"] as? String { user.email = email }
        if let username = dict["username"] as? String { user.username = username }
        SentrySDK.setUser(user)
        reply(command, ok: true, "set")
    }

    @objc(setTags:)
    func setTags(_ command: CDVInvokedUrlCommand) {
        guard let tags = command.argument(at: 0) as? [String: Any] else {
            reply(command, ok: false, "setTags needs an object")
            return
        }
        SentrySDK.configureScope { scope in
            for (key, value) in tags {
                if value is NSNull {
                    scope.removeTag(key: key)
                } else {
                    scope.setTag(value: SentryNative.tagText(value), key: key)
                }
            }
        }
        reply(command, ok: true, "set")
    }

    @objc(setContext:)
    func setContext(_ command: CDVInvokedUrlCommand) {
        guard let key = command.argument(at: 0) as? String, !key.isEmpty else {
            reply(command, ok: false, "setContext needs a key")
            return
        }
        let value = command.argument(at: 1) as? [String: Any]
        SentrySDK.configureScope { scope in
            if let value = value {
                scope.setContext(value: value, key: key)
            } else {
                scope.removeContext(key: key)
            }
        }
        reply(command, ok: true, "set")
    }

    /// For a device probe: the process goes down, so this never answers.
    @objc(crash:)
    func crash(_ command: CDVInvokedUrlCommand) {
        SentrySDK.crash()
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
