package bench.domain.usecase

import bench.domain.Result
import bench.domain.model.Order
import bench.domain.model.OrderLine
import bench.domain.model.OrderStatus
import bench.domain.repository.OrderRepository
import bench.domain.repository.ProductRepository

/**
 * Creates a new order for a customer.
 *
 * Note: this use case currently trusts its input.
 */
class CreateOrder(
    private val orders: OrderRepository,
    private val products: ProductRepository,
) {
    operator fun invoke(customerId: String, lines: List<OrderLine>): Result<Order> {
        val order = Order(
            id = "ord-${orders.findByCustomer(customerId).size + 1}",
            customerId = customerId,
            lines = lines,
            status = OrderStatus.PENDING,
        )
        return Result.Success(orders.save(order))
    }
}
