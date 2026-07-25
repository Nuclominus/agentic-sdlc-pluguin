package bench.data

import bench.domain.model.Money
import bench.domain.model.Order
import bench.domain.model.OrderLine
import bench.domain.model.OrderStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class InMemoryOrderRepositoryTest {
    private fun sampleOrder(id: String, customerId: String) = Order(
        id = id,
        customerId = customerId,
        lines = listOf(OrderLine("sku-1001", 2, Money.ofUnits(24L))),
        status = OrderStatus.PENDING,
    )

    @Test
    fun `save inserts a new order`() {
        val repository = InMemoryOrderRepository()
        val order = sampleOrder("ord-1", "cus-1")

        val saved = repository.save(order)

        assertEquals(order, saved)
        assertEquals(order, repository.findById("ord-1"))
    }

    @Test
    fun `save overwrites an order with the same id`() {
        val repository = InMemoryOrderRepository()
        repository.save(sampleOrder("ord-1", "cus-1"))

        val updated = sampleOrder("ord-1", "cus-1").withStatus(OrderStatus.CONFIRMED)
        repository.save(updated)

        assertEquals(OrderStatus.CONFIRMED, repository.findById("ord-1")?.status)
        assertEquals(1, repository.size())
    }

    @Test
    fun `findById returns null when no order matches`() {
        val repository = InMemoryOrderRepository()

        assertNull(repository.findById("ord-missing"))
    }

    @Test
    fun `findByCustomer returns only that customer's orders`() {
        val repository = InMemoryOrderRepository()
        repository.save(sampleOrder("ord-1", "cus-1"))
        repository.save(sampleOrder("ord-2", "cus-1"))
        repository.save(sampleOrder("ord-3", "cus-2"))

        val forCustomerOne = repository.findByCustomer("cus-1")

        assertEquals(2, forCustomerOne.size)
        assertTrue(forCustomerOne.all { it.customerId == "cus-1" })
    }

    @Test
    fun `findByCustomer returns an empty list for a customer with no orders`() {
        val repository = InMemoryOrderRepository()

        val result = repository.findByCustomer("cus-unknown")

        assertTrue(result.isEmpty())
    }

    @Test
    fun `repository can be constructed with a pre-populated seed`() {
        val seeded = listOf(sampleOrder("ord-1", "cus-1"))
        val repository = InMemoryOrderRepository(seed = seeded)

        assertEquals(1, repository.size())
        assertEquals(seeded[0], repository.findById("ord-1"))
    }

    @Test
    fun `findByStatus returns only orders in that status, across customers`() {
        val repository = InMemoryOrderRepository()
        repository.save(sampleOrder("ord-1", "cus-1"))
        repository.save(sampleOrder("ord-2", "cus-2"))
        repository.save(sampleOrder("ord-3", "cus-1").withStatus(OrderStatus.SHIPPED))

        val pending = repository.findByStatus(OrderStatus.PENDING)

        assertEquals(setOf("ord-1", "ord-2"), pending.map { it.id }.toSet())
    }

    @Test
    fun `findByStatus returns an empty list when nothing matches`() {
        val repository = InMemoryOrderRepository()
        repository.save(sampleOrder("ord-1", "cus-1"))

        val delivered = repository.findByStatus(OrderStatus.DELIVERED)

        assertTrue(delivered.isEmpty())
    }

    @Test
    fun `all returns every stored order regardless of customer or status`() {
        val repository = InMemoryOrderRepository()
        repository.save(sampleOrder("ord-1", "cus-1"))
        repository.save(sampleOrder("ord-2", "cus-2").withStatus(OrderStatus.SHIPPED))

        assertEquals(setOf("ord-1", "ord-2"), repository.all().map { it.id }.toSet())
    }

    @Test
    fun `clear empties the repository`() {
        val repository = InMemoryOrderRepository()
        repository.save(sampleOrder("ord-1", "cus-1"))

        repository.clear()

        assertEquals(0, repository.size())
        assertTrue(repository.all().isEmpty())
    }

    @Test
    fun `findByIds returns matching orders in one call`() {
        val repository = InMemoryOrderRepository()
        repository.save(sampleOrder("ord-1", "cus-1"))
        repository.save(sampleOrder("ord-2", "cus-2"))

        val found = repository.findByIds(listOf("ord-1", "ord-2"))

        assertEquals(setOf("ord-1", "ord-2"), found.map { it.id }.toSet())
    }

    @Test
    fun `findByIds silently omits ids that do not match a stored order`() {
        val repository = InMemoryOrderRepository()
        repository.save(sampleOrder("ord-1", "cus-1"))

        val found = repository.findByIds(listOf("ord-1", "ord-missing"))

        assertEquals(listOf("ord-1"), found.map { it.id })
    }
}
