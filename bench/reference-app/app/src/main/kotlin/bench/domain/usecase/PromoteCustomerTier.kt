package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.Customer
import bench.domain.model.LoyaltyTier
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
        val eligibleTier = when (spendResult) {
            is Result.Success -> spendResult.value.eligibleTier()
            is Result.Failure -> return Result.Failure(spendResult.error)
        }

        if (!eligibleTier.isAtLeast(customer.loyaltyTier)) {
            return Result.Success(customer)
        }

        val promoted = customer.copy(loyaltyTier = eligibleTier)
        return Result.Success(customers.save(promoted))
    }

    /**
     * Reports what tier [customerId] would be promoted to if [invoke] ran
     * right now, without actually persisting anything — useful for a
     * "you're about to reach Gold!" notification that previews the
     * outcome ahead of the batch job that will eventually apply it.
     *
     * @return [Result.Success] with the tier the customer would end up
     *   at (their current tier if no promotion would apply), or
     *   [Result.Failure] wrapping a [NotFoundError] if the customer does
     *   not exist.
     */
    fun previewEligibleTier(customerId: String): Result<LoyaltyTier> {
        val customer = customers.findById(customerId)
            ?: return Result.Failure(NotFoundError("No customer with id $customerId", customerId))

        val spendResult = summariseCustomerSpend(customerId)
        val eligibleTier = when (spendResult) {
            is Result.Success -> spendResult.value.eligibleTier()
            is Result.Failure -> return Result.Failure(spendResult.error)
        }

        return Result.Success(if (eligibleTier.isAtLeast(customer.loyaltyTier)) eligibleTier else customer.loyaltyTier)
    }
}
