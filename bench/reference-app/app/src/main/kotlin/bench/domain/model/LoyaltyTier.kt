package bench.domain.model

/**
 * A customer's standing in the store's loyalty program. Higher tiers earn a
 * larger discount on their order subtotal, expressed in basis points
 * (hundredths of a percent) so that fractional-percent tiers can be added
 * later without changing the representation.
 *
 * @property discountBasisPoints the discount applied to a qualifying
 *   subtotal, in basis points. 250 means 2.5%.
 */
enum class LoyaltyTier(val discountBasisPoints: Int) {
    /** Default tier for a newly registered customer. */
    BRONZE(0),

    /** Reached after a customer's first completed order. */
    SILVER(250),

    /** Reached after a customer's cumulative spend passes an internal threshold. */
    GOLD(500),

    /** Reserved for the store's highest-value customers. */
    PLATINUM(1000);

    /**
     * Applies this tier's discount to [subtotal] and returns the discounted
     * amount. [BRONZE] is a no-op by construction since its basis points are
     * zero.
     */
    fun discountFor(subtotal: Money): Money {
        val discountedCents = subtotal.cents * discountBasisPoints / 10_000
        return Money(subtotal.cents - discountedCents)
    }

    /** Whether this tier ranks at or above [other] in program standing. */
    fun isAtLeast(other: LoyaltyTier): Boolean = this.ordinal >= other.ordinal
}
