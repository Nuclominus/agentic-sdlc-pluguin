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
}
