// swift-tools-version:5.9
// The plugin's Swift, built against cordova-ios and sentry-cocoa and tested with XCTest on an iOS simulator:
//   cd test/ios && xcodebuild test -scheme SentrySdk -destination 'platform=iOS Simulator,name=iPhone 17 Pro'
// (`npm run test:ios`). Sources/SentrySdk is a link to src/ios, so the tests build what the plugin ships. The sentry-cocoa
// version is the one the root Package.swift pins; test/unit/platform-parity.test.mjs keeps the two equal.
import PackageDescription

let sentryCocoaVersion: Version = "9.30.2"

let package = Package(
    name: "SentrySdk",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "SentrySdk", targets: ["SentrySdk"])
    ],
    dependencies: [
        .package(path: "../../node_modules/cordova-ios"),
        .package(url: "https://github.com/getsentry/sentry-cocoa.git", exact: sentryCocoaVersion),
    ],
    targets: [
        .target(
            name: "SentrySdk",
            dependencies: [
                .product(name: "Cordova", package: "cordova-ios"),
                .product(name: "Sentry", package: "sentry-cocoa"),
            ],
            path: "Sources/SentrySdk"
        ),
        .testTarget(
            name: "SentrySdkTests",
            dependencies: ["SentrySdk"],
            path: "Tests"
        ),
    ]
)
