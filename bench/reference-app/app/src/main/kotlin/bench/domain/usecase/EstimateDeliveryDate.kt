package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.map
import bench.domain.model.ShippingMethod
import bench.domain.repository.OrderRepository
import java.time.DayOfWeek
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale

/**
 * Estimates when an order will reach the customer.
 *
 * The estimate combines a fixed warehouse processing time with the chosen
 * [ShippingMethod]'s transit time, then skips weekends on the transit leg
 * only: the warehouse itself does not ship on weekends, but a parcel
 * already in transit keeps moving regardless of the day of week.
 */
class EstimateDeliveryDate(
    private val orders: OrderRepository,
) {
    /**
     * @param orderId the order to estimate a delivery date for.
     * @param method the shipping speed the customer selected.
     * @param from the date to estimate from, defaulting to today. Exposed
     *   as a parameter (rather than always reading the system clock) so
     *   tests can pin it to a fixed date instead of depending on when they
     *   happen to run.
     * @return [Result.Success] with the estimated delivery date, or
     *   [Result.Failure] wrapping a [NotFoundError] if the order does not
     *   exist.
     */
    operator fun invoke(orderId: String, method: ShippingMethod, from: LocalDate = LocalDate.now()): Result<LocalDate> {
        orders.findById(orderId)
            ?: return Result.Failure(NotFoundError("No order with id $orderId", orderId))

        val dispatchDate = skipWeekend(from.plusDays(PROCESSING_DAYS.toLong()))
        var deliveryDate = dispatchDate
        repeat(method.transitDays) {
            deliveryDate = skipWeekend(deliveryDate.plusDays(1))
        }
        return Result.Success(deliveryDate)
    }

    /** Advances [date] past a Saturday or Sunday to the following Monday, otherwise returns it unchanged. */
    private fun skipWeekend(date: LocalDate): LocalDate = when (date.dayOfWeek) {
        DayOfWeek.SATURDAY -> date.plusDays(2)
        DayOfWeek.SUNDAY -> date.plusDays(1)
        else -> date
    }

    /**
     * The same estimate as [invoke], rendered as a customer-facing
     * sentence like "Estimated delivery: Tuesday, August 11, 2026" rather
     * than a bare [LocalDate] the caller would have to format itself.
     */
    fun describeEstimate(orderId: String, method: ShippingMethod, from: LocalDate = LocalDate.now()): Result<String> =
        invoke(orderId, method, from).map { date -> "Estimated delivery: ${FORMATTER.format(date)}" }

    companion object {
        /** Fixed warehouse pick-and-pack time, in business days, before a parcel is handed to the carrier. */
        private const val PROCESSING_DAYS = 1

        private val FORMATTER = DateTimeFormatter.ofLocalizedDate(FormatStyle.FULL).withLocale(Locale.US)
    }
}
