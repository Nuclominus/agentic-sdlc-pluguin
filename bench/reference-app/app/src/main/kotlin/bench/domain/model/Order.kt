package bench.domain.model

/**
 * A customer's order: a set of [lines] moving through an [OrderStatus]
 * lifecycle.
 *
 * @property id a stable, opaque identifier, e.g. "ord-1042".
 * @property customerId the id of the [Customer] who placed the order.
 * @property lines the individual product/quantity/price entries on the order.
 * @property status the order's current lifecycle stage.
 * @property appliedDiscount an optional discount applied to the order after
 *   creation, via [ApplyDiscount][bench.domain.usecase.ApplyDiscount]. Absent
 *   on a freshly created order.
 */
data class Order(
    val id: String,
    val customerId: String,
    val lines: List<OrderLine>,
    val status: OrderStatus,
    val appliedDiscount: Discount? = null,
) {
    /** The sum of every line's [OrderLine.subtotal], before any discount. */
    val total: Money get() = lines.fold(Money.ZERO) { acc, line -> acc + line.subtotal }

    /** [total] after [appliedDiscount] has been applied, if any. */
    val discountedTotal: Money get() = appliedDiscount?.apply(total) ?: total

    /** The number of distinct line items on this order. */
    fun lineCount(): Int = lines.size

    /** The total number of units across every line, counting quantities. */
    fun totalUnitCount(): Int = lines.sumOf { it.quantity }

    /** Whether any line on this order references [productId]. */
    fun containsProduct(productId: String): Boolean = lines.any { it.productId == productId }

    /** Whether this order has reached a state where no further changes are expected. */
    fun isFinal(): Boolean = status.isTerminal()

    /** A copy of this order with its [status] moved to [next], with no other changes. */
    fun withStatus(next: OrderStatus): Order = copy(status = next)

    /**
     * The single line with the highest [OrderLine.subtotal], or `null` for
     * an order with no lines.
     *
     * Ties are broken by keeping the first matching line in [lines], which
     * makes the result deterministic without imposing any ordering
     * requirement on the caller.
     */
    fun highestValueLine(): OrderLine? = lines.maxByOrNull { it.subtotal.cents }

    /**
     * The mean [OrderLine.subtotal] across every line, or [Money.ZERO] for
     * an order with no lines. Integer division means the result rounds
     * toward zero, matching how [Money] represents every other amount as
     * whole cents.
     */
    fun averageLineValue(): Money {
        if (lines.isEmpty()) return Money.ZERO
        return Money(total.cents / lines.size)
    }

    /**
     * Whether this order is eligible for a discount to be applied to it —
     * see [ApplyDiscount][bench.domain.usecase.ApplyDiscount] for the
     * precise rule. Exposed here so the model and the use case cannot
     * silently drift apart on what "still eligible" means.
     */
    fun canAcceptDiscount(): Boolean = !isFinal() && status != OrderStatus.PROCESSING
}
