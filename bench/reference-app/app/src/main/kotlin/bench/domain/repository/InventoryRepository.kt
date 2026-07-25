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

    /**
     * Returns every stock record whose [InventoryItem.needsReorder] is
     * `true`, in no particular guaranteed order.
     *
     * This is the read path behind a restocking report: a warehouse
     * manager (or an automated purchasing job) calls it periodically to
     * decide what to reorder, rather than every caller re-filtering
     * [findAll] by hand.
     */
    fun findNeedingReorder(): List<InventoryItem>

    /**
     * Returns the stock record for every id in [productIds] that is
     * tracked, silently omitting any that are not. Lets a caller checking
     * several products at once — an order with several lines, say — make
     * one repository call instead of one [findByProductId] per line.
     */
    fun findByProductIds(productIds: List<String>): List<InventoryItem>
}
