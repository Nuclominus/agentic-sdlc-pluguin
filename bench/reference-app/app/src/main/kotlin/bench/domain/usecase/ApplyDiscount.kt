package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.ValidationError
import bench.domain.model.Discount
import bench.domain.model.Order
import bench.domain.model.OrderStatus
import bench.domain.repository.OrderRepository

/**
 * Attaches a [Discount] to an existing order.
 *
 * Discounts can only be applied while an order is still [pending or
 * confirmed][bench.domain.model.OrderStatus]: once it starts moving through
 * the warehouse, retroactively changing its price would desynchronize what
 * the customer was charged from what the order record shows, which is worse
 * than simply refusing the discount at that point.
 */
class ApplyDiscount(
    private val orders: OrderRepository,
) {
    /**
     * Applies [discount] to the order identified by [orderId], replacing
     * any discount previously attached to it.
     *
     * @return [Result.Success] with the updated order, [Result.Failure]
     *   wrapping a [NotFoundError] if no such order exists, or
     *   [Result.Failure] wrapping a [ValidationError] if the order has
     *   already started processing.
     */
    operator fun invoke(orderId: String, discount: Discount): Result<Order> {
        val existing = orders.findById(orderId)
            ?: return Result.Failure(NotFoundError("No order with id $orderId", orderId))

        if (existing.isFinal() || existing.status == OrderStatus.PROCESSING) {
            return Result.Failure(
                ValidationError(
                    "Order $orderId can no longer accept a discount in status ${existing.status}",
                    field = "status",
                ),
            )
        }

        val updated = existing.copy(appliedDiscount = discount)
        return Result.Success(orders.save(updated))
    }
}
