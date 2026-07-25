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
