package bench.domain.model

/**
 * A shipping speed a customer can choose at checkout. Each method carries a
 * flat base cost and a typical transit time; [CalculateShipping][bench.domain.usecase.CalculateShipping]
 * combines these with order-specific factors such as free-shipping
 * thresholds.
 *
 * @property baseCost the flat cost charged before any discounts.
 * @property transitDays the typical number of days from dispatch to delivery.
 */
enum class ShippingMethod(val baseCost: Money, val transitDays: Int) {
    /** Ground shipping; the default choice at checkout. */
    STANDARD(Money.ofUnits(5L), 5),

    /** Faster ground or regional air shipping. */
    EXPRESS(Money.ofUnits(12L), 2),

    /** Next-business-day delivery. */
    OVERNIGHT(Money.ofUnits(25L), 1);

    /**
     * The estimated delivery day count starting from a warehouse that needs
     * [processingDays] to pick and pack the order, on top of [transitDays].
     */
    fun estimatedDeliveryDays(processingDays: Int): Int = processingDays + transitDays

    /** Whether this method is fast enough to be marketed as "express" or better. */
    fun isExpedited(): Boolean = this != STANDARD
}
