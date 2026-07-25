package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.InventoryItem
import bench.domain.repository.InventoryRepository

/**
 * Releases previously [reserved][ReserveInventory] stock back to the
 * available pool.
 *
 * This is the counterpart used when a reservation no longer needs to be
 * honored — an order is cancelled, a customer removes an item from their
 * cart, or a reservation simply expires. Unlike [ReserveInventory], this
 * operation never fails on quantity: releasing more than was reserved
 * simply floors the reserved counter at zero (see
 * [InventoryItem.withReleased]), since an over-release is a caller bug that
 * should not itself break the warehouse record.
 */
class ReleaseInventory(
    private val inventory: InventoryRepository,
) {
    /**
     * Releases [quantity] units of [productId] back to the available pool.
     *
     * @return [Result.Success] with the updated stock record, or
     *   [Result.Failure] wrapping a [NotFoundError] if the product is not
     *   tracked in inventory.
     */
    operator fun invoke(productId: String, quantity: Int): Result<InventoryItem> {
        val item = inventory.findByProductId(productId)
            ?: return Result.Failure(NotFoundError("No inventory record for product $productId", productId))

        return Result.Success(inventory.save(item.withReleased(quantity)))
    }

    /**
     * Releases every line in [quantities] (keyed by product id), the
     * counterpart to [ReserveInventory.reserveAllOrNothing] for undoing a
     * whole order's worth of reservations at once — e.g. when
     * [CancelOrder] cancels an order with several lines.
     *
     * Unlike the reservation side, this does not need an all-or-nothing
     * check pass: releasing is never rejected for quantity reasons, so
     * every line that refers to a tracked product succeeds independently
     * of the others.
     *
     * @return [Result.Success] with every updated stock record, or
     *   [Result.Failure] wrapping a [NotFoundError] for the first product
     *   id in [quantities] that inventory does not track.
     */
    fun releaseAll(quantities: Map<String, Int>): Result<List<InventoryItem>> {
        val released = mutableListOf<InventoryItem>()
        for ((productId, quantity) in quantities) {
            val result = invoke(productId, quantity)
            when (result) {
                is Result.Success -> released.add(result.value)
                is Result.Failure -> return result
            }
        }
        return Result.Success(released)
    }
}
