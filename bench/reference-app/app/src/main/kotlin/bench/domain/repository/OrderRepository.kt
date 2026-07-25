package bench.domain.repository

import bench.domain.model.Order
import bench.domain.model.OrderStatus

/**
 * Persistence for [Order] aggregates.
 *
 * There is deliberately no `delete`: orders are business records that must
 * remain queryable even after they are no longer active, which is exactly
 * what [ArchiveOrder][bench.domain.usecase.ArchiveOrder] is for instead of
 * removal.
 */
interface OrderRepository {
    /**
     * Persists [order], inserting it if its id is new or overwriting the
     * existing record with the same id. Returns the saved order unchanged,
     * so callers can chain the result without a redundant re-fetch.
     */
    fun save(order: Order): Order

    /** Returns the order with the given [id], or `null` if none exists. */
    fun findById(id: String): Order?

    /**
     * Returns every order placed by [customerId], in no particular
     * guaranteed order. Callers that need a specific ordering (e.g. most
     * recent first) should sort the result themselves.
     */
    fun findByCustomer(customerId: String): List<Order>

    /**
     * Returns every order currently in [status], across all customers.
     *
     * Useful for operational views that cut across customers rather than
     * within a single one, such as "all orders awaiting shipment" or "all
     * orders stuck in processing longer than expected."
     */
    fun findByStatus(status: OrderStatus): List<Order>
}
