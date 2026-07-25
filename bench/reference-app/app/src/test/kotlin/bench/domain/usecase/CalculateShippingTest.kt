package bench.domain.usecase

import bench.data.InMemoryOrderRepository
import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.Address
import bench.domain.model.Discount
import bench.domain.model.FreeShippingDiscount
import bench.domain.model.Money
import bench.domain.model.Order
import bench.domain.model.OrderLine
import bench.domain.model.OrderStatus
import bench.domain.model.ShippingMethod
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertIs
import kotlin.test.assertTrue

class CalculateShippingTest {
    private val domesticAddress = Address("12 Elm Street", "Portland", "OR", "97201", "US")
    private val internationalAddress = Address("15 Via Roma", "Milan", null, "20121", "IT")

    private fun orderWorth(cents: Long, discount: Discount? = null) = Order(
        id = "ord-1",
        customerId = "cus-1",
        lines = listOf(OrderLine("sku-1001", 1, Money(cents))),
        status = OrderStatus.PENDING,
        appliedDiscount = discount,
    )

    @Test
    fun `charges the method's base cost for a small domestic order`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderWorth(2000)))
        val calculateShipping = CalculateShipping(orders)

        val result = calculateShipping("ord-1", ShippingMethod.STANDARD, domesticAddress)

        assertIs<Result.Success<Money>>(result)
        assertEquals(ShippingMethod.STANDARD.baseCost, result.value)
    }

    @Test
    fun `adds a surcharge for an international destination`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderWorth(2000)))
        val calculateShipping = CalculateShipping(orders)

        val result = calculateShipping("ord-1", ShippingMethod.STANDARD, internationalAddress)

        assertIs<Result.Success<Money>>(result)
        assertEquals(Money.ofUnits(20L), result.value)
    }

    @Test
    fun `waives shipping once the order total clears the free-shipping threshold`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderWorth(Money.ofUnits(75L).cents)))
        val calculateShipping = CalculateShipping(orders)

        val result = calculateShipping("ord-1", ShippingMethod.EXPRESS, domesticAddress)

        assertIs<Result.Success<Money>>(result)
        assertEquals(Money.ZERO, result.value)
    }

    @Test
    fun `waives shipping when the order carries a free-shipping discount regardless of total`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderWorth(500, discount = FreeShippingDiscount)))
        val calculateShipping = CalculateShipping(orders)

        val result = calculateShipping("ord-1", ShippingMethod.OVERNIGHT, internationalAddress)

        assertIs<Result.Success<Money>>(result)
        assertEquals(Money.ZERO, result.value)
    }

    @Test
    fun `charges more for a faster method`() {
        val orders = InMemoryOrderRepository(seed = listOf(orderWorth(2000)))
        val calculateShipping = CalculateShipping(orders)

        val standard = calculateShipping("ord-1", ShippingMethod.STANDARD, domesticAddress) as Result.Success
        val overnight = calculateShipping("ord-1", ShippingMethod.OVERNIGHT, domesticAddress) as Result.Success

        assertEquals(true, overnight.value.cents > standard.value.cents)
    }

    @Test
    fun `fails with NotFoundError for an unknown order id`() {
        val calculateShipping = CalculateShipping(InMemoryOrderRepository())

        val result = calculateShipping("ord-missing", ShippingMethod.STANDARD, domesticAddress)

        assertIs<NotFoundError>((result as Result.Failure).error)
    }
}

/** Covers [ShippingMethod] in isolation, kept next to [CalculateShippingTest] since the two are always used together. */
class ShippingMethodTest {
    @Test
    fun `isExpedited is false only for standard shipping`() {
        assertFalse(ShippingMethod.STANDARD.isExpedited())
        assertTrue(ShippingMethod.EXPRESS.isExpedited())
        assertTrue(ShippingMethod.OVERNIGHT.isExpedited())
    }

    @Test
    fun `estimatedDeliveryDays adds processing time on top of transit time`() {
        assertEquals(6, ShippingMethod.STANDARD.estimatedDeliveryDays(processingDays = 1))
        assertEquals(2, ShippingMethod.OVERNIGHT.estimatedDeliveryDays(processingDays = 1))
    }

    @Test
    fun `displayLabel pluralizes business days correctly`() {
        assertEquals("Overnight (1 business day)", ShippingMethod.OVERNIGHT.displayLabel())
        assertEquals("Standard (5 business days)", ShippingMethod.STANDARD.displayLabel())
    }

    @Test
    fun `fastestWithin picks the quickest method affordable within budget`() {
        val fastest = ShippingMethod.fastestWithin(Money.ofUnits(12L))

        assertEquals(ShippingMethod.EXPRESS, fastest)
    }

    @Test
    fun `fastestWithin returns overnight when the whole budget allows it`() {
        val fastest = ShippingMethod.fastestWithin(Money.ofUnits(100L))

        assertEquals(ShippingMethod.OVERNIGHT, fastest)
    }

    @Test
    fun `fastestWithin returns null when nothing fits the budget`() {
        assertEquals(null, ShippingMethod.fastestWithin(Money.ofUnits(1L)))
    }
}
