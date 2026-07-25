package bench.domain.model

/**
 * A price reduction that can be attached to an [Order]. Modeled as a sealed
 * hierarchy rather than a single class with a "type" flag so that each kind
 * of discount can carry only the fields it needs, and so that
 * [ApplyDiscount][bench.domain.usecase.ApplyDiscount] can exhaustively
 * `when` over the possibilities without an `else` branch masking a missing
 * case.
 */
sealed interface Discount {
    /** Applies this discount to an order [subtotal] and returns the reduced amount. */
    fun apply(subtotal: Money): Money

    /** A short human-readable description, suitable for a receipt line. */
    fun describe(): String
}

/**
 * A discount expressed as a percentage of the subtotal, in basis points
 * (hundredths of a percent) to avoid floating-point rounding surprises.
 *
 * @property basisPoints the discount size; 1500 means 15%.
 */
data class PercentageDiscount(val basisPoints: Int) : Discount {
    override fun apply(subtotal: Money): Money {
        val reduction = subtotal.cents * basisPoints / 10_000
        return Money(subtotal.cents - reduction)
    }

    override fun describe(): String = "${basisPoints / 100}.${basisPoints % 100}% off"
}

/**
 * A discount that knocks a fixed [amount] off the subtotal, floored at zero
 * so that a large fixed discount can never make an order's total negative.
 */
data class FixedAmountDiscount(val amount: Money) : Discount {
    override fun apply(subtotal: Money): Money {
        val reduced = subtotal.cents - amount.cents
        return Money(if (reduced < 0) 0 else reduced)
    }

    override fun describe(): String = "${amount.cents / 100}.${amount.cents % 100} off"
}

/**
 * A promotional discount that leaves the order subtotal untouched. Its
 * effect is realized separately, by [CalculateShipping][bench.domain.usecase.CalculateShipping]
 * waiving the shipping cost, which is why [apply] is a no-op here.
 */
object FreeShippingDiscount : Discount {
    override fun apply(subtotal: Money): Money = subtotal

    override fun describe(): String = "Free shipping"
}

/**
 * Picks whichever of [discounts] leaves the customer with the smallest
 * resulting total on [subtotal] — i.e. the best deal available to them.
 *
 * This exists because a real storefront often has more than one discount a
 * customer could qualify for at once (a loyalty tier discount and a promo
 * code, say); the two are not meant to stack, and the fair rule is to
 * apply whichever is worth more on this particular purchase rather than
 * always preferring one kind over the other.
 *
 * @return the best discount, or `null` if [discounts] is empty. Ties are
 *   broken by keeping the first matching entry, so the result is
 *   deterministic regardless of how the caller ordered the list.
 */
fun bestDiscountFor(discounts: List<Discount>, subtotal: Money): Discount? =
    discounts.minByOrNull { it.apply(subtotal).cents }
