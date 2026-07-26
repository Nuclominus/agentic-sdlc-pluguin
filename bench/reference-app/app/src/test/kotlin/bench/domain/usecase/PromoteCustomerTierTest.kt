package bench.domain.usecase

import bench.data.InMemoryCustomerRepository
import bench.data.InMemoryOrderRepository
import bench.data.seed.SeedCustomers
import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.Customer
import bench.domain.model.LoyaltyTier
import bench.domain.model.Money
import bench.domain.model.Order
import bench.domain.model.OrderLine
import bench.domain.model.OrderStatus
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class PromoteCustomerTierTest {
    private fun bronzeCustomer(id: String = "cus-1") =
        SeedCustomers.customer("cus-1").copy(id = id, loyaltyTier = LoyaltyTier.BRONZE)

    private fun deliveredOrderWorth(id: String, customerId: String, cents: Long) = Order(
        id = id,
        customerId = customerId,
        lines = listOf(OrderLine("sku-1001", 1, Money(cents))),
        status = OrderStatus.DELIVERED,
    )

    @Test
    fun `promotes a customer whose lifetime spend crosses the silver threshold`() {
        val customers = InMemoryCustomerRepository(seed = listOf(bronzeCustomer()))
        val orders = InMemoryOrderRepository(
            seed = listOf(deliveredOrderWorth("ord-1", "cus-1", Money.ofUnits(250L).cents)),
        )
        val promote = PromoteCustomerTier(customers, orders)

        val result = promote("cus-1")

        assertIs<Result.Success<Customer>>(result)
        assertEquals(LoyaltyTier.SILVER, result.value.loyaltyTier)
    }

    @Test
    fun `promotes all the way to platinum when spend clears every threshold`() {
        val customers = InMemoryCustomerRepository(seed = listOf(bronzeCustomer()))
        val orders = InMemoryOrderRepository(
            seed = listOf(deliveredOrderWorth("ord-1", "cus-1", Money.ofUnits(6_000L).cents)),
        )
        val promote = PromoteCustomerTier(customers, orders)

        val result = promote("cus-1")

        assertIs<Result.Success<Customer>>(result)
        assertEquals(LoyaltyTier.PLATINUM, result.value.loyaltyTier)
    }

    @Test
    fun `leaves the tier unchanged when spend does not clear the next threshold`() {
        val customers = InMemoryCustomerRepository(seed = listOf(bronzeCustomer()))
        val orders = InMemoryOrderRepository(
            seed = listOf(deliveredOrderWorth("ord-1", "cus-1", Money.ofUnits(50L).cents)),
        )
        val promote = PromoteCustomerTier(customers, orders)

        val result = promote("cus-1")

        assertIs<Result.Success<Customer>>(result)
        assertEquals(LoyaltyTier.BRONZE, result.value.loyaltyTier)
    }

    @Test
    fun `never demotes a customer even if their eligible tier is lower`() {
        val customers = InMemoryCustomerRepository(
            seed = listOf(bronzeCustomer().copy(loyaltyTier = LoyaltyTier.PLATINUM)),
        )
        val orders = InMemoryOrderRepository(
            seed = listOf(deliveredOrderWorth("ord-1", "cus-1", Money.ofUnits(1L).cents)),
        )
        val promote = PromoteCustomerTier(customers, orders)

        val result = promote("cus-1")

        assertIs<Result.Success<Customer>>(result)
        assertEquals(LoyaltyTier.PLATINUM, result.value.loyaltyTier)
    }

    @Test
    fun `persists the promotion to the repository`() {
        val customers = InMemoryCustomerRepository(seed = listOf(bronzeCustomer()))
        val orders = InMemoryOrderRepository(
            seed = listOf(deliveredOrderWorth("ord-1", "cus-1", Money.ofUnits(1_500L).cents)),
        )
        val promote = PromoteCustomerTier(customers, orders)

        promote("cus-1")

        assertEquals(LoyaltyTier.GOLD, customers.findById("cus-1")?.loyaltyTier)
    }

    @Test
    fun `fails with NotFoundError for an unknown customer`() {
        val promote = PromoteCustomerTier(InMemoryCustomerRepository(), InMemoryOrderRepository())

        val result = promote("cus-unknown")

        assertIs<NotFoundError>((result as Result.Failure).error)
    }

    @Test
    fun `ignores cancelled orders when computing eligibility`() {
        val customers = InMemoryCustomerRepository(seed = listOf(bronzeCustomer()))
        val orders = InMemoryOrderRepository(
            seed = listOf(
                deliveredOrderWorth("ord-1", "cus-1", Money.ofUnits(5_000L).cents).withStatus(OrderStatus.CANCELLED),
            ),
        )
        val promote = PromoteCustomerTier(customers, orders)

        val result = promote("cus-1")

        assertIs<Result.Success<Customer>>(result)
        assertEquals(LoyaltyTier.BRONZE, result.value.loyaltyTier)
    }

    @Test
    fun `sums spend across multiple orders to decide eligibility`() {
        val customers = InMemoryCustomerRepository(seed = listOf(bronzeCustomer()))
        val orders = InMemoryOrderRepository(
            seed = listOf(
                deliveredOrderWorth("ord-1", "cus-1", Money.ofUnits(150L).cents),
                deliveredOrderWorth("ord-2", "cus-1", Money.ofUnits(100L).cents),
            ),
        )
        val promote = PromoteCustomerTier(customers, orders)

        val result = promote("cus-1")

        assertIs<Result.Success<Customer>>(result)
        assertEquals(LoyaltyTier.SILVER, result.value.loyaltyTier)
    }

    @Test
    fun `does not persist anything when the tier is unchanged`() {
        val customers = InMemoryCustomerRepository(seed = listOf(bronzeCustomer()))
        val orders = InMemoryOrderRepository(
            seed = listOf(deliveredOrderWorth("ord-1", "cus-1", Money.ofUnits(10L).cents)),
        )
        val promote = PromoteCustomerTier(customers, orders)

        promote("cus-1")

        assertEquals(LoyaltyTier.BRONZE, customers.findById("cus-1")?.loyaltyTier)
    }

    @Test
    fun `a customer with no orders at all is never promoted`() {
        val customers = InMemoryCustomerRepository(seed = listOf(bronzeCustomer()))
        val promote = PromoteCustomerTier(customers, InMemoryOrderRepository())

        val result = promote("cus-1") as Result.Success<Customer>

        assertEquals(LoyaltyTier.BRONZE, result.value.loyaltyTier)
    }

    @Test
    fun `previewEligibleTier reports the tier without persisting anything`() {
        val customers = InMemoryCustomerRepository(seed = listOf(bronzeCustomer()))
        val orders = InMemoryOrderRepository(
            seed = listOf(deliveredOrderWorth("ord-1", "cus-1", Money.ofUnits(1_500L).cents)),
        )
        val promote = PromoteCustomerTier(customers, orders)

        val result = promote.previewEligibleTier("cus-1")

        assertIs<Result.Success<LoyaltyTier>>(result)
        assertEquals(LoyaltyTier.GOLD, result.value)
        assertEquals(LoyaltyTier.BRONZE, customers.findById("cus-1")?.loyaltyTier)
    }

    @Test
    fun `previewEligibleTier never previews a demotion`() {
        val customers = InMemoryCustomerRepository(
            seed = listOf(bronzeCustomer().copy(loyaltyTier = LoyaltyTier.PLATINUM)),
        )
        val orders = InMemoryOrderRepository(
            seed = listOf(deliveredOrderWorth("ord-1", "cus-1", Money.ofUnits(1L).cents)),
        )
        val promote = PromoteCustomerTier(customers, orders)

        val result = promote.previewEligibleTier("cus-1")

        assertIs<Result.Success<LoyaltyTier>>(result)
        assertEquals(LoyaltyTier.PLATINUM, result.value)
    }

    @Test
    fun `previewEligibleTier fails with NotFoundError for an unknown customer`() {
        val promote = PromoteCustomerTier(InMemoryCustomerRepository(), InMemoryOrderRepository())

        val result = promote.previewEligibleTier("cus-unknown")

        assertIs<NotFoundError>((result as Result.Failure).error)
    }
}
