package bench.domain.usecase

import bench.domain.Result
import bench.domain.model.InventoryItem
import bench.domain.model.Product
import bench.domain.repository.InventoryRepository
import bench.domain.repository.ProductRepository

/**
 * One row of a low-stock report: a product paired with the stock record
 * that flagged it, so a caller does not have to re-join the two
 * repositories itself.
 *
 * @property product the catalog entry, so the report can show a name
 *   instead of a bare product id.
 * @property inventory the stock record that triggered the reorder flag.
 */
data class LowStockEntry(
    val product: Product,
    val inventory: InventoryItem,
)

/**
 * Produces a warehouse restocking report: every product whose stock has
 * fallen to or below its reorder threshold, ordered from most urgent (the
 * least stock relative to its own threshold) to least urgent.
 *
 * This is deliberately read-only reporting — it does not restock anything
 * itself, that is [RestockInventory]'s job — so a manager can review the
 * report before committing to purchase orders.
 */
class ListLowStockProducts(
    private val inventory: InventoryRepository,
    private val products: ProductRepository,
) {
    /**
     * @return [Result.Success] with the low-stock entries, sorted most
     *   urgent first. A product no longer present in the catalog (as
     *   opposed to merely deactivated) is silently skipped, since there is
     *   nothing meaningful to report a name for.
     */
    operator fun invoke(): Result<List<LowStockEntry>> {
        val entries = inventory.findNeedingReorder()
            .mapNotNull { item ->
                val product = products.findById(item.productId) ?: return@mapNotNull null
                LowStockEntry(product, item)
            }
            .sortedBy { urgency(it.inventory) }

        return Result.Success(entries)
    }

    /**
     * A lower number means more urgent. Expressed as available stock minus
     * threshold (always zero or negative for anything in the report), so
     * an item that is fully out of stock relative to its threshold sorts
     * ahead of one that is merely a couple of units under.
     */
    private fun urgency(item: InventoryItem): Int = item.availableQuantity - item.reorderThreshold
}
