package bench.data

import bench.data.seed.SeedCatalog
import bench.domain.model.InventoryItem
import bench.domain.repository.InventoryRepository

/**
 * A map-backed [InventoryRepository], seeded from [SeedCatalog] by default.
 */
class InMemoryInventoryRepository(
    seed: List<InventoryItem> = SeedCatalog.inventory,
) : InventoryRepository {
    private val byProductId = LinkedHashMap<String, InventoryItem>().apply {
        seed.forEach { put(it.productId, it) }
    }

    override fun findByProductId(productId: String): InventoryItem? = byProductId[productId]

    override fun save(item: InventoryItem): InventoryItem {
        byProductId[item.productId] = item
        return item
    }

    override fun findAll(): List<InventoryItem> = byProductId.values.toList()

    override fun findNeedingReorder(): List<InventoryItem> =
        byProductId.values.filter { it.needsReorder() }

    /**
     * The combined [InventoryItem.availableQuantity] across every tracked
     * product — a rough proxy for "how much total stock is sitting in the
     * warehouse right now," used by capacity-planning reports rather than
     * any single-order flow.
     */
    fun totalAvailableUnits(): Int = byProductId.values.sumOf { it.availableQuantity }

    /** Whether [productId] currently has a stock record at all. */
    fun isTracked(productId: String): Boolean = byProductId.containsKey(productId)
}
