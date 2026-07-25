package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.ValidationError
import bench.domain.model.Order
import bench.domain.model.OrderStatus
import bench.domain.repository.OrderRepository

/**
 * Moves a finished order out of active reporting and into long-term
 * storage, by setting its status to [OrderStatus.ARCHIVED].
 *
 * Only [OrderStatus.DELIVERED] and [OrderStatus.CANCELLED] orders are
 * eligible — see [OrderStatus.canTransitionTo] — because archiving anything
 * still in flight would hide it from operational views (like "orders
 * awaiting shipment") that depend on it staying visible until it is truly
 * done.
 */
class ArchiveOrder(
    private val orders: OrderRepository,
) {
    /**
     * @return [Result.Success] with the archived order, [Result.Failure]
     *   wrapping a [NotFoundError] if no such order exists, or
     *   [Result.Failure] wrapping a [ValidationError] if the order is not
     *   yet in a state eligible for archiving.
     */
    operator fun invoke(orderId: String): Result<Order> {
        val existing = orders.findById(orderId)
            ?: return Result.Failure(NotFoundError("No order with id $orderId", orderId))

        if (!existing.status.canTransitionTo(OrderStatus.ARCHIVED)) {
            return Result.Failure(
                ValidationError(
                    "Order $orderId cannot be archived from status ${existing.status}",
                    field = "status",
                ),
            )
        }

        return Result.Success(orders.save(existing.withStatus(OrderStatus.ARCHIVED)))
    }
}
