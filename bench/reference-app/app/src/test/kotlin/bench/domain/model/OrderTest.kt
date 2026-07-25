package bench.domain.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class OrderTest {
    private fun order(vararg lines: OrderLine, discount: Discount? = null, status: OrderStatus = OrderStatus.PENDING) =
        Order(id = "ord-1", customerId = "cus-1", lines = lines.toList(), status = status, appliedDiscount = discount)

    @Test
    fun `total sums every line's subtotal`() {
        val sample = order(
            OrderLine("sku-1001", 2, Money.ofUnits(10L)),
            OrderLine("sku-1002", 1, Money.ofUnits(30L)),
        )

        assertEquals(Money.ofUnits(50L), sample.total)
    }

    @Test
    fun `total is zero for an order with no lines`() {
        val empty = order()

        assertEquals(Money.ZERO, empty.total)
    }

    @Test
    fun `discountedTotal equals total when no discount is applied`() {
        val sample = order(OrderLine("sku-1001", 1, Money.ofUnits(20L)))

        assertEquals(sample.total, sample.discountedTotal)
    }

    @Test
    fun `discountedTotal reflects an applied discount`() {
        val sample = order(
            OrderLine("sku-1001", 1, Money.ofUnits(100L)),
            discount = PercentageDiscount(1000),
        )

        assertEquals(Money.ofUnits(90L), sample.discountedTotal)
    }

    @Test
    fun `lineCount counts distinct line items, not units`() {
        val sample = order(
            OrderLine("sku-1001", 5, Money.ofUnits(10L)),
            OrderLine("sku-1002", 1, Money.ofUnits(10L)),
        )

        assertEquals(2, sample.lineCount())
    }

    @Test
    fun `totalUnitCount sums quantities across lines`() {
        val sample = order(
            OrderLine("sku-1001", 5, Money.ofUnits(10L)),
            OrderLine("sku-1002", 3, Money.ofUnits(10L)),
        )

        assertEquals(8, sample.totalUnitCount())
    }

    @Test
    fun `containsProduct is true when a line references that product`() {
        val sample = order(OrderLine("sku-1001", 1, Money.ofUnits(10L)))

        assertTrue(sample.containsProduct("sku-1001"))
        assertFalse(sample.containsProduct("sku-9999"))
    }

    @Test
    fun `isFinal reflects the underlying status`() {
        val delivered = order(status = OrderStatus.DELIVERED)
        val pending = order(status = OrderStatus.PENDING)

        assertTrue(delivered.isFinal())
        assertFalse(pending.isFinal())
    }

    @Test
    fun `withStatus returns a copy leaving lines and id untouched`() {
        val sample = order(OrderLine("sku-1001", 1, Money.ofUnits(10L)))

        val confirmed = sample.withStatus(OrderStatus.CONFIRMED)

        assertEquals(OrderStatus.CONFIRMED, confirmed.status)
        assertEquals(sample.id, confirmed.id)
        assertEquals(sample.lines, confirmed.lines)
    }

    @Test
    fun `withStatus preserves an already-applied discount`() {
        val sample = order(OrderLine("sku-1001", 1, Money.ofUnits(10L)), discount = PercentageDiscount(500))

        val confirmed = sample.withStatus(OrderStatus.CONFIRMED)

        assertEquals(sample.appliedDiscount, confirmed.appliedDiscount)
    }

    @Test
    fun `discountedTotal reflects a fixed amount discount`() {
        val sample = order(OrderLine("sku-1001", 1, Money.ofUnits(50L)), discount = FixedAmountDiscount(Money.ofUnits(20L)))

        assertEquals(Money.ofUnits(30L), sample.discountedTotal)
    }

    @Test
    fun `totalUnitCount is zero for an order with no lines`() {
        assertEquals(0, order().totalUnitCount())
    }

    @Test
    fun `containsProduct checks every line, not just the first`() {
        val sample = order(
            OrderLine("sku-1001", 1, Money.ofUnits(10L)),
            OrderLine("sku-1002", 1, Money.ofUnits(10L)),
            OrderLine("sku-1003", 1, Money.ofUnits(10L)),
        )

        assertTrue(sample.containsProduct("sku-1003"))
    }

    @Test
    fun `highestValueLine picks the line with the largest subtotal`() {
        val sample = order(
            OrderLine("sku-1001", 1, Money.ofUnits(10L)),
            OrderLine("sku-1002", 3, Money.ofUnits(50L)),
            OrderLine("sku-1003", 2, Money.ofUnits(5L)),
        )

        assertEquals("sku-1002", sample.highestValueLine()?.productId)
    }

    @Test
    fun `highestValueLine is null for an order with no lines`() {
        assertEquals(null, order().highestValueLine())
    }

    @Test
    fun `averageLineValue divides the total evenly across lines`() {
        val sample = order(
            OrderLine("sku-1001", 1, Money.ofUnits(30L)),
            OrderLine("sku-1002", 1, Money.ofUnits(10L)),
        )

        assertEquals(Money.ofUnits(20L), sample.averageLineValue())
    }

    @Test
    fun `averageLineValue is zero for an order with no lines`() {
        assertEquals(Money.ZERO, order().averageLineValue())
    }

    @Test
    fun `canAcceptDiscount is true while pending or confirmed`() {
        assertTrue(order(status = OrderStatus.PENDING).canAcceptDiscount())
        assertTrue(order(status = OrderStatus.CONFIRMED).canAcceptDiscount())
    }

    @Test
    fun `canAcceptDiscount is false once processing has started or the order is final`() {
        assertFalse(order(status = OrderStatus.PROCESSING).canAcceptDiscount())
        assertFalse(order(status = OrderStatus.DELIVERED).canAcceptDiscount())
        assertFalse(order(status = OrderStatus.CANCELLED).canAcceptDiscount())
    }
}

/** Covers [OrderLine] in isolation, kept next to [OrderTest] since the two types are always used together. */
class OrderLineTest {
    @Test
    fun `subtotal multiplies unit price by quantity`() {
        val line = OrderLine("sku-1001", 3, Money.ofUnits(15L))

        assertEquals(Money.ofUnits(45L), line.subtotal)
    }

    @Test
    fun `isMultiUnit is false for a single unit`() {
        assertFalse(OrderLine("sku-1001", 1, Money.ofUnits(10L)).isMultiUnit())
    }

    @Test
    fun `isMultiUnit is true for more than one unit`() {
        assertTrue(OrderLine("sku-1001", 2, Money.ofUnits(10L)).isMultiUnit())
    }

    @Test
    fun `withAdditionalQuantity increases quantity and recomputes the subtotal`() {
        val line = OrderLine("sku-1001", 2, Money.ofUnits(10L))

        val updated = line.withAdditionalQuantity(3)

        assertEquals(5, updated.quantity)
        assertEquals(Money.ofUnits(50L), updated.subtotal)
    }

    @Test
    fun `withAdditionalQuantity keeps the originally agreed unit price`() {
        val line = OrderLine("sku-1001", 1, Money.ofUnits(10L))

        val updated = line.withAdditionalQuantity(1)

        assertEquals(Money.ofUnits(10L), updated.unitPrice)
    }

    @Test
    fun `describe renders quantity and product id`() {
        val line = OrderLine("sku-1001", 4, Money.ofUnits(10L))

        assertEquals("4 x sku-1001", line.describe())
    }
}
