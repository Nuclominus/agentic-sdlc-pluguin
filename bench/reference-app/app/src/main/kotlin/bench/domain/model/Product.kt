package bench.domain.model

/**
 * A sellable item in the catalog.
 *
 * This model deliberately carries no validation of its own — whether a
 * given [id], [name], or [unitPrice] is acceptable is a decision that
 * belongs to whichever use case constructs or accepts a `Product`, since
 * different entry points (a bulk import, a manual catalog edit, a supplier
 * feed) can have different rules.
 *
 * @property id a stable, opaque identifier, e.g. "sku-4471".
 * @property name the display name shown to customers.
 * @property unitPrice the price for a single unit, before any discounts.
 * @property active whether the product is currently sellable. An inactive
 *   product remains in the catalog (for historical order lines that
 *   reference it) but should not be offered for new orders.
 */
data class Product(
    val id: String,
    val name: String,
    val unitPrice: Money,
    val active: Boolean,
) {
    /** The cost of buying [quantity] units of this product, before discounts. */
    fun subtotalFor(quantity: Int): Money = unitPrice * quantity

    /**
     * A label for list views: the plain [name] when [active], or a name
     * suffixed to flag that the product can no longer be ordered.
     */
    fun catalogLabel(): String = if (active) name else "$name (discontinued)"

    /** Whether this product's price is at or below [ceiling]. */
    fun isPricedAtMost(ceiling: Money): Boolean = unitPrice.cents <= ceiling.cents

    /**
     * A copy of this product with [unitPrice] replaced, leaving every
     * other field untouched. A real catalog-pricing job would use exactly
     * this to react to a supplier cost change, rather than reconstructing
     * the whole product by hand and risking a typo in an unrelated field.
     */
    fun withPrice(newPrice: Money): Product = copy(unitPrice = newPrice)

    /**
     * A copy of this product marked inactive, i.e. removed from sale while
     * remaining in the catalog for historical order lines to reference.
     * See [active] for why this is a soft flag rather than deletion.
     */
    fun discontinue(): Product = copy(active = false)

    /** Whether [name] contains [query], matched case-insensitively. Used by catalog search. */
    fun matchesName(query: String): Boolean = name.contains(query, ignoreCase = true)
}
