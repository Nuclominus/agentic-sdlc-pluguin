package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.ValidationError
import bench.domain.model.InventoryItem
import bench.domain.repository.InventoryRepository

/**
 * Records a warehouse delivery, increasing [InventoryItem.quantityOnHand]
 * for a product.
 *
 * This is the counterpart to [ReserveInventory] and [ReleaseInventory] on
 * the supply side rather than the demand side: it never touches
 * [InventoryItem.quantityReserved], since a delivery does not itself
 * fulfil any pending reservation — that still has to ship separately.
 */
class RestockInventory(
    private val inventory: InventoryRepository,
) {
    /**
     * Adds [quantityReceived] units to the on-hand count for [productId].
     *
     * @return [Result.Success] with the updated stock record,
     *   [Result.Failure] wrapping a [NotFoundError] if the product is not
     *   tracked in inventory, or [Result.Failure] wrapping a
     *   [ValidationError] if [quantityReceived] is not positive — a
     *   restock of zero or fewer units is not a delivery, it is a no-op
     *   that most likely indicates a caller mistake.
     */
    operator fun invoke(productId: String, quantityReceived: Int): Result<InventoryItem> {
        val item = inventory.findByProductId(productId)
            ?: return Result.Failure(NotFoundError("No inventory record for product $productId", productId))

        if (quantityReceived <= 0) {
            return Result.Failure(
                ValidationError(
                    "Restock quantity must be positive, got $quantityReceived",
                    field = "quantityReceived",
                ),
            )
        }

        val restocked = item.copy(quantityOnHand = item.quantityOnHand + quantityReceived)
        return Result.Success(inventory.save(restocked))
    }

    /**
     * Finds every product currently at or below its reorder threshold and
     * restocks each one up to [targetQuantity] units on hand.
     *
     * A bulk convenience for the common "top everything back up" workflow,
     * built on top of the single-product [invoke] so the two paths cannot
     * drift apart in behaviour.
     */
    fun restockEverythingLow(targetQuantity: Int): List<InventoryItem> =
        inventory.findNeedingReorder().mapNotNull { item ->
            val shortfall = targetQuantity - item.quantityOnHand
            if (shortfall <= 0) {
                null
            } else {
                (invoke(item.productId, shortfall) as? Result.Success)?.value
            }
        }

    /**
     * Restocks every low-stock product by exactly enough to clear its own
     * [reorderThreshold][InventoryItem.reorderThreshold] by one unit,
     * rather than topping every product up to the same flat
     * [targetQuantity] like [restockEverythingLow] does.
     *
     * This is the more realistic ordering strategy of the two: a
     * fast-moving product with a high threshold and a slow-moving one
     * with a low threshold should not receive the same restock amount just
     * because both happened to dip low at the same time.
     */
    fun restockToClearThresholds(): List<InventoryItem> =
        inventory.findNeedingReorder().mapNotNull { item ->
            val shortfall = item.shortfallToClearThreshold()
            if (shortfall <= 0) null else (invoke(item.productId, shortfall) as? Result.Success)?.value
        }

    /**
     * Applies a whole shipment's worth of deliveries at once, keyed by
     * product id, stopping at the first line that fails rather than
     * silently skipping it — unlike [restockEverythingLow] and
     * [restockToClearThresholds], which are automated housekeeping and
     * tolerate a partial result, a shipment manifest failing partway
     * through most likely means a data entry mistake worth surfacing
     * immediately rather than swallowing.
     *
     * @return [Result.Success] with every updated stock record, or the
     *   first [Result.Failure] encountered.
     */
    fun applyShipment(receivedQuantities: Map<String, Int>): Result<List<InventoryItem>> {
        val restocked = mutableListOf<InventoryItem>()
        for ((productId, quantity) in receivedQuantities) {
            when (val result = invoke(productId, quantity)) {
                is Result.Success -> restocked.add(result.value)
                is Result.Failure -> return result
            }
        }
        return Result.Success(restocked)
    }
}
