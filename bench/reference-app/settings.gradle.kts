rootProject.name = "bench-orders"
include(":app")

// Not in the task brief's listing verbatim: without a repository, Gradle
// cannot resolve kotlin-stdlib and the build fails outright. Added minimally
// so `./gradlew test` succeeds; content otherwise matches the brief exactly.
dependencyResolutionManagement {
    repositories {
        mavenCentral()
    }
}
