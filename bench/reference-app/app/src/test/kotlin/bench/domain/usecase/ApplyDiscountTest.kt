package bench.domain.usecase

import bench.data.InMemoryOrderRepository
import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.ValidationError
import bench.domain.model.FixedAmountDiscount
import bench.domain.model.Money
import bench.domain.model.Order
import bench.domain.model.OrderLine
import bench.domain.model.OrderStatus
import bench.domain.model.PercentageDiscount
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ApplyDiscountTest {
    private fun orderIn(status: OrderStatus) = Order(
        id = "ord-1",
        customerId = "cus-1",
        lines = listOf(OrderLine("sku-1001", 1, Money.ofUnits(100L))),
        status = status,
    )

    @Test
    fun `attaches a percentage discount to a pending order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.PENDING)))
        val applyDiscount = ApplyDiscount(orders)

        val result = applyDiscount("ord-1", PercentageDiscount(1000))

        assertIs<Result.Success<Order>>(result)
        assertEquals(Money.ofUnits(90L), result.value.discountedTotal)
    }

    @Test
    fun `attaches a fixed amount discount to a confirmed order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.CONFIRMED)))
        val applyDiscount = ApplyDiscount(orders)

        val result = applyDiscount("ord-1", FixedAmountDiscount(Money.ofUnits(15L)))

        assertIs<Result.Success<Order>>(result)
        assertEquals(Money.ofUnits(85L), result.value.discountedTotal)
    }

    @Test
    fun `replaces a previously applied discount`() {
        val orders = InMemoryOrderRepository(
            seed = listOf(orderIn(OrderStatus.PENDING).copy(appliedDiscount = PercentageDiscount(500))),
        )
        val applyDiscount = ApplyDiscount(orders)

        val result = applyDiscount("ord-1", PercentageDiscount(2000))

        assertIs<Result.Success<Order>>(result)
        assertEquals(Money.ofUnits(80L), result.value.discountedTotal)
    }

    @Test
    fun `fails with NotFoundError for an unknown order id`() {
        val orders = InMemoryOrderRepository()
        val applyDiscount = ApplyDiscount(orders)

        val result = applyDiscount("ord-missing", PercentageDiscount(1000))

        assertIs<NotFoundError>((result as Result.Failure).error)
    }

    @Test
    fun `fails to apply a discount to a processing order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.PROCESSING)))
        val applyDiscount = ApplyDiscount(orders)

        val result = applyDiscount("ord-1", PercentageDiscount(1000))

        assertIs<ValidationError>((result as Result.Failure).error)
    }

    @Test
    fun `fails to apply a discount to a delivered order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.DELIVERED)))
        val applyDiscount = ApplyDiscount(orders)

        val result = applyDiscount("ord-1", PercentageDiscount(1000))

        assertIs<Result.Failure>(result)
    }

    @Test
    fun `persists the discount to the repository`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.PENDING)))
        val applyDiscount = ApplyDiscount(orders)

        applyDiscount("ord-1", PercentageDiscount(1000))

        assertEquals(PercentageDiscount(1000), orders.findById("ord-1")?.appliedDiscount)
    }
}
