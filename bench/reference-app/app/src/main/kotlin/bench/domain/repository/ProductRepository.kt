package bench.domain.repository

import bench.domain.model.Product

/**
 * Read access to the product catalog.
 *
 * This repository is deliberately read-only: catalog changes (adding a
 * product, retiring one, adjusting a price) are treated as a separate,
 * higher-privilege concern than the order-placing flows that consume this
 * interface, so no `save` method is exposed here.
 */
interface ProductRepository {
    /** Returns the product with the given [id], or `null` if none exists. */
    fun findById(id: String): Product?

    /** Returns every product in the catalog, active or not. */
    fun findAll(): List<Product>

    /**
     * Returns every product currently sellable, i.e. every product with
     * [Product.active] set to `true`.
     *
     * A convenience over filtering [findAll] by hand, since "products a
     * customer can currently order" is one of the most common queries
     * against the catalog.
     */
    fun findActive(): List<Product>

    /**
     * Returns every product in [ids] that exists in the catalog, in no
     * particular guaranteed order and silently omitting any id that does
     * not match a product. Exists so a caller with several product ids in
     * hand (e.g. every line on an order) can look them all up in one call
     * instead of one [findById] per id.
     */
    fun findByIds(ids: List<String>): List<Product>
}
