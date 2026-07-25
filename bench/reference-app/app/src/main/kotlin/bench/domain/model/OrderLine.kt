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
}
