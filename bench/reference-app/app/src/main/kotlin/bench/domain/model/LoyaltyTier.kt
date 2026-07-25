package bench.domain.model

/**
 * A customer's standing in the store's loyalty program. Higher tiers earn a
 * larger discount on their order subtotal, expressed in basis points
 * (hundredths of a percent) so that fractional-percent tiers can be added
 * later without changing the representation.
 *
 * The tiers double as the lifetime-spend brackets used by
 * [PromoteCustomerTier][bench.domain.usecase.PromoteCustomerTier]: rather
 * than that use case keeping its own separate table of thresholds, it asks
 * this enum directly via [qualifying], so the two cannot silently drift
 * out of sync with each other.
 *
 * @property discountBasisPoints the discount applied to a qualifying
 *   subtotal, in basis points. 250 means 2.5%.
 * @property minimumLifetimeSpend the cumulative spend a customer needs to
 *   reach this tier.
 */
enum class LoyaltyTier(val discountBasisPoints: Int, val minimumLifetimeSpend: Money) {
    /** Default tier for a newly registered customer. */
    BRONZE(0, Money.ZERO),

    /** Reached once a customer's lifetime spend clears [minimumLifetimeSpend]. */
    SILVER(250, Money.ofUnits(200L)),

    /** Reached once a customer's lifetime spend clears [minimumLifetimeSpend]. */
    GOLD(500, Money.ofUnits(1_000L)),

    /** Reserved for the store's highest-value customers. */
    PLATINUM(1000, Money.ofUnits(5_000L));

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

    /** The next tier up from this one, or `null` if this is already [PLATINUM]. */
    fun nextTier(): LoyaltyTier? = entries.getOrNull(ordinal + 1)

    /** How much more a customer at [currentSpend] needs to spend to reach [nextTier], or `null` at the top tier. */
    fun spendToNextTier(currentSpend: Money): Money? {
        val next = nextTier() ?: return null
        val remaining = next.minimumLifetimeSpend.cents - currentSpend.cents
        return Money(if (remaining < 0) 0 else remaining)
    }

    companion object {
        /**
         * The highest tier whose [minimumLifetimeSpend] is met by
         * [totalSpend]. Always returns at least [BRONZE], since its
         * threshold is zero.
         */
        fun qualifying(totalSpend: Money): LoyaltyTier =
            entries.sortedByDescending { it.minimumLifetimeSpend.cents }
                .first { totalSpend.cents >= it.minimumLifetimeSpend.cents }
    }
}
