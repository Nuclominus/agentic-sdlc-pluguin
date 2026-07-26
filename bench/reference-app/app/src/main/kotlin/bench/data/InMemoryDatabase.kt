package bench.data

import bench.data.seed.SeedCatalog
import bench.data.seed.SeedCustomers
import bench.domain.model.Customer
import bench.domain.model.InventoryItem
import bench.domain.model.Order
import bench.domain.model.Product
import bench.domain.usecase.ApplyDiscount
import bench.domain.usecase.ArchiveOrder
import bench.domain.usecase.CalculateShipping
import bench.domain.usecase.CancelOrder
import bench.domain.usecase.CreateOrder
import bench.domain.usecase.EstimateDeliveryDate
import bench.domain.usecase.FindProducts
import bench.domain.usecase.GetOrderReceipt
import bench.domain.usecase.ListLowStockProducts
import bench.domain.usecase.ListOrders
import bench.domain.usecase.PreviewLoyaltyDiscount
import bench.domain.usecase.PromoteCustomerTier
import bench.domain.usecase.ReleaseInventory
import bench.domain.usecase.ReserveInventory
import bench.domain.usecase.RestockInventory
import bench.domain.usecase.SummariseCustomerSpend

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
     * Every use case, wired to this database's repositories. This project
     * has no dependency-injection framework of its own, so [UseCases] is
     * the plain-object equivalent: one place that knows how to construct
     * every use case, so a caller wanting "the whole application" does not
     * need to repeat each use case's constructor arguments by hand.
     */
    val useCases: UseCases by lazy { UseCases(this) }

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

/**
 * Every use case pre-wired to a single [InMemoryDatabase]'s repositories.
 * See [InMemoryDatabase.useCases] for why this exists instead of each
 * caller constructing use cases directly.
 */
class UseCases(database: InMemoryDatabase) {
    val createOrder = CreateOrder(database.orderRepository, database.productRepository)
    val cancelOrder = CancelOrder(database.orderRepository)
    val applyDiscount = ApplyDiscount(database.orderRepository)
    val previewLoyaltyDiscount = PreviewLoyaltyDiscount(database.customerRepository)
    val archiveOrder = ArchiveOrder(database.orderRepository)
    val listOrders = ListOrders(database.orderRepository, database.customerRepository)
    val findProducts = FindProducts(database.productRepository)
    val reserveInventory = ReserveInventory(database.inventoryRepository)
    val releaseInventory = ReleaseInventory(database.inventoryRepository)
    val restockInventory = RestockInventory(database.inventoryRepository)
    val calculateShipping = CalculateShipping(database.orderRepository)
    val estimateDeliveryDate = EstimateDeliveryDate(database.orderRepository)
    val summariseCustomerSpend = SummariseCustomerSpend(database.orderRepository, database.customerRepository)
    val promoteCustomerTier = PromoteCustomerTier(database.customerRepository, database.orderRepository)
    val getOrderReceipt = GetOrderReceipt(database.orderRepository, database.productRepository)
    val listLowStockProducts = ListLowStockProducts(database.inventoryRepository, database.productRepository)
}
