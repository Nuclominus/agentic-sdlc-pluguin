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
}
