package bench.data

import bench.data.seed.SeedCatalog
import bench.domain.model.Product
import bench.domain.repository.ProductRepository

/**
 * A map-backed [ProductRepository], seeded from [SeedCatalog] by default.
 *
 * There is no thread-safety story here on purpose: this specimen models a
 * single-request-at-a-time console/test harness, not a concurrent server,
 * so a plain [LinkedHashMap] keeps the implementation easy to read without
 * pretending to guarantees the surrounding project does not need.
 */
class InMemoryProductRepository(
    seed: List<Product> = SeedCatalog.products,
) : ProductRepository {
    private val byId = LinkedHashMap<String, Product>().apply {
        seed.forEach { put(it.id, it) }
    }

    override fun findById(id: String): Product? = byId[id]

    override fun findAll(): List<Product> = byId.values.toList()

    /**
     * Inserts or replaces [product] in the store. Not part of
     * [ProductRepository] — catalog edits are out of scope for the
     * order-processing use cases, but tests find it convenient to seed or
     * mutate a single product without rebuilding the whole repository.
     */
    fun upsert(product: Product) {
        byId[product.id] = product
    }
}
