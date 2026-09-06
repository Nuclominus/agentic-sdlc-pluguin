---
name: android-e2e
description: Android E2E and UI automation — Compose UI Test (createAndroidComposeRule, testTag selectors, list matchers), Maestro YAML flows, accessibility/TalkBack audits, adb and instrumented Gradle tasks. Invoke before writing or running end-to-end, instrumented, or accessibility tests on an Android project.
---

# android-e2e

End-to-end verification of user journeys on Android. The QA process, the deliverable, and the
3-attempt iteration cap belong to the core `qa-engineer` agent; this skill supplies the Android
automation stack.

Unit tests for ViewModels, stores, and repositories are **not** in scope — see `android-testing`.

Detect the project's UI toolkit first. The examples below assume Jetpack Compose (no XML /
Fragment / Espresso view matchers); adapt them if the project differs.

## Authoritative references

- `.obsidian-vault/architecture/ui-patterns.md` — the project's UI patterns and the testTag index
- `.obsidian-vault/screens/` — screen inventory (each note's `route:` + `depends_on` edges)
- `.obsidian-vault/business-logic/` — the business flows to validate end-to-end
- `CLAUDE.md` — Gradle commands, flavors

Confirm the app id and host activity from `app/build.gradle.kts` (`applicationId`) before scripting.

## Testing stack

| Tool | Purpose |
|------|---------|
| `androidx.compose.ui:ui-test-junit4` | Compose UI Test (`createAndroidComposeRule`, `onNodeWithTag`) |
| Maestro | YAML E2E flows on device / emulator |
| UIAutomator | Cross-process / system UI interaction (permission dialogs, billing sheets) |
| `AccessibilityChecks` | Automated a11y validation inside Compose UI Test |
| `androidTest` | Instrumented test target |

## Compose UI Test

> Illustrative examples assume Compose + Hilt. Adapt selectors, rules, and DI to the project's
> detected UI toolkit and DI framework.

### Screen instrumented test

```kotlin
@RunWith(AndroidJUnit4::class)
@HiltAndroidTest
class FeatureScreenTest {

    @get:Rule(order = 0) val hiltRule = HiltAndroidRule(this)
    @get:Rule(order = 1) val composeRule = createAndroidComposeRule<MainActivity>()

    @Before fun setUp() { hiltRule.inject() }

    @Test
    fun content_showsUserName() {
        composeRule.onNodeWithTag(TestTag.FeatureTags.USER_NAME)
            .assertIsDisplayed()
            .assertTextEquals("Alice")
    }

    @Test
    fun save_click_navigatesBack() {
        composeRule.onNodeWithTag(TestTag.FeatureTags.SAVE)
            .assertIsEnabled()
            .performClick()

        composeRule.onNodeWithTag(TestTag.FeatureTags.SAVE).assertDoesNotExist()
    }
}
```

### Lists (LazyColumn)

```kotlin
composeRule.onNodeWithTag(TestTag.EffectsTags.LIST)
    .performScrollToIndex(10)

composeRule.onNodeWithText("Effect Name").assertIsDisplayed()

composeRule.onNodeWithTag(TestTag.EffectsTags.LIST)
    .onChildren()
    .filterToOne(hasTestTag(TestTag.EffectsTags.item(0)))
    .performClick()
```

### Common matchers & actions

```kotlin
composeRule.onNodeWithTag(TestTag.FeatureTags.ROOT)
composeRule.onNodeWithText("Submit")
composeRule.onNodeWithContentDescription("Close")

.assertIsDisplayed()
.assertIsEnabled()
.assertIsSelected()
.assertTextContains("Expected")

.performClick()
.performTextInput("hello")
.performTextClearance()
.performScrollToIndex(5)
.performTouchInput { swipeUp() }
```

Selectors are `testTag`s from the central `TestTag` object (`TestTag.<Screen>Tags.<ELEMENT>`), never
inline literals and never localized text — they are the stable identifiers both Compose UI Test and
Maestro consume. The development phase applies them via `Modifier.testTag(...)`; the convention
(grammar, required/exempt rules, where `TestTag` lives) is the `android-compose-ui` skill § Test tags.

**Find a tag fast:** read `.obsidian-vault/architecture/ui-patterns.md` first — its per-screen index
maps Screen → Element → `Constant` → `testTag` value → Component → Interactions. Copy the `Constant`
into a Compose test, or the `testTag` value into a Maestro `id:`. If the screen is missing from the
index, derive the tag from the grammar (`<screen>.<element>`) and flag the gap to the development
phase.

## Maestro E2E flows

```yaml
# .maestro/flows/login_flow.yaml
appId: <applicationId>
---
- launchApp
- assertVisible: "the project"
- tapOn:
    id: "login.email"
- inputText: "test@example.com"
- tapOn:
    id: "login.password"
- inputText: "secret"
- tapOn:
    id: "login.submit"
- assertVisible:
    id: "dashboard.root"
- assertNotVisible:
    id: "login.submit"
```

```yaml
# .maestro/flows/feature_flow.yaml
appId: <applicationId>
---
- launchApp
- tapOn:
    id: "dashboard.tab.feature"
- assertVisible:
    id: "feature.pager"
- swipe:
    direction: LEFT
- assertVisible:
    id: "feature.card"
```

```bash
maestro test .maestro/flows/login_flow.yaml
maestro test .maestro/flows/
maestro studio
maestro --device <device_id> test .maestro/flows/
```

Maestro `id:` values are the `testTag` **value** column from
`.obsidian-vault/architecture/ui-patterns.md` (e.g. `login.email`); they resolve to Compose
`Modifier.testTag(...)`. Coordinate any missing tag with the development phase.

## Accessibility — Compose semantics

- `contentDescription` on informative images / icons; `null` for decorative ones.
- `Modifier.semantics { contentDescription = "…" }` for custom interactive composables.
- Tap targets ≥ 48.dp.
- `stateDescription`, `role = Role.Button`, `heading()` on landmarks.
- Never rely on colour alone.
- A TalkBack walk-through on every critical flow.

### Automated checks in Compose UI Test

```kotlin
@Before fun enableA11y() {
    AccessibilityChecks.enable().setRunChecksFromRootView(true)
}

@Test
fun feature_passesA11y() {
    composeRule.onNodeWithTag(TestTag.FeatureTags.ROOT).assertIsDisplayed()
    // AccessibilityChecks runs on every Espresso/Compose interaction
}
```

## Commands

```bash
# Substitute the project's debug flavor (from its build variants) for <Flavor>:
./gradlew connected<Flavor>DebugAndroidTest
./gradlew connected<Flavor>DebugAndroidTest \
  -Pandroid.testInstrumentationRunnerArguments.class=<applicationId>.ui.feature.FeatureScreenTest
./gradlew install<Flavor>Debug
maestro test .maestro/flows/
```

`adb` (from the SDK platform-tools) is available for lower-level device control when needed:
`adb devices`, `adb install`, `adb shell input`, `adb shell am start`, `adb logcat`,
`adb shell screencap`.

## Android E2E quality checklist

- [ ] Every critical journey in `.obsidian-vault/business-logic/` has a Maestro flow
- [ ] Instrumented tests wire DI correctly (e.g. `HiltAndroidRule` order 0 before
      `createAndroidComposeRule` order 1, if the project uses Hilt + Compose)
- [ ] Selectors are `testTag` constants from `TestTag` (resolved via `ui-patterns.md`), not inline
      literals or localised text
- [ ] Every non-decorative component under test carries a `testTag`; gaps flagged to the
      development phase
- [ ] Accessibility audit passes (content descriptions, 48dp targets, TalkBack)
- [ ] Tests run against the project's debug variant
- [ ] No `Thread.sleep` — use Compose `waitUntil { … }` / Maestro `waitForAnimationToEnd`
- [ ] For a Compose project: no XML / ViewBinding / Espresso `onView(withId(...))`
