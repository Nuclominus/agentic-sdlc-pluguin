package bench.domain.usecase

import bench.data.InMemoryOrderRepository
import bench.data.InMemoryProductRepository
import bench.domain.Result
import bench.domain.model.Money
import bench.domain.model.Order
import bench.domain.model.OrderLine
import bench.domain.model.OrderStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

/**
 * Covers [CreateOrder]'s current, documented behaviour only: sequential id
 * assignment and the initial [OrderStatus.PENDING] status. It intentionally
 * does not test input validation, because `CreateOrder` does not perform
 * any yet — that is a deliberate gap left for a later change, not an
 * oversight in this test suite.
 */
class CreateOrderTest {
    @Test
    fun `creates a pending order from the given lines`() {
        val createOrder = CreateOrder(InMemoryOrderRepository(), InMemoryProductRepository())
        val lines = listOf(OrderLine("sku-1001", 2, Money.ofUnits(24L)))

        val result = createOrder("cus-1", lines)

        assertIs<Result.Success<Order>>(result)
        assertEquals(OrderStatus.PENDING, result.value.status)
        assertEquals(lines, result.value.lines)
    }

    @Test
    fun `assigns the first sequential id for a customer's first order`() {
        val createOrder = CreateOrder(InMemoryOrderRepository(), InMemoryProductRepository())

        val result = createOrder("cus-1", emptyList()) as Result.Success<Order>

        assertEquals("ord-1", result.value.id)
    }

    @Test
    fun `assigns increasing ids for the same customer's subsequent orders`() {
        val orders = InMemoryOrderRepository()
        val createOrder = CreateOrder(orders, InMemoryProductRepository())

        createOrder("cus-1", emptyList())
        val second = createOrder("cus-1", emptyList()) as Result.Success<Order>

        assertEquals("ord-2", second.value.id)
    }

    @Test
    fun `persists the created order to the repository`() {
        val orders = InMemoryOrderRepository()
        val createOrder = CreateOrder(orders, InMemoryProductRepository())

        val result = createOrder("cus-1", emptyList()) as Result.Success<Order>

        assertEquals(result.value, orders.findById(result.value.id))
    }

    @Test
    fun `id sequencing is scoped per customer`() {
        val orders = InMemoryOrderRepository()
        val createOrder = CreateOrder(orders, InMemoryProductRepository())

        createOrder("cus-1", emptyList())
        val forOtherCustomer = createOrder("cus-2", emptyList()) as Result.Success<Order>

        assertEquals("ord-1", forOtherCustomer.value.id)
    }
}
