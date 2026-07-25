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

class SummariseCustomerSpendTest {
    private fun orderWorth(id: String, cents: Long, status: OrderStatus = OrderStatus.DELIVERED) = Order(
        id = id,
        customerId = "cus-1",
        lines = listOf(OrderLine("sku-1001", 1, Money(cents))),
        status = status,
    )

    @Test
    fun `sums the discounted total across every qualifying order`() {
        val orders = InMemoryOrderRepository(
            seed = listOf(orderWorth("ord-1", 1000), orderWorth("ord-2", 2000)),
        )
        val summarise = SummariseCustomerSpend(orders, InMemoryCustomerRepository())

        val result = summarise("cus-1")

        assertIs<Result.Success<CustomerSpendSummary>>(result)
        assertEquals(Money(3000), result.value.totalSpend)
        assertEquals(2, result.value.orderCount)
    }

    @Test
    fun `excludes cancelled orders from every figure`() {
        val orders = InMemoryOrderRepository(
            seed = listOf(orderWorth("ord-1", 1000), orderWorth("ord-2", 5000, OrderStatus.CANCELLED)),
        )
        val summarise = SummariseCustomerSpend(orders, InMemoryCustomerRepository())

        val result = summarise("cus-1")

        assertIs<Result.Success<CustomerSpendSummary>>(result)
        assertEquals(Money(1000), result.value.totalSpend)
        assertEquals(1, result.value.orderCount)
    }

    @Test
    fun `computes the average order value`() {
        val orders = InMemoryOrderRepository(
            seed = listOf(orderWorth("ord-1", 1000), orderWorth("ord-2", 3000)),
        )
        val summarise = SummariseCustomerSpend(orders, InMemoryCustomerRepository())

        val result = summarise("cus-1")

        assertIs<Result.Success<CustomerSpendSummary>>(result)
        assertEquals(Money(2000), result.value.averageOrderValue)
    }

    @Test
    fun `finds the largest single order`() {
        val orders = InMemoryOrderRepository(
            seed = listOf(orderWorth("ord-1", 1000), orderWorth("ord-2", 4500), orderWorth("ord-3", 2200)),
        )
        val summarise = SummariseCustomerSpend(orders, InMemoryCustomerRepository())

        val result = summarise("cus-1")

        assertIs<Result.Success<CustomerSpendSummary>>(result)
        assertEquals(Money(4500), result.value.largestOrder)
    }

    @Test
    fun `returns a zeroed summary for a customer with no qualifying orders`() {
        val summarise = SummariseCustomerSpend(InMemoryOrderRepository(), InMemoryCustomerRepository())

        val result = summarise("cus-1")

        assertIs<Result.Success<CustomerSpendSummary>>(result)
        assertEquals(0, result.value.orderCount)
        assertEquals(Money.ZERO, result.value.totalSpend)
    }

    @Test
    fun `fails with NotFoundError for an unknown customer`() {
        val summarise = SummariseCustomerSpend(InMemoryOrderRepository(), InMemoryCustomerRepository())

        val result = summarise("cus-unknown")

        assertIs<NotFoundError>((result as Result.Failure).error)
    }
}
