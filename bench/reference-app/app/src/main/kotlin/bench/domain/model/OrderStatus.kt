package bench.domain.model

/**
 * The lifecycle state of an [Order].
 *
 * Orders move through these states roughly in declaration order, though not
 * every transition is linear: an order can be [CANCELLED] from most
 * non-terminal states, and only a [CANCELLED] or [DELIVERED] order can be
 * [ARCHIVED]. [canTransitionTo] encodes exactly which moves are legal so
 * that use cases do not each re-derive the state machine by hand.
 */
enum class OrderStatus {
    /** Order has been created but not yet confirmed against inventory. */
    PENDING,

    /** Inventory has been reserved and payment accepted. */
    CONFIRMED,

    /** Warehouse is picking and packing the order. */
    PROCESSING,

    /** Order has left the warehouse. */
    SHIPPED,

    /** Order has reached the customer. */
    DELIVERED,

    /** Order was called off before delivery, for any reason. */
    CANCELLED,

    /** Order is closed out and excluded from active-order reporting. */
    ARCHIVED;

    /**
     * Whether this status is a dead end: no further transitions are
     * possible once an order reaches it (other than the special case of
     * archiving, handled separately by [canTransitionTo]).
     */
    fun isTerminal(): Boolean = this == DELIVERED || this == CANCELLED || this == ARCHIVED

    /**
     * Whether an order in this status may legally move to [target].
     *
     * The rules:
     * - [ARCHIVED] and [CANCELLED] never transition anywhere.
     * - Any non-terminal status may move to [CANCELLED].
     * - [DELIVERED] or [CANCELLED] may move to [ARCHIVED].
     * - Otherwise, forward progress must follow the natural pipeline order
     *   ([PENDING] -> [CONFIRMED] -> [PROCESSING] -> [SHIPPED] -> [DELIVERED]).
     */
    fun canTransitionTo(target: OrderStatus): Boolean {
        if (this == ARCHIVED || this == CANCELLED) return false
        if (target == CANCELLED) return true
        if (target == ARCHIVED) return this == DELIVERED
        val pipeline = listOf(PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED)
        val fromIndex = pipeline.indexOf(this)
        val toIndex = pipeline.indexOf(target)
        return fromIndex >= 0 && toIndex == fromIndex + 1
    }

    /** Whether this order can still be reported on as "active" business. */
    fun isActive(): Boolean = !isTerminal()
}
