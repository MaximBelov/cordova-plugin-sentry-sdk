// swift-tools-version:5.9
import PackageDescription

// The newest sentry-cocoa release. SPM serves its prebuilt xcframework, so the app build does not
// compile the SDK; the CocoaPods trunk stopped at 9.19.1 and is not used here.
let sentryCocoaVersion: Version = "9.30.1"

let package = Package(
    name: "cordova-plugin-sentry-sdk",
    platforms: [.iOS(.v15)],
    products: [
        .library(name: "cordova-plugin-sentry-sdk", targets: ["SentryNative"])
    ],
    dependencies: [
        .package(url: "https://github.com/apache/cordova-ios.git", branch: "master"),
        .package(url: "https://github.com/getsentry/sentry-cocoa.git", exact: sentryCocoaVersion),
    ],
    targets: [
        .target(
            name: "SentryNative",
            dependencies: [
                .product(name: "Cordova", package: "cordova-ios"),
                .product(name: "Sentry", package: "sentry-cocoa"),
            ],
            path: "src/ios"
        )
    ]
)
