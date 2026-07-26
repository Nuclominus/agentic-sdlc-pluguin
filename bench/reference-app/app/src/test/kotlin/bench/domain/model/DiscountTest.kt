package bench.domain.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class DiscountTest {
    @Test
    fun `PercentageDiscount reduces the subtotal by its basis points`() {
        val discount = PercentageDiscount(1500)

        val result = discount.apply(Money.ofUnits(200L))

        assertEquals(Money.ofUnits(170L), result)
    }

    @Test
    fun `PercentageDiscount of zero basis points leaves the subtotal untouched`() {
        val discount = PercentageDiscount(0)

        val result = discount.apply(Money.ofUnits(200L))

        assertEquals(Money.ofUnits(200L), result)
    }

    @Test
    fun `PercentageDiscount describe renders a percentage`() {
        val discount = PercentageDiscount(1500)

        assertEquals("15.0% off", discount.describe())
    }

    @Test
    fun `FixedAmountDiscount subtracts a flat amount`() {
        val discount = FixedAmountDiscount(Money.ofUnits(10L))

        val result = discount.apply(Money.ofUnits(50L))

        assertEquals(Money.ofUnits(40L), result)
    }

    @Test
    fun `FixedAmountDiscount floors at zero instead of going negative`() {
        val discount = FixedAmountDiscount(Money.ofUnits(999L))

        val result = discount.apply(Money.ofUnits(50L))

        assertEquals(Money.ZERO, result)
    }

    @Test
    fun `FreeShippingDiscount leaves the subtotal unchanged`() {
        val subtotal = Money.ofUnits(75L)

        val result = FreeShippingDiscount.apply(subtotal)

        assertEquals(subtotal, result)
    }

    @Test
    fun `FreeShippingDiscount describe is a fixed label`() {
        assertEquals("Free shipping", FreeShippingDiscount.describe())
    }

    @Test
    fun `PercentageDiscount of one hundred percent reduces the subtotal to zero`() {
        val discount = PercentageDiscount(10_000)

        assertEquals(Money.ZERO, discount.apply(Money.ofUnits(40L)))
    }

    @Test
    fun `FixedAmountDiscount of exactly the subtotal reduces it to zero`() {
        val discount = FixedAmountDiscount(Money.ofUnits(50L))

        assertEquals(Money.ZERO, discount.apply(Money.ofUnits(50L)))
    }

    @Test
    fun `bestDiscountFor picks the percentage discount when it saves more`() {
        val discounts = listOf(PercentageDiscount(5000), FixedAmountDiscount(Money.ofUnits(10L)))

        val best = bestDiscountFor(discounts, Money.ofUnits(100L))

        assertEquals(PercentageDiscount(5000), best)
    }

    @Test
    fun `bestDiscountFor picks the fixed discount when it saves more`() {
        val discounts = listOf(PercentageDiscount(500), FixedAmountDiscount(Money.ofUnits(10L)))

        val best = bestDiscountFor(discounts, Money.ofUnits(100L))

        assertEquals(FixedAmountDiscount(Money.ofUnits(10L)), best)
    }

    @Test
    fun `bestDiscountFor returns null for an empty list`() {
        assertNull(bestDiscountFor(emptyList(), Money.ofUnits(100L)))
    }
}
