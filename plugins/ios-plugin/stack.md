---
stack: ios
priority: 300
aspects: [ios]
detect:
  any:
    - file_glob: "**/*.xcodeproj"     # app-only Xcode projects (variable-named)
    - file_glob: "**/*.xcworkspace"   # workspace-based projects
    - file_exists: Package.swift      # SPM packages
---

# iOS (Swift/SwiftUI) Stack Profile

Native iOS stack provider. Triggers on an Xcode project / workspace or an SPM package containing Swift.
Aspect: `ios` (in a mobile monorepo with an Android module, both win their aspect; dev/qa fan out).

> **Host-dependent.** swiftlint/swiftformat and `xcodebuild` exist only on macOS + Xcode.
> `swift test` covers SPM packages, not app targets. Off macOS, verification degrades to review only
> and is deferred to CI. The agent and /doctor report host capability up front.

## Agents per phase

- business_analysis: business-analyst        # core agent
- development: ios-architect                 # ⚡ iOS-specific
- qa: qa-engineer                            # core agent
- security: security-analyst                 # core agent
- documentation: document-writer             # core agent

## Convention skills to apply

- ios-plugin:swiftui-ui
- ios-plugin:ios-architecture
- ios-plugin:ios-data
- ios-plugin:ios-navigation

## Extra phases

(none)

## Phase prompts injection

For development phase, inject:
  "Native iOS (Swift) project. SwiftUI-first.
   State: @Observable (iOS 17+) or ObservableObject — DETECT the project's deployment-target baseline.   # TODO: pin
   Concurrency: structured concurrency (async/await) over completion handlers; @MainActor for UI state.
   DI by initializer injection. Secrets in Keychain, never UserDefaults or source.
   Adding a Swift file to an Xcode app target mutates project.pbxproj — prefer SPM modules / folder
   references where the project allows; otherwise flag the .pbxproj change in DECISIONS.   # see Open Question #1
   Apply skills: ios-plugin:swiftui-ui, ios-plugin:ios-architecture, ios-plugin:ios-data, ios-plugin:ios-navigation."

For qa phase, inject:
  "iOS testing: XCTest or the swift-testing framework (@Test/#expect) per project baseline.
   `swift test` runs for SPM packages only. xcodebuild test needs macOS + Xcode + a simulator — CI-only.
   If not on macOS, write the tests but state that execution is deferred to CI."

For security phase, inject:
  "iOS-specific (MASVS/MASTG): secrets in Keychain not UserDefaults; ATS/TLS enforced; certificate pinning
   where required; validate Universal Links / custom URL schemes; LocalAuthentication (Face/Touch ID) as
   step-up not primary; no secrets in source/VCS or Info.plist."

## Pre-phase commands

(none)

## Post-pipeline checks

Capability-gated. Each step is a no-op (with a warning) when its tool is unavailable.

- sh -c 'command -v swiftlint >/dev/null 2>&1 && swiftlint --quiet || echo "[ios] swiftlint unavailable — skipped"'
- sh -c 'test -f Package.swift && swift test 2>/dev/null || echo "[ios] no SPM package / swift test unavailable — skipped"'
# xcodebuild test is intentionally OFF by default (slow, macOS+Xcode only). Enable per-project if desired.
