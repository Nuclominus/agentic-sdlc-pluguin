package bench.domain.usecase

import bench.data.InMemoryCustomerRepository
import bench.data.InMemoryOrderRepository
import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.Money
import bench.domain.model.Order
import bench.domain.model.OrderLine
import bench.domain.model.OrderStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ListOrdersTest {
    private fun orderFor(customerId: String, sequence: Int, status: OrderStatus = OrderStatus.PENDING) = Order(
        id = "ord-$sequence",
        customerId = customerId,
        lines = listOf(OrderLine("sku-1001", 1, Money.ofUnits(10L))),
        status = status,
    )

    @Test
    fun `lists a customer's orders newest first`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderFor("cus-1", 1), orderFor("cus-1", 2)))
        val listOrders = ListOrders(orders, InMemoryCustomerRepository())

        val result = listOrders("cus-1")

        assertIs<Result.Success<List<Order>>>(result)
        assertEquals(listOf("ord-2", "ord-1"), result.value.map { it.id })
    }

    @Test
    fun `excludes archived orders by default`() {
        val orders = InMemoryOrderRepository(
            seed = listOf(orderFor("cus-1", 1), orderFor("cus-1", 2, OrderStatus.ARCHIVED)),
        )
        val listOrders = ListOrders(orders, InMemoryCustomerRepository())

        val result = listOrders("cus-1")

        assertIs<Result.Success<List<Order>>>(result)
        assertEquals(listOf("ord-1"), result.value.map { it.id })
    }

    @Test
    fun `includes archived orders when explicitly requested`() {
        val orders = InMemoryOrderRepository(
            seed = listOf(orderFor("cus-1", 1), orderFor("cus-1", 2, OrderStatus.ARCHIVED)),
        )
        val listOrders = ListOrders(orders, InMemoryCustomerRepository())

        val result = listOrders("cus-1", includeArchived = true)

        assertIs<Result.Success<List<Order>>>(result)
        assertEquals(2, result.value.size)
    }

    @Test
    fun `returns an empty list for a customer with no orders`() {
        val listOrders = ListOrders(InMemoryOrderRepository(), InMemoryCustomerRepository())

        val result = listOrders("cus-1")

        assertIs<Result.Success<List<Order>>>(result)
        assertTrue(result.value.isEmpty())
    }

    @Test
    fun `fails with NotFoundError for an unknown customer`() {
        val listOrders = ListOrders(InMemoryOrderRepository(), InMemoryCustomerRepository())

        val result = listOrders("cus-unknown")

        assertIs<NotFoundError>((result as Result.Failure).error)
    }

    @Test
    fun `does not mix in another customer's orders`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderFor("cus-1", 1), orderFor("cus-2", 2)))
        val listOrders = ListOrders(orders, InMemoryCustomerRepository())

        val result = listOrders("cus-1")

        assertIs<Result.Success<List<Order>>>(result)
        assertEquals(listOf("ord-1"), result.value.map { it.id })
    }

    @Test
    fun `mostRecent returns the highest sequence number order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderFor("cus-1", 1), orderFor("cus-1", 5)))
        val listOrders = ListOrders(orders, InMemoryCustomerRepository())

        val result = listOrders.mostRecent("cus-1")

        assertIs<Result.Success<Order?>>(result)
        assertEquals("ord-5", result.value?.id)
    }

    @Test
    fun `mostRecent includes archived orders, unlike the default listing`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderFor("cus-1", 1, OrderStatus.ARCHIVED)))
        val listOrders = ListOrders(orders, InMemoryCustomerRepository())

        val result = listOrders.mostRecent("cus-1")

        assertIs<Result.Success<Order?>>(result)
        assertEquals("ord-1", result.value?.id)
    }

    @Test
    fun `mostRecent is null for a customer with no orders`() {
        val listOrders = ListOrders(InMemoryOrderRepository(), InMemoryCustomerRepository())

        val result = listOrders.mostRecent("cus-1")

        assertIs<Result.Success<Order?>>(result)
        assertEquals(null, result.value)
    }

    @Test
    fun `mostRecent fails with NotFoundError for an unknown customer`() {
        val listOrders = ListOrders(InMemoryOrderRepository(), InMemoryCustomerRepository())

        val result = listOrders.mostRecent("cus-unknown")

        assertIs<NotFoundError>((result as Result.Failure).error)
    }

    @Test
    fun `withStatus returns only orders in that status`() {
        val orders = InMemoryOrderRepository(
            seed = listOf(orderFor("cus-1", 1, OrderStatus.PENDING), orderFor("cus-1", 2, OrderStatus.SHIPPED)),
        )
        val listOrders = ListOrders(orders, InMemoryCustomerRepository())

        val result = listOrders.withStatus("cus-1", OrderStatus.SHIPPED)

        assertIs<Result.Success<List<Order>>>(result)
        assertEquals(listOf("ord-2"), result.value.map { it.id })
    }

    @Test
    fun `withStatus includes archived orders when that is the requested status`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderFor("cus-1", 1, OrderStatus.ARCHIVED)))
        val listOrders = ListOrders(orders, InMemoryCustomerRepository())

        val result = listOrders.withStatus("cus-1", OrderStatus.ARCHIVED)

        assertIs<Result.Success<List<Order>>>(result)
        assertEquals(1, result.value.size)
    }

    @Test
    fun `withStatus fails with NotFoundError for an unknown customer`() {
        val listOrders = ListOrders(InMemoryOrderRepository(), InMemoryCustomerRepository())

        val result = listOrders.withStatus("cus-unknown", OrderStatus.PENDING)

        assertIs<NotFoundError>((result as Result.Failure).error)
    }
}
