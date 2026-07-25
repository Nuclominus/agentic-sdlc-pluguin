package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
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
 */
data class CustomerSpendSummary(
    val orderCount: Int,
    val totalSpend: Money,
    val averageOrderValue: Money,
    val largestOrder: Money,
)

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
                ),
            )
        }

        val totalCents = qualifying.sumOf { it.discountedTotal.cents }
        val largestCents = qualifying.maxOf { it.discountedTotal.cents }
        val averageCents = totalCents / qualifying.size

        return Result.Success(
            CustomerSpendSummary(
                orderCount = qualifying.size,
                totalSpend = Money(totalCents),
                averageOrderValue = Money(averageCents),
                largestOrder = Money(largestCents),
            ),
        )
    }
}
