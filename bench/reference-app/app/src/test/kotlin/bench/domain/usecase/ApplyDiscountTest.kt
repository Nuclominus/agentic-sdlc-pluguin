package bench.domain.usecase

import bench.data.InMemoryOrderRepository
import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.ValidationError
import bench.domain.model.FixedAmountDiscount
import bench.domain.model.FreeShippingDiscount
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

    @Test
    fun `still accepts a discount on a shipped order, unlike a processing one`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.SHIPPED)))
        val applyDiscount = ApplyDiscount(orders)

        val result = applyDiscount("ord-1", PercentageDiscount(1000))

        assertIs<Result.Success<Order>>(result)
    }

    @Test
    fun `fails to apply a discount to a cancelled order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.CANCELLED)))
        val applyDiscount = ApplyDiscount(orders)

        val result = applyDiscount("ord-1", PercentageDiscount(1000))

        assertIs<ValidationError>((result as Result.Failure).error)
    }

    @Test
    fun `does not persist a rejected discount`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.CANCELLED)))
        val applyDiscount = ApplyDiscount(orders)

        applyDiscount("ord-1", PercentageDiscount(1000))

        assertEquals(null, orders.findById("ord-1")?.appliedDiscount)
    }

    @Test
    fun `a free shipping discount attaches without changing the subtotal`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.PENDING)))
        val applyDiscount = ApplyDiscount(orders)

        val result = applyDiscount("ord-1", FreeShippingDiscount)

        assertIs<Result.Success<Order>>(result)
        assertEquals(Money.ofUnits(100L), result.value.discountedTotal)
    }

    @Test
    fun `canApply is true for a pending order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.PENDING)))
        val applyDiscount = ApplyDiscount(orders)

        assertEquals(true, applyDiscount.canApply("ord-1"))
    }

    @Test
    fun `canApply is false for a cancelled order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.CANCELLED)))
        val applyDiscount = ApplyDiscount(orders)

        assertEquals(false, applyDiscount.canApply("ord-1"))
    }

    @Test
    fun `canApply is false for an unknown order id`() {
        val applyDiscount = ApplyDiscount(InMemoryOrderRepository())

        assertEquals(false, applyDiscount.canApply("ord-missing"))
    }

    @Test
    fun `remove clears a previously applied discount`() {
        val orders = InMemoryOrderRepository(
            seed = listOf(orderIn(OrderStatus.PENDING).copy(appliedDiscount = PercentageDiscount(1000))),
        )
        val applyDiscount = ApplyDiscount(orders)

        val result = applyDiscount.remove("ord-1")

        assertIs<Result.Success<Order>>(result)
        assertEquals(null, result.value.appliedDiscount)
    }

    @Test
    fun `remove is a no-op when there is no discount to remove`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderIn(OrderStatus.PENDING)))
        val applyDiscount = ApplyDiscount(orders)

        val result = applyDiscount.remove("ord-1")

        assertIs<Result.Success<Order>>(result)
        assertEquals(null, result.value.appliedDiscount)
    }

    @Test
    fun `remove fails with NotFoundError for an unknown order id`() {
        val applyDiscount = ApplyDiscount(InMemoryOrderRepository())

        val result = applyDiscount.remove("ord-missing")

        assertIs<NotFoundError>((result as Result.Failure).error)
    }
}
