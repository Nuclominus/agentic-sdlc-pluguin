package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.Order
import bench.domain.model.OrderStatus
import bench.domain.repository.CustomerRepository
import bench.domain.repository.OrderRepository

/**
 * Lists a customer's orders, most recently created first.
 *
 * Ordering is derived from the numeric suffix of the order id (as produced
 * by [CreateOrder]) rather than an explicit "created at" timestamp, since
 * this specimen's [Order] model has no such field; a production system
 * would sort by an actual timestamp instead.
 */
class ListOrders(
    private val orders: OrderRepository,
    private val customers: CustomerRepository,
) {
    /**
     * @param customerId the customer whose orders to list.
     * @param includeArchived whether [archived][bench.domain.model.OrderStatus.ARCHIVED]
     *   orders should be included. Defaults to `false` since archived
     *   orders are usually noise in a customer-facing order history.
     * @return [Result.Success] with the matching orders (possibly empty),
     *   or [Result.Failure] wrapping a [NotFoundError] if the customer
     *   itself does not exist.
     */
    operator fun invoke(customerId: String, includeArchived: Boolean = false): Result<List<Order>> {
        customers.findById(customerId)
            ?: return Result.Failure(NotFoundError("No customer with id $customerId", customerId))

        val all = orders.findByCustomer(customerId)
        val filtered = if (includeArchived) all else all.filterNot { it.status == OrderStatus.ARCHIVED }
        val sorted = filtered.sortedByDescending { orderSequenceNumber(it.id) }
        return Result.Success(sorted)
    }

    /**
     * Extracts the trailing integer from an order id like "ord-42", or `0`
     * if the id does not follow that shape. Used only to derive a stable,
     * human-plausible sort order for display.
     */
    private fun orderSequenceNumber(orderId: String): Int =
        orderId.substringAfterLast('-').toIntOrNull() ?: 0
}
