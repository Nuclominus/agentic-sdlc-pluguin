---
name: android-security-masvs
description: Android security audit against OWASP MASVS/MASTG — secrets, TLS and pinning, secure storage and Keystore, auth and biometrics, realtime/billing boundaries, manifest and exported components, ProGuard/R8, plus the MASVS control map and the OWASP Mobile Top 10 cross-map. Invoke before auditing an Android codebase.
---

# android-security-masvs

The audit content for an Android (Kotlin, modular `:feature:<name>`) codebase. The report shape,
the severity ladder, the `ISSUES_FOUND:` machine contract, and the read-only discipline belong to
the core `security-analyst` agent; this skill supplies **what to check and against what standard**.

**MASVS** (OWASP Mobile Application Security Verification Standard) is the authoritative standard;
**MASTG** supplies the concrete test procedures. Cite the MASVS control group *and* the MASTG test
ID in each finding's Reference field.

Detect the project's actual stack — HTTP client, auth, realtime, billing, storage — from the
codebase before auditing. Do not assume a vendor.

## Knowledge sourcing

Read the vault notes for the project's security-sensitive areas before auditing: secure persistence
(encryption + Keystore), networking (HTTP client + TLS), authentication/session, realtime/backend
services, and billing. Follow each note's `depends_on` edges to see what a sensitive module pulls
in, and read `.obsidian-vault/architecture/dependency-graph.md` for the whole graph. `CLAUDE.md`
documents which `config/*.properties` are injected into `BuildConfig`.

## Security audit coverage

### 1. Credentials & secrets · MASVS-STORAGE / MASVS-CRYPTO / MASVS-CODE
- [ ] No hardcoded API keys / tokens / passwords in code or resources
- [ ] All secrets sourced from `config/*.properties` → `BuildConfig` (never committed raw)
- [ ] `config/keystore.properties`, `config/encryption.properties`, `local.properties` excluded from git
- [ ] No `config/<service>.properties` checked in with production values
- [ ] No credentials in Gradle scripts, convention plugins, or CI workflows

### 2. Network — the project's HTTP client · MASVS-NETWORK
- [ ] TLS enforced — no `http://` in production
- [ ] Certificate pinning for the backend and any sensitive hosts
- [ ] No hostname verifier override that accepts all hosts
- [ ] Explicit connect / read / write timeouts
- [ ] Response models deserialized via the project's serializer; schema validated at the boundary
- [ ] Sensitive endpoints and thresholds sourced from `config/*.properties`, not hardcoded

> Illustrative example (OkHttp). Adapt to the project's HTTP client.

```kotlin
OkHttpClient.Builder()
    .certificatePinner(
        CertificatePinner.Builder()
            .add(BuildConfig.API_HOST, "sha256/…")
            .build()
    )
    .connectTimeout(10, TimeUnit.SECONDS)
    .readTimeout(30, TimeUnit.SECONDS)
    .build()
```

### 3. Secure storage · MASVS-STORAGE / MASVS-CRYPTO
- [ ] Sensitive data (tokens, PII) persisted via encrypted storage — never plain `SharedPreferences`
- [ ] Keystore aliases and crypto parameters sourced from `config/encryption.properties`
- [ ] The IV is randomly generated per encryption and stored alongside the ciphertext — never
      reused, never hardcoded
- [ ] Databases with sensitive columns use at-rest encryption (e.g. SQLCipher) where applicable
- [ ] No tokens in files world-readable via `adb pull`

### 4. Authentication · MASVS-AUTH
- [ ] Session/auth tokens stored in encrypted persistence; cleared on logout
- [ ] Identity tokens refreshed securely; never logged
- [ ] Biometric prompts use `BiometricPrompt` + `CryptoObject` — as step-up, not as the primary factor
- [ ] No tokens in URL query parameters; no tokens in logs
- [ ] Logout clears the session, cached credentials, realtime subscriptions, and active
      media/realtime sessions

### 5. Realtime / backend boundaries · MASVS-NETWORK / MASVS-AUTH
For each realtime or backend service the project uses:
- Channel/topic auth endpoint signed server-side; names validated before subscribe; unsubscribe on teardown
- Subscriptions access-controlled (ACL / permission scoped); unsubscribe on `DisposableEffect` / store close
- Signalling / message payload schema validated at the boundary; untrusted relays or peers rejected;
  media permissions gated

