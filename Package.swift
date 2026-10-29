// swift-tools-version:5.9
import PackageDescription

// The newest sentry-cocoa release. SPM serves its prebuilt xcframework, so the app build does not
// compile the SDK; the newest Sentry pod on the CocoaPods trunk is 9.19.1 (2026-07-01), so CocoaPods is not used here.
let sentryCocoaVersion: Version = "9.31.0"

let package = Package(
    name: "cordova-plugin-sentry-sdk",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "cordova-plugin-sentry-sdk", targets: ["SentrySdk"])
    ],
    dependencies: [
        .package(url: "https://github.com/apache/cordova-ios.git", branch: "master"),
        .package(url: "https://github.com/getsentry/sentry-cocoa.git", exact: sentryCocoaVersion),
    ],
    targets: [
        .target(
            name: "SentrySdk",
            dependencies: [
                .product(name: "Cordova", package: "cordova-ios"),
                .product(name: "Sentry", package: "sentry-cocoa"),
            ],
            path: "src/ios"
        )
    ]
)
