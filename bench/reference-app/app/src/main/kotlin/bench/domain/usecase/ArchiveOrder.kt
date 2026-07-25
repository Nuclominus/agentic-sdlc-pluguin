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

    /**
     * Archives every order currently in [status], skipping any that turn
     * out not to be eligible (which should not normally happen for
     * [OrderStatus.DELIVERED] or [OrderStatus.CANCELLED], but is checked
     * anyway so this bulk path can never violate the same rule the
     * single-order path enforces).
     *
     * A periodic housekeeping job is the intended caller: rather than it
     * re-deriving "delivered a while ago" filtering logic, it simply hands
     * this a status and gets back everything that was actually archived.
     */
    fun archiveAllIn(status: OrderStatus): List<Order> =
        orders.findByStatus(status).mapNotNull { order ->
            (invoke(order.id) as? Result.Success)?.value
        }

    /**
     * A side-effect-free check for whether [orderId] could currently be
     * archived, without attempting it — the same "check before you show
     * the button" pattern as [CancelOrder.canCancel].
     */
    fun canArchive(orderId: String): Boolean =
        orders.findById(orderId)?.status?.canTransitionTo(OrderStatus.ARCHIVED) ?: false

    /**
     * Counts how many of [customerId]'s orders are currently eligible for
     * archiving, without archiving any of them. Useful for a "you have N
     * old orders you could clean up" hint in an account settings screen.
     */
    fun countArchivable(customerId: String): Int =
        orders.findByCustomer(customerId).count { it.status.canTransitionTo(OrderStatus.ARCHIVED) }
}
