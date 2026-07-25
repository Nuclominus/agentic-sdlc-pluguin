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

    /**
     * Reserves every product in [quantities] (keyed by product id) as a
     * single all-or-nothing operation: if any one line cannot be
     * satisfied, nothing is reserved for any of them.
     *
     * This is the shape an order with several lines actually needs —
     * reserving line one and then discovering line two is out of stock
     * would leave a half-reserved order behind, which is worse than
     * failing up front. The check pass and the apply pass are kept
     * separate for exactly this reason: every line must be confirmed
     * reservable before any stock record is actually mutated.
     *
     * @return [Result.Success] with every updated stock record, or the
     *   first [Result.Failure] encountered while checking availability.
     */
    fun reserveAllOrNothing(quantities: Map<String, Int>): Result<List<InventoryItem>> {
        for ((productId, quantity) in quantities) {
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
        }

        val updated = quantities.map { (productId, quantity) -> invoke(productId, quantity) }
        return Result.Success(updated.map { (it as Result.Success).value })
    }
}
