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
)

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
}
