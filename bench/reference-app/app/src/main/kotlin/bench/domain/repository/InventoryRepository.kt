package bench.domain.repository

import bench.domain.model.InventoryItem

/**
 * Persistence for warehouse stock records.
 *
 * Kept as its own repository, separate from [ProductRepository], because
 * stock levels change far more often than catalog metadata and are owned by
 * a different part of the business (the warehouse system) even though every
 * [InventoryItem] refers back to a product by id.
 */
interface InventoryRepository {
    /** Returns the stock record for [productId], or `null` if the product is not tracked. */
    fun findByProductId(productId: String): InventoryItem?

    /**
     * Persists [item], inserting it if its product is new to inventory or
     * overwriting the existing record. Returns the saved item unchanged.
     */
    fun save(item: InventoryItem): InventoryItem

    /** Returns every tracked stock record. */
    fun findAll(): List<InventoryItem>
}
