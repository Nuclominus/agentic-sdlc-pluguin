package bench.domain.model

/**
 * A single line item within an [Order]: a quantity of one product at the
 * price it was sold for.
 *
 * The [unitPrice] is captured on the line itself, separately from
 * [Product.unitPrice], because catalog prices change over time and an
 * existing order must keep showing the price the customer actually agreed
 * to pay.
 *
 * @property productId the id of the [Product] this line refers to.
 * @property quantity the number of units ordered.
 * @property unitPrice the price per unit at the time the order was placed.
 */
data class OrderLine(
    val productId: String,
    val quantity: Int,
    val unitPrice: Money,
) {
    /** The total cost of this line: [unitPrice] times [quantity]. */
    val subtotal: Money get() = unitPrice * quantity

    /** Whether this line represents more than a single unit. */
    fun isMultiUnit(): Boolean = quantity > 1

    /**
     * A copy of this line with [additional] more units added to
     * [quantity], keeping the originally agreed [unitPrice] unchanged.
     * This is how a "increase quantity" cart edit is modeled: as a new
     * line value, since [OrderLine] itself has no mutable state to update
     * in place.
     */
    fun withAdditionalQuantity(additional: Int): OrderLine = copy(quantity = quantity + additional)

    /** A short label like "2 x sku-1001", suitable for a compact list view or log line. */
    fun describe(): String = "$quantity x $productId"

    /**
     * A copy of this line re-priced at [newUnitPrice], keeping [quantity]
     * unchanged. Distinct from [withAdditionalQuantity], which changes
     * quantity but not price — this is the "the catalog price changed
     * before checkout, re-quote the line" case instead.
     */
    fun repriced(newUnitPrice: Money): OrderLine = copy(unitPrice = newUnitPrice)

    /** Whether this line refers to [otherProductId], for merging or grouping identical lines. */
    fun isFor(otherProductId: String): Boolean = productId == otherProductId

    companion object {
        /**
         * Builds an [OrderLine] for one unit of [product] at its current
         * catalog price, the common case at checkout where the price
         * being agreed to *is* today's catalog price.
         */
        fun singleUnitOf(product: Product): OrderLine = OrderLine(product.id, quantity = 1, unitPrice = product.unitPrice)
    }
}
