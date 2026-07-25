package bench.domain.usecase

import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.Order
import bench.domain.model.OrderLine
import bench.domain.repository.OrderRepository
import bench.domain.repository.ProductRepository

/**
 * Renders a plain-text receipt for an existing order.
 *
 * The receipt is intentionally plain text rather than, say, HTML or a
 * structured DTO: this specimen has no presentation layer, and a printable
 * string is the simplest artifact that still exercises real formatting
 * logic (line lookups, currency rendering, discount disclosure) rather than
 * a placeholder.
 */
class GetOrderReceipt(
    private val orders: OrderRepository,
    private val products: ProductRepository,
) {
    /**
     * @return [Result.Success] with the rendered receipt text, or
     *   [Result.Failure] wrapping a [NotFoundError] if the order does not
     *   exist.
     */
    operator fun invoke(orderId: String): Result<String> {
        val order = orders.findById(orderId)
            ?: return Result.Failure(NotFoundError("No order with id $orderId", orderId))

        val builder = StringBuilder()
        builder.appendLine("Receipt for order ${order.id}")
        builder.appendLine("Customer: ${order.customerId}")
        builder.appendLine("Status: ${order.status.customerFacingLabel()}")
        builder.appendLine("Items: ${order.totalUnitCount()}")
        builder.appendLine("-".repeat(40))

        for (line in order.lines) {
            builder.appendLine(renderLine(line))
        }

        builder.appendLine("-".repeat(40))
        builder.appendLine("Subtotal: ${format(order.total.cents)}")

        val discount = order.appliedDiscount
        if (discount != null) {
            builder.appendLine("Discount: ${discount.describe()}")
        }

        builder.appendLine("Total: ${format(order.discountedTotal.cents)}")
        return Result.Success(builder.toString())
    }

    /**
     * Renders one order line, preferring the current catalog name for
     * [OrderLine.productId] when it is still known, and falling back to
     * the raw id for a product that has since been removed entirely from
     * the catalog (as opposed to merely deactivated).
     */
    private fun renderLine(line: OrderLine): String {
        val label = products.findById(line.productId)?.name ?: line.productId
        return "  ${line.quantity} x $label @ ${format(line.unitPrice.cents)} = ${format(line.subtotal.cents)}"
    }

    /** Renders a cents amount as a dollars-and-cents string, e.g. 4500 -> "45.00". */
    private fun format(cents: Long): String {
        val dollars = cents / 100
        val remainder = (cents % 100).toString().padStart(2, '0')
        return "$dollars.$remainder"
    }

    /**
     * Renders receipts for every order [customerId] has placed, joined by
     * a blank line — useful for an "email me all my receipts" support
     * request without the caller having to loop over [invoke] itself.
     *
     * Any order id that fails to render (which should not normally happen
     * for an id sourced from the customer's own order history) is simply
     * skipped rather than aborting the whole batch, since one bad receipt
     * should not deny the customer every other one.
     */
    fun renderAll(orderIds: List<String>): String =
        orderIds.mapNotNull { (invoke(it) as? Result.Success)?.value }.joinToString(separator = "\n")
}
