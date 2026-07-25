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
}
