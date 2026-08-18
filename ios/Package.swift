// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "ScholarPolicy",
    platforms: [
        .macOS(.v13),
        .iOS(.v16)
    ],
    products: [
        .library(name: "ScholarPolicy", targets: ["ScholarPolicy"])
    ],
    targets: [
        .target(
            name: "ScholarPolicy",
            path: "PolicyCore"
        ),
        .testTarget(
            name: "ScholarPolicyTests",
            dependencies: ["ScholarPolicy"],
            path: "PolicyCoreTests"
        )
    ]
)
