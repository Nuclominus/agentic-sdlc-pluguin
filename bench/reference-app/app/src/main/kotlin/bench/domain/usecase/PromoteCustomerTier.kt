package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.Customer
import bench.domain.model.LoyaltyTier
import bench.domain.model.Money
import bench.domain.repository.CustomerRepository
import bench.domain.repository.OrderRepository

/**
 * Re-evaluates a customer's [LoyaltyTier] against their lifetime spend and
 * upgrades it if they have crossed into a higher bracket.
 *
 * This use case is intentionally one-directional: it only ever raises a
 * tier, never lowers one. A customer who stops ordering should not be
 * quietly demoted by a background job — losing a tier is a business
 * decision with its own process, not a side effect of running this
 * calculation.
 */
class PromoteCustomerTier(
    private val customers: CustomerRepository,
    private val orders: OrderRepository,
    private val summariseCustomerSpend: SummariseCustomerSpend = SummariseCustomerSpend(orders, customers),
) {
    /**
     * @return [Result.Success] with the customer's record — updated and
     *   persisted if a promotion applied, unchanged otherwise — or
     *   [Result.Failure] wrapping a [NotFoundError] if the customer does
     *   not exist.
     */
    operator fun invoke(customerId: String): Result<Customer> {
        val customer = customers.findById(customerId)
            ?: return Result.Failure(NotFoundError("No customer with id $customerId", customerId))

        val spendResult = summariseCustomerSpend(customerId)
        val totalSpend = when (spendResult) {
            is Result.Success -> spendResult.value.totalSpend
            is Result.Failure -> return Result.Failure(spendResult.error)
        }

        val eligibleTier = tierFor(totalSpend)
        if (!eligibleTier.isAtLeast(customer.loyaltyTier)) {
            return Result.Success(customer)
        }

        val promoted = customer.copy(loyaltyTier = eligibleTier)
        return Result.Success(customers.save(promoted))
    }

    /** The highest tier [totalSpend] qualifies for, based on fixed lifetime-spend brackets. */
    private fun tierFor(totalSpend: Money): LoyaltyTier = when {
        totalSpend.cents >= PLATINUM_THRESHOLD.cents -> LoyaltyTier.PLATINUM
        totalSpend.cents >= GOLD_THRESHOLD.cents -> LoyaltyTier.GOLD
        totalSpend.cents >= SILVER_THRESHOLD.cents -> LoyaltyTier.SILVER
        else -> LoyaltyTier.BRONZE
    }

    companion object {
        private val SILVER_THRESHOLD = Money.ofUnits(200L)
        private val GOLD_THRESHOLD = Money.ofUnits(1_000L)
        private val PLATINUM_THRESHOLD = Money.ofUnits(5_000L)
    }
}
