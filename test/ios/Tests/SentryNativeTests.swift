import Cordova
import Sentry
import XCTest
@testable import SentryNative

/// Records what the plugin sends to JavaScript. Everything else of the protocol is unused by these tests.
final class RecordingCommandDelegate: NSObject, CDVCommandDelegate {
    var results: [CDVPluginResult] = []
    var settings: CDVSettingsDictionary! { CDVSettingsDictionary() }
    func path(forResource resourcepath: String) -> String { "" }
    func getCommandInstance(_ pluginName: String) -> CDVPlugin? { nil }
    func send(_ result: CDVPluginResult, callbackId: String) { results.append(result) }
    func evalJs(_ js: String) {}
    func evalJs(_ js: String, scheduledOnRunLoop: Bool) {}
    func run(inBackground block: @escaping () -> Void) { block() }
}

/// What the plugin answers JavaScript, and what it puts on the native scope, with sentry-cocoa started for real against a DSN whose
/// host answers nothing. No app: the plugin is driven the way Cordova drives it, one CDVInvokedUrlCommand per call.
final class SentryNativeTests: XCTestCase {
    /// A DSN whose host answers nothing: the SDK starts, and no project receives a test session.
    static let dsn = "https://0123456789abcdef0123456789abcdef@127.0.0.1:9/1"

    private var plugin: SentryNative!
    private var delegate: RecordingCommandDelegate!

    override func setUp() {
        super.setUp()
        plugin = SentryNative()
        delegate = RecordingCommandDelegate()
        plugin.commandDelegate = delegate
    }

    override func tearDown() {
        SentrySDK.close()
        super.tearDown()
    }

    private var calls = 0

    /// Runs an action the way Cordova does and returns what the plugin sent back.
    @discardableResult
    private func run(_ method: String, _ args: [Any]) -> CDVPluginResult {
        calls += 1
        let command = CDVInvokedUrlCommand(arguments: args, callbackId: "cb\(calls)", className: "SentryNative", methodName: method)!
        let before = delegate.results.count
        switch method {
        case "start": plugin.start(command)
        case "setUser": plugin.setUser(command)
        case "setTags": plugin.setTags(command)
        case "setContext": plugin.setContext(command)
        default: XCTFail("no such method: \(method)")
        }
        XCTAssertEqual(delegate.results.count, before + 1, "\(method) answers exactly once")
        return delegate.results.last!
    }

    private func status(_ result: CDVPluginResult) -> CDVCommandStatus {
        CDVCommandStatus(rawValue: result.status.uintValue)!
    }

    private func scope() -> Scope {
        var seen: Scope!
        SentrySDK.configureScope { seen = $0 }
        return seen
    }

    func testStartWithoutADsnIsRefused() {
        let result = run("start", [["dsn": ""]])
        XCTAssertEqual(status(result), CDVCommandStatus_ERROR)
        XCTAssertTrue((result.message as? String ?? "").contains("dsn"))
        XCTAssertFalse(SentrySDK.isEnabled)
    }

    func testStartStartsTheSdkOnceAndASecondStartChangesNothing() {
        let first = run("start", [["dsn": Self.dsn, "release": "tests@0.1.0", "environment": "test"]])
        XCTAssertEqual(status(first), CDVCommandStatus_OK)
        XCTAssertEqual(first.message as? String, "started")
        XCTAssertTrue(SentrySDK.isEnabled)

        let second = run("start", [["dsn": "https://other@127.0.0.1:9/2", "release": "other"]])
        XCTAssertEqual(status(second), CDVCommandStatus_OK)
        XCTAssertEqual(second.message as? String, "already started")
        XCTAssertTrue(SentrySDK.isEnabled)
    }

    func testTheOptionsThePagePassesReachTheSdkOptions() {
        let options = Options()
        SentryNative.configure(options, from: [
            "dsn": Self.dsn, "release": "tests@0.1.0", "environment": "test", "dist": "7", "appHangTimeoutInterval": 7,
        ])
        XCTAssertEqual(options.dsn, Self.dsn)
        XCTAssertEqual(options.releaseName, "tests@0.1.0")
        XCTAssertEqual(options.environment, "test")
        XCTAssertEqual(options.dist, "7")
        XCTAssertEqual(options.appHangTimeoutInterval, 7)
        // the two defaults this plugin sets against the SDK's own, and the one it keeps
        XCTAssertEqual(options.enableCaptureFailedRequests, false)
        XCTAssertEqual(options.enableAppHangTracking, true)
        XCTAssertEqual(options.enableAutoSessionTracking, true)

        let explicit = Options()
        SentryNative.configure(explicit, from: [
            "dsn": Self.dsn, "enableCaptureFailedRequests": true, "enableAppHangTracking": false, "enableAutoSessionTracking": false,
        ])
        XCTAssertEqual(explicit.enableCaptureFailedRequests, true)
        XCTAssertEqual(explicit.enableAppHangTracking, false)
        XCTAssertEqual(explicit.enableAutoSessionTracking, false)
        XCTAssertEqual(explicit.appHangTimeoutInterval, Options().appHangTimeoutInterval, "unset keeps the SDK's default")
    }

    func testSetUserPutsTheUserOnTheScopeAndNullClearsIt() {
        run("start", [["dsn": Self.dsn]])
        XCTAssertEqual(run("setUser", [["id": "42", "email": "user@example.com", "username": "tester"]]).message as? String, "set")
        let user = scope().serialize()["user"] as? [String: Any]
        XCTAssertEqual(user?["id"] as? String, "42")
        XCTAssertEqual(user?["email"] as? String, "user@example.com")
        XCTAssertEqual(user?["username"] as? String, "tester")

        XCTAssertEqual(run("setUser", [NSNull()]).message as? String, "cleared")
        XCTAssertNil(scope().serialize()["user"])
    }

    func testSetTagsSetsEachTagAsTextAndRemovesTheNullOnes() {
        run("start", [["dsn": Self.dsn]])
        run("setTags", [["gone": "soon"]])
        let result = run("setTags", [["account.region": "IE", "premium": true, "animals": 12, "gone": NSNull()]])
        XCTAssertEqual(result.message as? String, "set")
        let tags = scope().tags
        XCTAssertEqual(tags["account.region"], "IE")
        XCTAssertEqual(tags["premium"], "true", "a JSON boolean is true/false, not 1/0")
        XCTAssertEqual(tags["animals"], "12")
        XCTAssertNil(tags["gone"])
    }

    func testSetTagsWithoutAnObjectIsRefused() {
        XCTAssertEqual(status(run("setTags", [NSNull()])), CDVCommandStatus_ERROR)
    }

    func testSetContextPutsANamedObjectOnTheScopeAndNullRemovesIt() {
        run("start", [["dsn": Self.dsn]])
        XCTAssertEqual(run("setContext", ["account", ["animals": 120, "premium": true]]).message as? String, "set")
        let contexts = scope().serialize()["context"] as? [String: Any]
        let account = contexts?["account"] as? [String: Any]
        XCTAssertEqual(account?["animals"] as? Int, 120)
        XCTAssertEqual(account?["premium"] as? Bool, true)

        XCTAssertEqual(run("setContext", ["account", NSNull()]).message as? String, "set")
        let after = scope().serialize()["context"] as? [String: Any]
        XCTAssertNil(after?["account"])
    }

    func testSetContextWithoutAKeyIsRefused() {
        XCTAssertEqual(status(run("setContext", ["", ["x": 1]])), CDVCommandStatus_ERROR)
    }
}
