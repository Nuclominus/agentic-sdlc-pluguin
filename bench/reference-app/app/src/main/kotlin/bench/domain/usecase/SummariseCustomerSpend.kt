package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.LoyaltyTier
import bench.domain.model.Money
import bench.domain.model.OrderStatus
import bench.domain.repository.CustomerRepository
import bench.domain.repository.OrderRepository

/**
 * A rollup of a customer's ordering history, used by support tooling and
 * the loyalty program to decide things like tier upgrades or refund
 * eligibility without every caller re-deriving the same aggregates.
 *
 * @property orderCount how many non-cancelled orders the customer has placed.
 * @property totalSpend the sum of [discounted totals][bench.domain.model.Order.discountedTotal]
 *   across those orders.
 * @property averageOrderValue [totalSpend] divided by [orderCount], or
 *   [Money.ZERO] if the customer has no qualifying orders.
 * @property largestOrder the highest single discounted total among the
 *   customer's orders, or [Money.ZERO] if there are none.
 * @property smallestOrder the lowest single discounted total among the
 *   customer's orders, or [Money.ZERO] if there are none.
 */
data class CustomerSpendSummary(
    val orderCount: Int,
    val totalSpend: Money,
    val averageOrderValue: Money,
    val largestOrder: Money,
    val smallestOrder: Money,
) {
    /**
     * The [LoyaltyTier] [totalSpend] currently qualifies for, independent
     * of whatever tier is actually recorded on the customer — see
     * [PromoteCustomerTier] for the use case that reconciles the two.
     */
    fun eligibleTier(): LoyaltyTier = LoyaltyTier.qualifying(totalSpend)

    /**
     * How far [totalSpend] is above or below [averageOrderValue] scaled by
     * [orderCount] — always zero by construction, but expressed as its own
     * method so a caller sanity-checking a summary (e.g. in a test or a
     * support tool) has a named way to ask "does this add up?" instead of
     * re-deriving the arithmetic inline.
     */
    fun isInternallyConsistent(): Boolean =
        orderCount == 0 || totalSpend.cents / orderCount == averageOrderValue.cents
}

/**
 * Computes a [CustomerSpendSummary] for a customer.
 *
 * Cancelled orders are excluded from every figure: a cancelled order was
 * never actually paid for, so counting it would overstate both spend and
 * order volume.
 */
class SummariseCustomerSpend(
    private val orders: OrderRepository,
    private val customers: CustomerRepository,
) {
    /**
     * @return [Result.Success] with the computed summary, or
     *   [Result.Failure] wrapping a [NotFoundError] if the customer does
     *   not exist.
     */
    operator fun invoke(customerId: String): Result<CustomerSpendSummary> {
        customers.findById(customerId)
            ?: return Result.Failure(NotFoundError("No customer with id $customerId", customerId))

        val qualifying = orders.findByCustomer(customerId).filterNot { it.status == OrderStatus.CANCELLED }

        if (qualifying.isEmpty()) {
            return Result.Success(
                CustomerSpendSummary(
                    orderCount = 0,
                    totalSpend = Money.ZERO,
                    averageOrderValue = Money.ZERO,
                    largestOrder = Money.ZERO,
                    smallestOrder = Money.ZERO,
                ),
            )
        }

        val totalCents = qualifying.sumOf { it.discountedTotal.cents }
        val largestCents = qualifying.maxOf { it.discountedTotal.cents }
        val smallestCents = qualifying.minOf { it.discountedTotal.cents }
        val averageCents = totalCents / qualifying.size

        return Result.Success(
            CustomerSpendSummary(
                orderCount = qualifying.size,
                totalSpend = Money(totalCents),
                averageOrderValue = Money(averageCents),
                largestOrder = Money(largestCents),
                smallestOrder = Money(smallestCents),
            ),
        )
    }

    /**
     * Sums [CustomerSpendSummary.totalSpend] across every customer in
     * [customerIds] — for a household or company account that wants one
     * combined figure rather than adding up several individual summaries
     * by hand.
     *
     * @return [Result.Success] with the combined total, or the first
     *   [Result.Failure] encountered for a customer id that does not
     *   exist.
     */
    fun totalSpendAcross(customerIds: List<String>): Result<Money> {
        var totalCents = 0L
        for (customerId in customerIds) {
            when (val result = invoke(customerId)) {
                is Result.Success -> totalCents += result.value.totalSpend.cents
                is Result.Failure -> return result
            }
        }
        return Result.Success(Money(totalCents))
    }
}
