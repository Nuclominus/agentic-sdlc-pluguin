package bench.domain.usecase

import bench.data.InMemoryOrderRepository
import bench.data.InMemoryProductRepository
import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.Discount
import bench.domain.model.Money
import bench.domain.model.Order
import bench.domain.model.OrderLine
import bench.domain.model.OrderStatus
import bench.domain.model.PercentageDiscount
import bench.domain.model.Product
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class GetOrderReceiptTest {
    private val catalog = listOf(Product("sku-1001", "Wireless Mouse", Money.ofUnits(24L), active = true))

    private fun order(discount: Discount? = null) = Order(
        id = "ord-1",
        customerId = "cus-1",
        lines = listOf(OrderLine("sku-1001", 2, Money.ofUnits(24L))),
        status = OrderStatus.PENDING,
        appliedDiscount = discount,
    )

    @Test
    fun `includes the order id and customer id`() {
        val orders = InMemoryOrderRepository(seed = listOf(order()))
        val receipt = GetOrderReceipt(orders, InMemoryProductRepository(seed = catalog))

        val result = receipt("ord-1")

        assertIs<Result.Success<String>>(result)
        assertTrue(result.value.contains("ord-1"))
        assertTrue(result.value.contains("cus-1"))
    }

    @Test
    fun `renders the catalog name instead of the raw product id`() {
        val orders = InMemoryOrderRepository(seed = listOf(order()))
        val receipt = GetOrderReceipt(orders, InMemoryProductRepository(seed = catalog))

        val result = receipt("ord-1") as Result.Success<String>

        assertTrue(result.value.contains("Wireless Mouse"))
    }

    @Test
    fun `falls back to the raw product id when it is no longer in the catalog`() {
        val orders = InMemoryOrderRepository(seed = listOf(order()))
        val receipt = GetOrderReceipt(orders, InMemoryProductRepository(seed = emptyList()))

        val result = receipt("ord-1") as Result.Success<String>

        assertTrue(result.value.contains("sku-1001"))
    }

    @Test
    fun `shows the subtotal and total as dollars and cents`() {
        val orders = InMemoryOrderRepository(seed = listOf(order()))
        val receipt = GetOrderReceipt(orders, InMemoryProductRepository(seed = catalog))

        val result = receipt("ord-1") as Result.Success<String>

        assertTrue(result.value.contains("48.00"))
    }

    @Test
    fun `discloses an applied discount by its description`() {
        val orders = InMemoryOrderRepository(seed = listOf(order(discount = PercentageDiscount(1000))))
        val receipt = GetOrderReceipt(orders, InMemoryProductRepository(seed = catalog))

        val result = receipt("ord-1") as Result.Success<String>

        assertTrue(result.value.contains("10.0% off"))
    }

    @Test
    fun `omits the discount line entirely when no discount is applied`() {
        val orders = InMemoryOrderRepository(seed = listOf(order()))
        val receipt = GetOrderReceipt(orders, InMemoryProductRepository(seed = catalog))

        val result = receipt("ord-1") as Result.Success<String>

        assertTrue(!result.value.contains("Discount:"))
    }

    @Test
    fun `fails with NotFoundError for an unknown order id`() {
        val receipt = GetOrderReceipt(InMemoryOrderRepository(), InMemoryProductRepository())

        val result = receipt("ord-missing")

        assertIs<NotFoundError>((result as Result.Failure).error)
    }
}
