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
import kotlin.test.assertIs

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
}
