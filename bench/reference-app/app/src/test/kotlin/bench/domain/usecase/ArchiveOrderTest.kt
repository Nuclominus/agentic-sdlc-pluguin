package bench.domain.usecase

import bench.data.InMemoryOrderRepository
import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.ValidationError
import bench.domain.model.Money
import bench.domain.model.Order
import bench.domain.model.OrderLine
import bench.domain.model.OrderStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ArchiveOrderTest {
    private fun orderIn(status: OrderStatus) = Order(
        id = "ord-1",
        customerId = "cus-1",
        lines = listOf(OrderLine("sku-1001", 1, Money.ofUnits(10L))),
        status = status,
    )

    @Test
    fun `archives a delivered order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.DELIVERED)))
        val archiveOrder = ArchiveOrder(orders)

        val result = archiveOrder("ord-1")

        assertIs<Result.Success<Order>>(result)
        assertEquals(OrderStatus.ARCHIVED, result.value.status)
    }

    @Test
    fun `archives a cancelled order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.CANCELLED)))
        val archiveOrder = ArchiveOrder(orders)

        val result = archiveOrder("ord-1")

        assertIs<Result.Success<Order>>(result)
        assertEquals(OrderStatus.ARCHIVED, result.value.status)
    }

    @Test
    fun `fails to archive an order still in flight`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.SHIPPED)))
        val archiveOrder = ArchiveOrder(orders)

        val result = archiveOrder("ord-1")

        assertIs<ValidationError>((result as Result.Failure).error)
    }

    @Test
    fun `fails to archive a pending order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.PENDING)))
        val archiveOrder = ArchiveOrder(orders)

        val result = archiveOrder("ord-1")

        assertIs<Result.Failure>(result)
    }

    @Test
    fun `fails with NotFoundError for an unknown order id`() {
        val archiveOrder = ArchiveOrder(InMemoryOrderRepository())

        val result = archiveOrder("ord-missing")

        assertIs<NotFoundError>((result as Result.Failure).error)
    }

    @Test
    fun `persists the archived status to the repository`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.DELIVERED)))
        val archiveOrder = ArchiveOrder(orders)

        archiveOrder("ord-1")

        assertEquals(OrderStatus.ARCHIVED, orders.findById("ord-1")?.status)
    }

    @Test
    fun `archiveAllIn archives every delivered order and leaves others alone`() {
        val delivered1 = orderIn(OrderStatus.DELIVERED).copy(id = "ord-1")
        val delivered2 = orderIn(OrderStatus.DELIVERED).copy(id = "ord-2")
        val stillShipped = orderIn(OrderStatus.SHIPPED).copy(id = "ord-3")
        val orders = InMemoryOrderRepository(seed = listOf(delivered1, delivered2, stillShipped))
        val archiveOrder = ArchiveOrder(orders)

        val archived = archiveOrder.archiveAllIn(OrderStatus.DELIVERED)

        assertEquals(setOf("ord-1", "ord-2"), archived.map { it.id }.toSet())
        assertEquals(OrderStatus.SHIPPED, orders.findById("ord-3")?.status)
    }

    @Test
    fun `archiveAllIn persists every archived order to the repository`() {
        val orders = InMemoryOrderRepository(
            seed = listOf(orderIn(OrderStatus.CANCELLED).copy(id = "ord-1")),
        )
        val archiveOrder = ArchiveOrder(orders)

        archiveOrder.archiveAllIn(OrderStatus.CANCELLED)

        assertEquals(OrderStatus.ARCHIVED, orders.findById("ord-1")?.status)
    }

    @Test
    fun `archiveAllIn returns an empty list when nothing matches the status`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.PENDING)))
        val archiveOrder = ArchiveOrder(orders)

        assertEquals(emptyList(), archiveOrder.archiveAllIn(OrderStatus.DELIVERED))
    }

    @Test
    fun `canArchive is true for a delivered order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.DELIVERED)))
        val archiveOrder = ArchiveOrder(orders)

        assertTrue(archiveOrder.canArchive("ord-1"))
    }

    @Test
    fun `canArchive is false for an order still in flight`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.SHIPPED)))
        val archiveOrder = ArchiveOrder(orders)

        assertFalse(archiveOrder.canArchive("ord-1"))
    }

    @Test
    fun `canArchive is false for an unknown order id`() {
        val archiveOrder = ArchiveOrder(InMemoryOrderRepository())

        assertFalse(archiveOrder.canArchive("ord-missing"))
    }

    @Test
    fun `countArchivable counts only the eligible orders for that customer`() {
        val delivered = orderIn(OrderStatus.DELIVERED).copy(id = "ord-1")
        val cancelled = orderIn(OrderStatus.CANCELLED).copy(id = "ord-2")
        val stillPending = orderIn(OrderStatus.PENDING).copy(id = "ord-3")
        val orders = InMemoryOrderRepository(seed = listOf(delivered, cancelled, stillPending))
        val archiveOrder = ArchiveOrder(orders)

        assertEquals(2, archiveOrder.countArchivable("cus-1"))
    }

    @Test
    fun `countArchivable is zero for a customer with nothing archivable`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.PENDING)))
        val archiveOrder = ArchiveOrder(orders)

        assertEquals(0, archiveOrder.countArchivable("cus-1"))
    }
}
