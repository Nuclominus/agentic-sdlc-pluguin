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

class CancelOrderTest {
    private fun orderIn(status: OrderStatus) = Order(
        id = "ord-1",
        customerId = "cus-1",
        lines = listOf(OrderLine("sku-1001", 1, Money.ofUnits(20L))),
        status = status,
    )

    @Test
    fun `cancels a pending order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.PENDING)))
        val cancelOrder = CancelOrder(orders)

        val result = cancelOrder("ord-1")

        assertIs<Result.Success<Order>>(result)
        assertEquals(OrderStatus.CANCELLED, result.value.status)
    }

    @Test
    fun `cancels a confirmed order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.CONFIRMED)))
        val cancelOrder = CancelOrder(orders)

        val result = cancelOrder("ord-1")

        assertIs<Result.Success<Order>>(result)
        assertEquals(OrderStatus.CANCELLED, result.value.status)
    }

    @Test
    fun `persists the cancellation to the repository`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.PENDING)))
        val cancelOrder = CancelOrder(orders)

        cancelOrder("ord-1")

        assertEquals(OrderStatus.CANCELLED, orders.findById("ord-1")?.status)
    }

    @Test
    fun `fails with NotFoundError for an unknown order id`() {
        val orders = InMemoryOrderRepository()
        val cancelOrder = CancelOrder(orders)

        val result = cancelOrder("ord-missing")

        assertIs<Result.Failure>(result)
        assertEquals("ord-missing", (result.error as NotFoundError).id)
    }

    @Test
    fun `fails to cancel an already delivered order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.DELIVERED)))
        val cancelOrder = CancelOrder(orders)

        val result = cancelOrder("ord-1")

        assertIs<Result.Failure>(result)
        assertIs<ValidationError>(result.error)
    }

    @Test
    fun `fails to cancel an already cancelled order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.CANCELLED)))
        val cancelOrder = CancelOrder(orders)

        val result = cancelOrder("ord-1")

        assertIs<Result.Failure>(result)
    }

    @Test
    fun `fails to cancel an archived order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.ARCHIVED)))
        val cancelOrder = CancelOrder(orders)

        val result = cancelOrder("ord-1")

        assertIs<Result.Failure>(result)
    }

    @Test
    fun `does not modify the stored order when cancellation is rejected`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.DELIVERED)))
        val cancelOrder = CancelOrder(orders)

        cancelOrder("ord-1")

        assertTrue(orders.findById("ord-1")?.status == OrderStatus.DELIVERED)
    }

    @Test
    fun `canCancel is true for a pending order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.PENDING)))
        val cancelOrder = CancelOrder(orders)

        assertTrue(cancelOrder.canCancel("ord-1"))
    }

    @Test
    fun `canCancel is false for a delivered order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.DELIVERED)))
        val cancelOrder = CancelOrder(orders)

        assertFalse(cancelOrder.canCancel("ord-1"))
    }

    @Test
    fun `canCancel is false for an unknown order id, same as a rejected cancellation`() {
        val cancelOrder = CancelOrder(InMemoryOrderRepository())

        assertFalse(cancelOrder.canCancel("ord-missing"))
    }

    @Test
    fun `canCancel does not itself change any stored order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.PENDING)))
        val cancelOrder = CancelOrder(orders)

        cancelOrder.canCancel("ord-1")

        assertEquals(OrderStatus.PENDING, orders.findById("ord-1")?.status)
    }

    @Test
    fun `cancelAllForCustomer cancels every cancellable order and skips the rest`() {
        val cancellable = orderIn(OrderStatus.PENDING).copy(id = "ord-1")
        val alreadyDelivered = orderIn(OrderStatus.DELIVERED).copy(id = "ord-2")
        val orders = InMemoryOrderRepository(seed = listOf(cancellable, alreadyDelivered))
        val cancelOrder = CancelOrder(orders)

        val cancelled = cancelOrder.cancelAllForCustomer("cus-1")

        assertEquals(listOf("ord-1"), cancelled.map { it.id })
        assertEquals(OrderStatus.DELIVERED, orders.findById("ord-2")?.status)
    }

    @Test
    fun `cancelAllForCustomer persists every cancellation`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.CONFIRMED).copy(id = "ord-1")))
        val cancelOrder = CancelOrder(orders)

        cancelOrder.cancelAllForCustomer("cus-1")

        assertEquals(OrderStatus.CANCELLED, orders.findById("ord-1")?.status)
    }

    @Test
    fun `cancelAllForCustomer is empty for a customer with no cancellable orders`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.DELIVERED).copy(id = "ord-1")))
        val cancelOrder = CancelOrder(orders)

        assertEquals(emptyList(), cancelOrder.cancelAllForCustomer("cus-1"))
    }
}
