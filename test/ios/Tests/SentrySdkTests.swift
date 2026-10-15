import Cordova
import Sentry
import XCTest
@testable import SentrySdk

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
final class SentrySdkTests: XCTestCase {
    /// A DSN whose host answers nothing: the SDK starts, and no project receives a test session.
    static let dsn = "https://0123456789abcdef0123456789abcdef@127.0.0.1:9/1"

    private var plugin: SentrySdk!
    private var delegate: RecordingCommandDelegate!

    override func setUp() {
        super.setUp()
        plugin = SentrySdk()
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
        run(method, args, on: plugin, recordedBy: delegate)
    }

    @discardableResult
    private func run(_ method: String, _ args: [Any], on target: SentrySdk, recordedBy recorder: RecordingCommandDelegate) -> CDVPluginResult {
        calls += 1
        let command = CDVInvokedUrlCommand(arguments: args, callbackId: "cb\(calls)", className: "SentrySdk", methodName: method)!
        let before = recorder.results.count
        switch method {
        case "start": target.start(command)
        case "setUser": target.setUser(command)
        case "setTags": target.setTags(command)
        case "setContext": target.setContext(command)
        case "addBreadcrumb": target.addBreadcrumb(command)
        case "clearBreadcrumbs": target.clearBreadcrumbs(command)
        case "crash": target.crash(command)
        default: XCTFail("no such method: \(method)")
        }
        XCTAssertEqual(recorder.results.count, before + 1, "\(method) answers exactly once")
        return recorder.results.last!
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

    func testStartWithADsnThatDoesNotParseIsRefusedAndTheSdkStaysOffSoAGoodOneCanFollow() {
        // sentry-cocoa starts without a dsn, silently, when it cannot parse the one it is given: the plugin must not answer "started".
        let refused = run("start", [["dsn": "not a dsn"]])
        XCTAssertEqual(status(refused), CDVCommandStatus_ERROR)
        XCTAssertTrue((refused.message as? String ?? "").contains("start was refused"))
        XCTAssertFalse(SentrySDK.isEnabled)

        XCTAssertEqual(run("start", [["dsn": Self.dsn]]).message as? String, "started")
        XCTAssertTrue(SentrySDK.isEnabled)
    }

    func testScopeCallsBeforeStartAreKeptAndAnsweredQueuedAndStartAppliesTheLastChangeOfEachKey() {
        XCTAssertEqual(run("setUser", [["id": "1"]]).message as? String, "queued")
        XCTAssertEqual(run("setUser", [["id": "42", "email": "user@example.com"]]).message as? String, "queued")
        XCTAssertEqual(run("setTags", [["region": "IE", "gone": "soon", "tier": 1]]).message as? String, "queued")
        XCTAssertEqual(run("setTags", [["gone": NSNull(), "tier": 2]]).message as? String, "queued")
        XCTAssertEqual(run("setContext", ["account", ["animals": 7]]).message as? String, "queued")
        XCTAssertEqual(run("setContext", ["account", ["animals": 120]]).message as? String, "queued")
        XCTAssertEqual(run("setContext", ["farm", ["region": "IE"]]).message as? String, "queued")
        XCTAssertEqual(run("setContext", ["farm", NSNull()]).message as? String, "queued")
        XCTAssertFalse(SentrySDK.isEnabled, "nothing started the SDK")

        XCTAssertEqual(run("start", [["dsn": Self.dsn]]).message as? String, "started")

        let serialized = scope().serialize()
        let user = serialized["user"] as? [String: Any]
        XCTAssertEqual(user?["id"] as? String, "42", "the last user wins")
        XCTAssertEqual(user?["email"] as? String, "user@example.com")
        let tags = scope().tags
        XCTAssertEqual(tags["region"], "IE")
        XCTAssertEqual(tags["tier"], "2", "the last value of a tag wins")
        XCTAssertNil(tags["gone"], "a tag removed before start is not there")
        let contexts = serialized["context"] as? [String: Any]
        XCTAssertEqual((contexts?["account"] as? [String: Any])?["animals"] as? Int, 120)
        XCTAssertNil(contexts?["farm"], "a context removed before start is not there")

        // what was kept is applied once: a later change is the page's own, not a replay
        XCTAssertEqual(run("setTags", [["tier": 3]]).message as? String, "set")
        XCTAssertEqual(scope().tags["tier"], "3")
    }

    func testAUserClearedBeforeStartStaysCleared() {
        run("setUser", [["id": "42"]])
        XCTAssertEqual(run("setUser", [NSNull()]).message as? String, "queued")
        run("start", [["dsn": Self.dsn]])
        XCTAssertNil(scope().serialize()["user"])
    }

    func testASecondPluginInstanceFindsTheSdkRunningAndWorksOnIt() {
        run("start", [["dsn": Self.dsn, "release": "tests@0.1.0"]])

        // a view controller that is made again brings new plugin instances to an SDK that is still up
        let recreated = SentrySdk()
        let recreatedDelegate = RecordingCommandDelegate()
        recreated.commandDelegate = recreatedDelegate
        XCTAssertEqual(
            run("start", [["dsn": Self.dsn, "release": "other"]], on: recreated, recordedBy: recreatedDelegate).message as? String,
            "already started"
        )
        XCTAssertEqual(
            run("setTags", [["from": "second"]], on: recreated, recordedBy: recreatedDelegate).message as? String,
            "set",
            "a scope call is applied, not queued"
        )
        XCTAssertEqual(scope().tags["from"], "second")
    }

    func testAnSdkTheAppStartedItselfCountsAsStarted() {
        SentrySDK.start { options in
            options.dsn = Self.dsn
            options.releaseName = "app@1"
        }
        XCTAssertEqual(run("start", [["dsn": Self.dsn, "release": "tests@0.1.0"]]).message as? String, "already started")
        XCTAssertTrue(SentrySDK.isEnabled)
    }

    func testTheOptionsThePagePassesReachTheSdkOptions() {
        let options = Options()
        SentrySdk.configure(options, from: [
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
        XCTAssertEqual(options.enableMetricKit, Options().enableMetricKit, "unset keeps the SDK's default")

        let explicit = Options()
        SentrySdk.configure(explicit, from: [
            "dsn": Self.dsn, "enableCaptureFailedRequests": true, "enableAppHangTracking": false, "enableAutoSessionTracking": false,
            "enableMetricKit": true,
        ])
        XCTAssertEqual(explicit.enableCaptureFailedRequests, true)
        XCTAssertEqual(explicit.enableAppHangTracking, false)
        XCTAssertEqual(explicit.enableAutoSessionTracking, false)
        XCTAssertEqual(explicit.enableMetricKit, true)
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

    /// The scope's breadcrumbs that these tests added (their category starts with `t.`), serialised the way an event carries them; the SDK
    /// adds some of its own at start.
    private func crumbs() -> [[String: Any]] {
        let all = scope().serialize()["breadcrumbs"] as? [[String: Any]] ?? []
        return all.filter { ($0["category"] as? String ?? "").hasPrefix("t.") }
    }

    func testABreadcrumbAddedAfterStartLandsOnTheScopeWithWhatItWasGivenNestedDataIncluded() {
        run("start", [["dsn": Self.dsn]])
        let data: [String: Any] = ["id": 7, "ok": true, "nested": ["list": ["a", 1]]]
        let result = run("addBreadcrumb", [["type": "http", "category": "t.fetch", "message": "GET /api", "level": "warning", "data": data]])
        XCTAssertEqual(result.message as? String, "added")

        let crumb = crumbs().first
        XCTAssertEqual(crumbs().count, 1)
        XCTAssertEqual(crumb?["type"] as? String, "http")
        XCTAssertEqual(crumb?["message"] as? String, "GET /api")
        XCTAssertEqual(crumb?["level"] as? String, "warning")
        let seen = crumb?["data"] as? [String: Any]
        XCTAssertEqual(seen?["id"] as? Int, 7)
        XCTAssertEqual(seen?["ok"] as? Bool, true)
        XCTAssertEqual((seen?["nested"] as? [String: Any])?["list"] as? [AnyHashable], ["a", 1])
    }

    func testTheLevelsAreTheSdksAndABreadcrumbWithNoneIsInfo() {
        let levels: [(String?, SentryLevel)] = [("fatal", .fatal), ("error", .error), ("warning", .warning), ("info", .info), ("debug", .debug), (nil, .info)]
        for (name, expected) in levels {
            var dict: [String: Any] = ["category": "t.level"]
            if let name = name { dict["level"] = name }
            XCTAssertEqual(SentrySdk.breadcrumb(from: dict).level, expected, name ?? "no level")
        }
    }

    func testABreadcrumbTakesItsTimestampInSecondsAndTheTimeOfTheCallWithout() {
        XCTAssertEqual(SentrySdk.breadcrumb(from: ["category": "t.time", "timestamp": 1_760_000_000.5]).timestamp?.timeIntervalSince1970, 1_760_000_000.5)
        let before = Date()
        let stamped = SentrySdk.breadcrumb(from: ["category": "t.time"]).timestamp
        XCTAssertNotNil(stamped)
        XCTAssertGreaterThanOrEqual(stamped!, before.addingTimeInterval(-1))
    }

    func testBreadcrumbsAddedBeforeStartAreKeptInOrderAnsweredQueuedAndStartAddsThem() {
        for i in 1...3 {
            XCTAssertEqual(run("addBreadcrumb", [["category": "t.\(i)", "message": "m\(i)"]]).message as? String, "queued")
        }
        XCTAssertFalse(SentrySDK.isEnabled, "nothing started the SDK")

        run("start", [["dsn": Self.dsn]])
        XCTAssertEqual(crumbs().compactMap { $0["message"] as? String }, ["m1", "m2", "m3"])

        // what was kept is added once: a later one is the page's own, not a replay
        XCTAssertEqual(run("addBreadcrumb", [["category": "t.4", "message": "m4"]]).message as? String, "added")
        XCTAssertEqual(crumbs().compactMap { $0["message"] as? String }, ["m1", "m2", "m3", "m4"])
    }

    func testAClearBeforeStartDropsWhatWasKeptAndAClearAfterItEmptiesTheScope() {
        run("addBreadcrumb", [["category": "t.1", "message": "dropped"]])
        XCTAssertEqual(run("clearBreadcrumbs", []).message as? String, "cleared")
        run("addBreadcrumb", [["category": "t.2", "message": "kept"]])
        run("start", [["dsn": Self.dsn]])
        XCTAssertEqual(crumbs().compactMap { $0["message"] as? String }, ["kept"])

        XCTAssertEqual(run("clearBreadcrumbs", []).message as? String, "cleared")
        XCTAssertEqual(crumbs().count, 0)
    }

    func testTheNewestOfMoreThanAHundredBreadcrumbsKeptBeforeStartAreWhatStartAdds() {
        for i in 1...130 { run("addBreadcrumb", [["category": "t.\(i)", "message": "m\(i)"]]) }
        run("start", [["dsn": Self.dsn]])
        let numbers = crumbs().compactMap { ($0["message"] as? String).flatMap { Int($0.dropFirst()) } }
        // The SDK holds a hundred in all, its own among them, so one or two of the page's go to make room for its start.
        XCTAssertTrue((98...100).contains(numbers.count), "\(numbers.count) breadcrumbs")
        XCTAssertEqual(numbers, Array((131 - numbers.count)...130), "the newest, in order, none missing")
    }

    func testAddBreadcrumbWithoutAnObjectIsRefused() {
        let result = run("addBreadcrumb", [NSNull()])
        XCTAssertEqual(status(result), CDVCommandStatus_ERROR)
        XCTAssertTrue((result.message as? String ?? "").contains("addBreadcrumb"))
    }

    /// The crash itself takes the process down, so it never answers: this calls it the way Cordova does and says whether it went ahead.
    private func crashAnswers() -> Int {
        let before = delegate.results.count
        plugin.crash(CDVInvokedUrlCommand(arguments: [], callbackId: "crash", className: "SentrySdk", methodName: "crash")!)
        return delegate.results.count - before
    }

    func testCrashIsRefusedUntilAStartAllowsItAndTheLastAcceptedStartDecides() {
        var crashes = 0
        plugin.crashAction = { crashes += 1 }
        let refused = run("crash", [])
        XCTAssertEqual(status(refused), CDVCommandStatus_ERROR)
        XCTAssertTrue((refused.message as? String ?? "").contains("allowCrash"))

        run("start", [["dsn": Self.dsn]])
        XCTAssertEqual(status(run("crash", [])), CDVCommandStatus_ERROR, "a start without the option does not allow it")

        run("start", [["dsn": Self.dsn, "allowCrash": true]])
        run("start", [["dsn": Self.dsn]])
        XCTAssertEqual(status(run("crash", [])), CDVCommandStatus_ERROR, "the last start takes it away again")
        XCTAssertEqual(crashes, 0, "nothing crashed")
    }

    func testCrashGoesAheadWhenStartAllowedIt() {
        var crashes = 0
        plugin.crashAction = { crashes += 1 }
        run("start", [["dsn": Self.dsn, "allowCrash": true]])
        XCTAssertEqual(crashAnswers(), 0, "the crash does not answer: the process would be gone")
        XCTAssertEqual(crashes, 1)
    }

    func testAStartThatFindsTheSdkRunningStillTakesTheAllowCrashItIsGiven() {
        var crashes = 0
        plugin.crashAction = { crashes += 1 }
        run("start", [["dsn": Self.dsn]])
        XCTAssertEqual(run("start", [["dsn": Self.dsn, "allowCrash": true]]).message as? String, "already started")
        XCTAssertEqual(crashAnswers(), 0)
        XCTAssertEqual(crashes, 1)
    }
}
