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
 * Covers [CreateOrder]'s id assignment, initial status, and line pass-through.
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

    @Test
    fun `keeps every line, including multiple lines for the same product`() {
        val createOrder = CreateOrder(InMemoryOrderRepository(), InMemoryProductRepository())
        val lines = listOf(
            OrderLine("sku-1001", 1, Money.ofUnits(10L)),
            OrderLine("sku-1001", 2, Money.ofUnits(10L)),
            OrderLine("sku-1002", 1, Money.ofUnits(20L)),
        )

        val result = createOrder("cus-1", lines) as Result.Success<Order>

        assertEquals(3, result.value.lineCount())
    }

    @Test
    fun `the created order's total reflects its lines`() {
        val createOrder = CreateOrder(InMemoryOrderRepository(), InMemoryProductRepository())
        val lines = listOf(
            OrderLine("sku-1001", 2, Money.ofUnits(10L)),
            OrderLine("sku-1002", 1, Money.ofUnits(30L)),
        )

        val result = createOrder("cus-1", lines) as Result.Success<Order>

        assertEquals(Money.ofUnits(50L), result.value.total)
    }

    @Test
    fun `attaches no discount to a freshly created order`() {
        val createOrder = CreateOrder(InMemoryOrderRepository(), InMemoryProductRepository())

        val result = createOrder("cus-1", emptyList()) as Result.Success<Order>

        assertEquals(null, result.value.appliedDiscount)
    }
}
