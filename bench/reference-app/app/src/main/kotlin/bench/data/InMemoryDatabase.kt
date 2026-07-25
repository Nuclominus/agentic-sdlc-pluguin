package bench.data

import bench.data.seed.SeedCatalog
import bench.data.seed.SeedCustomers
import bench.domain.model.Customer
import bench.domain.model.InventoryItem
import bench.domain.model.Order
import bench.domain.model.Product

/**
 * A convenience bundle of the four in-memory repositories, wired together
 * with sensible defaults.
 *
 * Every use case only depends on the single repository interface it needs,
 * so this class is never referenced from `bench.domain` — it exists purely
 * to save call sites (tests, a future CLI entry point) from repeating the
 * same four-repository wiring every time they need "the whole store" for a
 * scenario that spans multiple use cases.
 */
class InMemoryDatabase(
    products: List<Product> = SeedCatalog.products,
    inventory: List<InventoryItem> = SeedCatalog.inventory,
    customers: List<Customer> = SeedCustomers.customers,
    orders: List<Order> = emptyList(),
) {
    val productRepository: InMemoryProductRepository = InMemoryProductRepository(products)
    val inventoryRepository: InMemoryInventoryRepository = InMemoryInventoryRepository(inventory)
    val customerRepository: InMemoryCustomerRepository = InMemoryCustomerRepository(customers)
    val orderRepository: InMemoryOrderRepository = InMemoryOrderRepository(orders)

    /**
     * Builds a fresh, empty-of-orders database: the same catalog, inventory
     * and customer directory, but with no order history. Handy for a test
     * that wants a clean slate without re-typing every constructor
     * argument.
     */
    companion object {
        fun withDefaultSeed(): InMemoryDatabase = InMemoryDatabase()
    }
}
