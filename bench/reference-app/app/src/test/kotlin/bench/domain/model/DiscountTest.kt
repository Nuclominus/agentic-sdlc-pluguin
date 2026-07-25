package bench.domain.model

import kotlin.test.Test
import kotlin.test.assertEquals

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
}
