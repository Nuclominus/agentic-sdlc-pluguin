package bench.data

import bench.domain.Result
import bench.domain.model.Money
import bench.domain.model.Order
import bench.domain.model.OrderLine
import bench.domain.model.OrderStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class InMemoryDatabaseTest {
    @Test
    fun `withDefaultSeed wires every repository to the standard seed data`() {
        val database = InMemoryDatabase.withDefaultSeed()

        assertTrue(database.productRepository.findAll().isNotEmpty())
        assertTrue(database.customerRepository.findAll().isNotEmpty())
        assertTrue(database.inventoryRepository.findAll().isNotEmpty())
        assertTrue(database.orderRepository.findByCustomer("cus-1").isEmpty())
    }

    @Test
    fun `custom constructor arguments override the default seed`() {
        val order = Order(
            id = "ord-1",
            customerId = "cus-1",
            lines = listOf(OrderLine("sku-1001", 1, Money.ofUnits(24L))),
            status = OrderStatus.PENDING,
        )

        val database = InMemoryDatabase(orders = listOf(order))

        assertEquals(listOf(order), database.orderRepository.findByCustomer("cus-1"))
    }

    @Test
    fun `each repository instance is independent across two databases`() {
        val first = InMemoryDatabase()
        val second = InMemoryDatabase()

        first.productRepository.upsert(first.productRepository.findById("sku-1001")!!.copy(name = "Changed"))

        assertEquals("Wireless Mouse", second.productRepository.findById("sku-1001")?.name)
    }

    @Test
    fun `useCases wires every use case to this database's own repositories`() {
        val database = InMemoryDatabase()

        val created = database.useCases.createOrder("cus-1", emptyList())

        assertTrue(created is Result.Success)
        assertEquals(1, database.orderRepository.size())
    }

    @Test
    fun `useCases is the same instance on repeated access`() {
        val database = InMemoryDatabase()

        assertTrue(database.useCases === database.useCases)
    }

    @Test
    fun `useCases from two different databases operate on independent state`() {
        val first = InMemoryDatabase()
        val second = InMemoryDatabase()

        first.useCases.createOrder("cus-1", emptyList())

        assertEquals(1, first.orderRepository.size())
        assertEquals(0, second.orderRepository.size())
    }
}
