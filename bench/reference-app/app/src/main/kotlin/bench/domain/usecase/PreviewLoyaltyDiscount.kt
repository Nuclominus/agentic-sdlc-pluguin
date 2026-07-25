package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.Money
import bench.domain.repository.CustomerRepository

/**
 * A quote for how much a customer's current loyalty tier would discount a
 * hypothetical purchase, before they commit to it.
 *
 * @property subtotal the hypothetical pre-discount amount that was quoted.
 * @property discountedTotal [subtotal] after the customer's tier discount.
 * @property savings the difference between the two, i.e. how much the
 *   tier is worth on this particular purchase.
 */
data class LoyaltyDiscountPreview(
    val subtotal: Money,
    val discountedTotal: Money,
    val savings: Money,
) {
    /**
     * [savings] as a fraction of [subtotal], from 0.0 to 1.0. Returns 0.0
     * for a zero subtotal instead of dividing by zero, since "no discount
     * on nothing" is a perfectly sensible answer.
     */
    fun savingsRatio(): Double {
        if (subtotal.cents == 0L) return 0.0
        return savings.cents.toDouble() / subtotal.cents.toDouble()
    }
}

/**
 * Shows a customer, before checkout, what their loyalty tier is worth on a
 * given cart subtotal — useful for a "sign in to see your discount" style
 * prompt without needing to create an order just to find out.
 */
class PreviewLoyaltyDiscount(
    private val customers: CustomerRepository,
) {
    /**
     * @return [Result.Success] with the computed preview, or
     *   [Result.Failure] wrapping a [NotFoundError] if the customer does
     *   not exist.
     */
    operator fun invoke(customerId: String, subtotal: Money): Result<LoyaltyDiscountPreview> {
        val customer = customers.findById(customerId)
            ?: return Result.Failure(NotFoundError("No customer with id $customerId", customerId))

        val discounted = customer.loyaltyTier.discountFor(subtotal)
        val savings = Money(subtotal.cents - discounted.cents)

        return Result.Success(
            LoyaltyDiscountPreview(
                subtotal = subtotal,
                discountedTotal = discounted,
                savings = savings,
            ),
        )
    }

    /**
     * How much *more* the customer would save on [subtotal] if they were
     * promoted to their next loyalty tier — the number a "spend a bit more
     * to unlock extra savings" prompt would show.
     *
     * @return [Result.Success] with the additional savings (zero at the
     *   top tier), or [Result.Failure] wrapping a [NotFoundError] if the
     *   customer does not exist.
     */
    fun nextTierAdditionalSavings(customerId: String, subtotal: Money): Result<Money> {
        val customer = customers.findById(customerId)
            ?: return Result.Failure(NotFoundError("No customer with id $customerId", customerId))

        val nextTier = customer.loyaltyTier.nextTier() ?: return Result.Success(Money.ZERO)
        val currentDiscounted = customer.loyaltyTier.discountFor(subtotal)
        val nextDiscounted = nextTier.discountFor(subtotal)
        return Result.Success(Money(currentDiscounted.cents - nextDiscounted.cents))
    }
}
