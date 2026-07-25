package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.Address
import bench.domain.model.FreeShippingDiscount
import bench.domain.model.Money
import bench.domain.model.Order
import bench.domain.model.ShippingMethod
import bench.domain.repository.OrderRepository

/**
 * Quotes the shipping cost for an existing order.
 *
 * The quote combines three factors: the chosen [ShippingMethod]'s flat
 * base cost, a surcharge for international destinations (since cross-border
 * parcels cost the store more to route), and a free-shipping waiver for
 * orders that either clear a spend threshold or already carry a
 * [FreeShippingDiscount].
 */
class CalculateShipping(
    private val orders: OrderRepository,
) {
    /**
     * @param orderId the order to quote shipping for.
     * @param method the shipping speed the customer selected.
     * @param destination where the order will be shipped.
     * @param homeCountry the store's country of operation, used to detect
     *   an international surcharge.
     * @return [Result.Success] with the quoted cost, or [Result.Failure]
     *   wrapping a [NotFoundError] if the order does not exist.
     */
    operator fun invoke(
        orderId: String,
        method: ShippingMethod,
        destination: Address,
        homeCountry: String = "US",
    ): Result<Money> {
        val order = orders.findById(orderId)
            ?: return Result.Failure(NotFoundError("No order with id $orderId", orderId))

        if (qualifiesForFreeShipping(order)) {
            return Result.Success(Money.ZERO)
        }

        val internationalSurcharge = if (!destination.isDomesticTo(homeCountry)) {
            INTERNATIONAL_SURCHARGE
        } else {
            Money.ZERO
        }

        return Result.Success(method.baseCost + internationalSurcharge)
    }

    /**
     * An order qualifies for free shipping if it carries a
     * [FreeShippingDiscount], or if its pre-discount total meets or exceeds
     * [FREE_SHIPPING_THRESHOLD].
     */
    private fun qualifiesForFreeShipping(order: Order): Boolean =
        order.appliedDiscount == FreeShippingDiscount || order.total.cents >= FREE_SHIPPING_THRESHOLD.cents

    companion object {
        private val FREE_SHIPPING_THRESHOLD = Money.ofUnits(75L)
        private val INTERNATIONAL_SURCHARGE = Money.ofUnits(15L)
    }
}
