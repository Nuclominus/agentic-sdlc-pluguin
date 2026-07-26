package bench.domain.model

/**
 * A postal address attached to a [Customer], used for both shipping and
 * billing purposes.
 *
 * This type intentionally has no `require` blocks: whether an address is
 * "valid enough" to ship to is a decision for the use case that consumes it
 * (for example a checkout flow), not for the data holder itself. Two
 * different use cases might have different standards for what counts as a
 * complete address, so baking a single opinion into the constructor would
 * make the model less reusable, not more correct.
 *
 * @property street street name and number, e.g. "221B Baker Street".
 * @property city the city or town name.
 * @property region a state, province, or other first-level administrative
 *   division. Optional because not every country uses one.
 * @property postalCode the postal or ZIP code.
 * @property country an ISO 3166-1 alpha-2 country code, e.g. "US", "UA".
 */
data class Address(
    val street: String,
    val city: String,
    val region: String?,
    val postalCode: String,
    val country: String,
) {
    /**
     * Renders the address as a single human-readable line, suitable for a
     * shipping label preview or a log line. Omits [region] when absent
     * instead of printing a stray comma.
     */
    fun singleLine(): String {
        val regionPart = region?.let { ", $it" } ?: ""
        return "$street, $city$regionPart $postalCode, $country"
    }

    /**
     * Whether this address is in the given [homeCountry]. Comparison is
     * case-insensitive since country codes are sometimes entered in mixed
     * case by upstream integrations.
     */
    fun isDomesticTo(homeCountry: String): Boolean =
        country.equals(homeCountry, ignoreCase = true)

    /**
     * A short label combining city and country, useful in list views where
     * the full [singleLine] would be too wide to display.
     */
    fun shortLabel(): String = "$city, $country"

    /**
     * Whether [region] is present and non-blank.
     *
     * Useful for form-rendering code that needs to decide whether to show a
     * state/province field at all, rather than showing an empty one for
     * every address in a country that does not use the concept.
     */
    fun hasRegion(): Boolean = !region.isNullOrBlank()

    /**
     * A copy of this address with [country] replaced, leaving every other
     * field untouched.
     *
     * Exists mainly for tests and seed data that want to derive a foreign
     * variant of an otherwise-identical address without re-typing every
     * field, but it is a plain, real method rather than a test-only helper:
     * a "move to a different country" flow in a real storefront would use
     * exactly this.
     */
    fun withCountry(newCountry: String): Address = copy(country = newCountry)

    /**
     * Whether this address and [other] are in the same country, ignoring
     * every other field. Useful for shipping logic that only cares about
     * the international/domestic boundary, not the exact city or street.
     */
    fun sameCountryAs(other: Address): Boolean = country.equals(other.country, ignoreCase = true)

    companion object {
        /**
         * A placeholder address used by tests and seed data where the exact
         * content does not matter but a syntactically plausible address is
         * still needed.
         */
        fun unspecified(): Address = Address(
            street = "1 Unspecified Way",
            city = "Springfield",
            region = null,
            postalCode = "00000",
            country = "US",
        )
    }
}
