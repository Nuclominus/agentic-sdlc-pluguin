package bench.data

import bench.domain.model.Order
import bench.domain.model.OrderStatus
import bench.domain.repository.OrderRepository

/**
 * A map-backed [OrderRepository].
 *
 * Unlike the catalog and customer repositories, this one starts empty by
 * default: orders are created by the use cases under test, not shipped as
 * fixed seed data, since a fixed set of pre-existing orders would need to
 * be kept in sync with every test's expectations by hand.
 */
class InMemoryOrderRepository(
    seed: List<Order> = emptyList(),
) : OrderRepository {
    private val byId = LinkedHashMap<String, Order>().apply {
        seed.forEach { put(it.id, it) }
    }

    override fun save(order: Order): Order {
        byId[order.id] = order
        return order
    }

    override fun findById(id: String): Order? = byId[id]

    override fun findByCustomer(customerId: String): List<Order> =
        byId.values.filter { it.customerId == customerId }

    override fun findByStatus(status: OrderStatus): List<Order> =
        byId.values.filter { it.status == status }

    /** The number of orders currently stored, mainly useful for test assertions. */
    fun size(): Int = byId.size
}