### 6. Billing / subscriptions · MASVS-AUTH / MASVS-CODE
- [ ] Purchase tokens verified server-side before unlocking entitlements
- [ ] Billing client connection lifecycle respected; no stale clients
- [ ] Acknowledgement performed after server verification
- [ ] A single billing SDK used consistently (no mixed third-party billing layers)

### 7. Manifest & components · MASVS-PLATFORM
- [ ] `android:allowBackup="false"` (or explicit `fullBackupContent` / `dataExtractionRules`)
- [ ] `android:debuggable` never `true` in `release` types
- [ ] Deep link URIs validated against an allow-list before use
- [ ] Implicit intents use an explicit package/class
- [ ] Exported components declare proper permissions
- [ ] No sensitive data in production logs (`BuildConfig.DEBUG` guard)

> Illustrative example (Kermit `taggedLogger`). Adapt to the project's logging library.

```kotlin
private val log = taggedLogger("AuthRepository")

if (BuildConfig.DEBUG) {
    log.d { "session=$token" }
}
```

### 8. ProGuard / R8 · MASVS-RESILIENCE / MASVS-CODE
- [ ] R8 enabled for the release artifact (any non-minified profiling type intentionally off)
- [ ] Serialization and networking model classes kept
- [ ] Database entities kept
- [ ] The project's third-party SDKs keep-listed (auth, realtime, billing, …)
- [ ] DI-generated code kept
- [ ] No blanket `-keep class **` rules
- [ ] Native JNI methods (if any) kept

The reusable serialization / database / DI keep rules live in the foundation's
`rules/snippets/proguard-keep.md` (templated on `<applicationId>`); the orchestrated prompt lists its
absolute path. Add keep rules for the project's own third-party SDKs — detect them from
`gradle/libs.versions.toml`.

### 9. Android-specific · MASVS-PLATFORM / MASVS-CODE
- [ ] No `!!` in security-critical paths
- [ ] Room queries parameterized — no raw string concatenation
- [ ] WebView (if used) has JavaScript disabled unless explicitly required, and file access off
- [ ] Exported `BroadcastReceiver` / `ContentProvider` validates the calling package

## Finding content (Android specifics)

For each finding give **every** affected site on the path, not just the first, and make the
remediation executable by the development phase: exact file, exact line, exact edit, plus what to
verify afterwards. "Pin the certificate" is not a remediation; "add a `CertificatePinner` for
`BuildConfig.API_HOST` in `NetworkModule.kt:34`, then confirm no other `OkHttpClient.Builder()` in
`:core:network` bypasses it" is.

## Commands

```bash
./gradlew detekt
# Assemble the release variant (substitute the project's flavor):
./gradlew assemble<Flavor>Release
# Inspect app/build/outputs/mapping/<flavor>Release/mapping.txt
# Process the release manifest:
./gradlew process<Flavor>ReleaseManifest
```

Audit the **release** variant — debug variants have relaxed settings by design. Never expose actual
secrets in a report; use placeholders.

## MASVS / MASTG reference

| MASVS group | Verifies | Audit sections |
|---|---|---|
| **MASVS-STORAGE** | Sensitive data stored & exposed safely | 1, 3 |
| **MASVS-CRYPTO** | Sound cryptography (keys, algorithms, IV/nonce) | 1, 3 |
| **MASVS-AUTH** | Authentication & authorization done correctly | 4, 5, 6 |
| **MASVS-NETWORK** | Secure network communication (TLS, pinning) | 2, 5 |
| **MASVS-PLATFORM** | Safe platform interaction (IPC, components, WebViews) | 7, 9 |
| **MASVS-CODE** | Data validation & secure coding practices | 1, 6, 9 |
| **MASVS-RESILIENCE** | Hardening vs reverse engineering / tampering (R8) | 8 |
| **MASVS-PRIVACY** | Minimise & protect personal data (PII) | 3 (PII), 4 |

### OWASP Mobile Top 10 — secondary cross-map (risk view)

| # | Risk | MASVS group |
|---|------|-------------|
| M1 | Improper Credential Usage | STORAGE / CODE |
| M2 | Inadequate Supply Chain Security | CODE |
| M3 | Insecure Authentication/Authorization | AUTH |
| M4 | Insufficient Input/Output Validation | CODE |
| M5 | Insecure Communication | NETWORK |
| M6 | Inadequate Privacy Controls | PRIVACY |
| M7 | Insufficient Binary Protections | RESILIENCE |
| M8 | Security Misconfiguration | PLATFORM |
| M9 | Insecure Data Storage | STORAGE |
| M10 | Insufficient Cryptography | CRYPTO |
