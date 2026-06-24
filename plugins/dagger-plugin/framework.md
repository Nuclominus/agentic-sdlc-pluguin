---
stack: dagger
additive: true
priority: 150
aspects: []
# The FUNCTIONAL category this framework decorates. It attaches under any foundation whose
# `hosts_aspects` includes `di`. Replaces any plugin→plugin dependency.
enriches_aspect: di
# Just name the library. The hosting FOUNDATION declares WHERE to look (via its `framework_detection`:
# version catalog first, then module build files); the orchestrator executes that search on the
# foundation's behalf — see 0b-frameworks in the pipeline-orchestrator skill.
# `com.google.dagger` covers both plain Dagger and Hilt (hilt-android, hilt-compiler).
dependency: com.google.dagger
---

# Dagger / Hilt — Framework Provider (additive)

Additive framework provider for Dagger / Hilt dependency injection. Detect-activated: it contributes
guidance to **existing** phases and ships **no agents** — it specializes the foundation's
`android-developer` and `android-security` prompts. `priority` here is documentational only; additive
profiles never compete for or win an aspect.

The foundation states only the **generic** DI principle (use the project's DI framework, constructor
injection, deliberate scoping). This plugin adds the **Hilt/Dagger-specific** guidance when
`com.google.dagger` is detected. A project on a different DI framework (e.g. Koin) simply does not
activate this plugin — that is the "detect, don't impose" resolution.

This profile only **names** the dependency (`com.google.dagger`) and the functional category it enriches
(`di`); the hosting **foundation** (whose `hosts_aspects` includes `di`) declares where to look (version
catalog first, then module build files) and the orchestrator executes that search. Toggle explicitly from
a project's `.claude/sdlc.local.yaml`:

```yaml
frameworks:
  enable: [dagger]    # force-on even if detection missed it
  disable: [dagger]   # suppress even if detected
```

## Convention skills to apply

- dagger-plugin:hilt-conventions

## Extra phases

(none — frameworks enrich existing phases, they do not own one)

## Phase prompts injection

For development phase, inject:
  "Dagger/Hilt is present. Prefer constructor injection with `@Inject`; reserve field injection for
   framework entry points (`@AndroidEntryPoint` Activities/Fragments/Services, `@HiltAndroidApp`
   Application). ViewModels use `@HiltViewModel` + an `@Inject constructor`. Bindings live in `@Module`
   + `@InstallIn(<component>)`; prefer `@Binds` for interface→impl, `@Provides` only for types you do not
   own. Scope deliberately (`@Singleton`, `@ActivityRetainedScoped`, `@ViewModelScoped`) — do not make
   everything `@Singleton`. Expose dispatchers via qualifiers (e.g. `@IoDispatcher`) per the hosting
   foundation's data-layer conventions. Generate hilt-compiler with KSP, not KAPT. See the
   dagger-plugin:hilt-conventions skill."

For security phase, inject:
  "Dagger/Hilt: do not keep security-sensitive material (decrypted keys, tokens, plaintext credentials)
   in long-lived `@Singleton` graphs longer than needed — scope it to the narrowest lifetime and clear it.
   Be deliberate with `@EntryPoint` / `EntryPointAccessors`: they bypass normal injection and can expose
   internal bindings — only expose what is required. Apply the R8/ProGuard keep rules in
   dagger-plugin/rules/snippets/hilt-proguard.md when the project ships R8."

## Pre-phase commands

(none)

## Post-pipeline checks

(none — DI has no standalone Gradle gate beyond the foundation's compile/test/lint; graph validity is
checked at compile time)
