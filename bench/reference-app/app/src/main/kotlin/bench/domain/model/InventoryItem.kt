package bench.domain.model

/**
 * The warehouse stock record for a single product.
 *
 * Stock is tracked as two separate counters — [quantityOnHand] (physically
 * present) and [quantityReserved] (already promised to pending orders) —
 * rather than a single "available" number, so that reservation and release
 * operations can be simple increments/decrements instead of read-modify-write
 * arithmetic on a derived value.
 *
 * @property productId the id of the [Product] this record tracks.
 * @property quantityOnHand the number of physical units in the warehouse.
 * @property quantityReserved the number of units already allocated to
 *   confirmed or in-flight orders.
 * @property reorderThreshold the [availableQuantity] level at or below which
 *   the item should be flagged for restocking.
 */
data class InventoryItem(
    val productId: String,
    val quantityOnHand: Int,
    val quantityReserved: Int,
    val reorderThreshold: Int,
) {
    /** The stock actually free to promise to a new order. */
    val availableQuantity: Int get() = quantityOnHand - quantityReserved

    /** Whether [availableQuantity] has fallen to or below [reorderThreshold]. */
    fun needsReorder(): Boolean = availableQuantity <= reorderThreshold

    /** Whether at least [quantity] units are free to reserve right now. */
    fun canReserve(quantity: Int): Boolean = availableQuantity >= quantity

    /** A copy with [quantity] more units reserved, leaving [quantityOnHand] unchanged. */
    fun withReserved(quantity: Int): InventoryItem = copy(quantityReserved = quantityReserved + quantity)

    /**
     * A copy with [quantity] fewer units reserved, floored at zero so a
     * mismatched release can never push the counter negative.
     */
    fun withReleased(quantity: Int): InventoryItem {
        val next = quantityReserved - quantity
        return copy(quantityReserved = if (next < 0) 0 else next)
    }

    /**
     * What fraction of [reorderThreshold] the current [availableQuantity]
     * represents, as a percentage from 0 upward. A dashboard can use this
     * to render a stock-health bar without re-deriving the ratio itself.
     *
     * Returns 100.0 when [reorderThreshold] is zero and stock is
     * available, since "no threshold configured" should read as healthy
     * rather than dividing by zero.
     */
    fun healthPercent(): Double {
        if (reorderThreshold == 0) return if (availableQuantity > 0) 100.0 else 0.0
        return (availableQuantity.toDouble() / reorderThreshold.toDouble()) * 100.0
    }

    /**
     * How many additional units would need to arrive for
     * [availableQuantity] to clear [reorderThreshold] by one unit, or zero
     * if it already has. Used by [RestockInventory][bench.domain.usecase.RestockInventory]'s
     * bulk restocking path to decide how much to order.
     */
    fun shortfallToClearThreshold(): Int {
        val shortfall = (reorderThreshold + 1) - availableQuantity
        return if (shortfall < 0) 0 else shortfall
    }

    /** Whether this record currently tracks any stock at all, on hand or reserved. */
    fun isEmpty(): Boolean = quantityOnHand == 0 && quantityReserved == 0
}
