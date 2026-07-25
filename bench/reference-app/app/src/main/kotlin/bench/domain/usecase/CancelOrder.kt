package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.ValidationError
import bench.domain.model.Order
import bench.domain.model.OrderStatus
import bench.domain.repository.OrderRepository

/**
 * Cancels an existing order.
 *
 * Cancellation is only legal while an order has not yet reached a terminal
 * state; once it has shipped, been delivered, or already been cancelled or
 * archived, the customer needs a returns flow instead, which is a different
 * use case with different consequences (refunds, restocking fees, and so
 * on) and is intentionally not folded into this one.
 */
class CancelOrder(
    private val orders: OrderRepository,
) {
    /**
     * Moves the order identified by [orderId] to [OrderStatus.CANCELLED].
     *
     * @return [Result.Success] with the updated order, [Result.Failure]
     *   wrapping a [NotFoundError] if no such order exists, or
     *   [Result.Failure] wrapping a [ValidationError] if the order has
     *   already reached a terminal status.
     */
    operator fun invoke(orderId: String): Result<Order> {
        val existing = orders.findById(orderId)
            ?: return Result.Failure(NotFoundError("No order with id $orderId", orderId))

        if (!existing.status.canTransitionTo(OrderStatus.CANCELLED)) {
            return Result.Failure(
                ValidationError(
                    "Order $orderId cannot be cancelled from status ${existing.status}",
                    field = "status",
                ),
            )
        }

        val cancelled = existing.withStatus(OrderStatus.CANCELLED)
        return Result.Success(orders.save(cancelled))
    }

    /**
     * A side-effect-free check for whether [orderId] could currently be
     * cancelled, without actually attempting it.
     *
     * Intended for a UI that wants to grey out a "Cancel order" button
     * ahead of time rather than let the customer click it and then show
     * them a failure. Returns `false` both when the order does not exist
     * and when it exists but is no longer cancellable, since a caller
     * deciding whether to show the button does not need to tell those two
     * cases apart.
     */
    fun canCancel(orderId: String): Boolean =
        orders.findById(orderId)?.status?.canTransitionTo(OrderStatus.CANCELLED) ?: false
}
