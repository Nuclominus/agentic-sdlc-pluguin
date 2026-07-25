package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.ValidationError
import bench.domain.model.InventoryItem
import bench.domain.repository.InventoryRepository

/**
 * Allocates warehouse stock to a pending order without physically moving
 * anything yet.
 *
 * Reservation exists as its own step, separate from [CreateOrder], so that
 * an order can be created first and stock checked and held afterward —
 * useful for flows like "add to cart now, confirm stock at checkout" where
 * the two moments are seconds or minutes apart.
 */
class ReserveInventory(
    private val inventory: InventoryRepository,
) {
    /**
     * Reserves [quantity] units of [productId].
     *
     * @return [Result.Success] with the updated stock record,
     *   [Result.Failure] wrapping a [NotFoundError] if the product is not
     *   tracked in inventory, or [Result.Failure] wrapping a
     *   [ValidationError] if fewer than [quantity] units are available.
     */
    operator fun invoke(productId: String, quantity: Int): Result<InventoryItem> {
        val item = inventory.findByProductId(productId)
            ?: return Result.Failure(NotFoundError("No inventory record for product $productId", productId))

        if (!item.canReserve(quantity)) {
            return Result.Failure(
                ValidationError(
                    "Only ${item.availableQuantity} of $productId available, cannot reserve $quantity",
                    field = "quantity",
                ),
            )
        }

        return Result.Success(inventory.save(item.withReserved(quantity)))
    }
}
