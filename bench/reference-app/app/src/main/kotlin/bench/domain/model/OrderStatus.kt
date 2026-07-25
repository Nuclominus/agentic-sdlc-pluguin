package bench.domain.model

/**
 * The lifecycle state of an [Order].
 *
 * Orders move through these states roughly in declaration order, though not
 * every transition is linear: an order can move to [CANCELLED] from most
 * non-terminal states, and a [CANCELLED] or [DELIVERED] order can move to
 * [ARCHIVED] but nowhere else. [canTransitionTo] encodes exactly which moves
 * are legal so that use cases do not each re-derive the state machine by
 * hand.
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
     * The rules, checked in order:
     * - [ARCHIVED] never transitions anywhere, including to itself.
     * - [DELIVERED] and [CANCELLED] may only move to [ARCHIVED]; no other
     *   transition is legal once an order reaches either of them.
     * - Any other status may move to [CANCELLED].
     * - Otherwise, forward progress must follow the natural pipeline order
     *   ([PENDING] -> [CONFIRMED] -> [PROCESSING] -> [SHIPPED] -> [DELIVERED]).
     */
    fun canTransitionTo(target: OrderStatus): Boolean {
        if (this == ARCHIVED) return false
        if (target == ARCHIVED) return this == DELIVERED || this == CANCELLED
        if (isTerminal()) return false
        if (target == CANCELLED) return true
        val pipeline = listOf(PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED)
        val fromIndex = pipeline.indexOf(this)
        val toIndex = pipeline.indexOf(target)
        return fromIndex >= 0 && toIndex == fromIndex + 1
    }

    /** Whether this order can still be reported on as "active" business. */
    fun isActive(): Boolean = !isTerminal()

    /**
     * A customer-facing label for this status, e.g. [PROCESSING] renders
     * as "Being prepared" rather than the raw enum name. Kept as a `when`
     * over the fixed set of statuses (no `else`) so that adding a new
     * status without updating this method is a compile error, not a
     * silent fallback to a generic label.
     */
    fun customerFacingLabel(): String = when (this) {
        PENDING -> "Order received"
        CONFIRMED -> "Payment confirmed"
        PROCESSING -> "Being prepared"
        SHIPPED -> "On its way"
        DELIVERED -> "Delivered"
        CANCELLED -> "Cancelled"
        ARCHIVED -> "Closed"
    }

    /**
     * How many steps of the [PENDING]-to-[DELIVERED] pipeline remain, or
     * `null` for a status not on that pipeline at all ([CANCELLED] or
     * [ARCHIVED]) — there is no meaningful "steps remaining" for an order
     * that will never reach [DELIVERED] through the normal flow.
     */
    fun stepsUntilDelivered(): Int? {
        val pipeline = listOf(PENDING, CONFIRMED, PROCESSING, SHIPPED, DELIVERED)
        val index = pipeline.indexOf(this)
        return if (index < 0) null else pipeline.lastIndex - index
    }
}
