package bench.domain.usecase

import bench.data.InMemoryOrderRepository
import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.Money
import bench.domain.model.Order
import bench.domain.model.OrderLine
import bench.domain.model.OrderStatus
import bench.domain.model.ShippingMethod
import java.time.LocalDate
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class EstimateDeliveryDateTest {
    private val sampleOrder = Order(
        id = "ord-1",
        customerId = "cus-1",
        lines = listOf(OrderLine("sku-1001", 1, Money.ofUnits(10L))),
        status = OrderStatus.PENDING,
    )

    /** A Monday, chosen so every scenario below has a predictable, hand-checkable answer. */
    private val monday = LocalDate.of(2026, 8, 3)

    @Test
    fun `standard shipping from a monday adds processing plus transit days`() {
        val orders = InMemoryOrderRepository(seed = listOf(sampleOrder))
        val estimate = EstimateDeliveryDate(orders)

        val result = estimate("ord-1", ShippingMethod.STANDARD, from = monday)

        assertIs<Result.Success<LocalDate>>(result)
        // Monday + 1 processing day = Tuesday dispatch, + 5 transit days (skipping the
        // weekend in between) = the following Tuesday.
        assertEquals(LocalDate.of(2026, 8, 11), result.value)
    }

    @Test
    fun `overnight shipping is faster than standard from the same start date`() {
        val orders = InMemoryOrderRepository(seed = listOf(sampleOrder))
        val estimate = EstimateDeliveryDate(orders)

        val standard = (estimate("ord-1", ShippingMethod.STANDARD, from = monday) as Result.Success).value
        val overnight = (estimate("ord-1", ShippingMethod.OVERNIGHT, from = monday) as Result.Success).value

        assertEquals(true, overnight.isBefore(standard))
    }

    @Test
    fun `dispatch never lands on a weekend`() {
        val orders = InMemoryOrderRepository(seed = listOf(sampleOrder))
        val estimate = EstimateDeliveryDate(orders)
        val friday = LocalDate.of(2026, 8, 7)

        val result = estimate("ord-1", ShippingMethod.OVERNIGHT, from = friday) as Result.Success

        assertEquals(true, result.value.dayOfWeek.value in 1..5)
    }

    @Test
    fun `defaults to today when no start date is given`() {
        val orders = InMemoryOrderRepository(seed = listOf(sampleOrder))
        val estimate = EstimateDeliveryDate(orders)

        val result = estimate("ord-1", ShippingMethod.STANDARD)

        assertIs<Result.Success<LocalDate>>(result)
    }

    @Test
    fun `fails with NotFoundError for an unknown order id`() {
        val estimate = EstimateDeliveryDate(InMemoryOrderRepository())

        val result = estimate("ord-missing", ShippingMethod.STANDARD, from = monday)

        assertIs<NotFoundError>((result as Result.Failure).error)
    }
}
