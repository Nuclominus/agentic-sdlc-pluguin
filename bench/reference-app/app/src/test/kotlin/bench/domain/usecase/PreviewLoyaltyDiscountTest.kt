package bench.domain.usecase

import bench.data.InMemoryCustomerRepository
import bench.data.seed.SeedCustomers
import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.LoyaltyTier
import bench.domain.model.Money
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class PreviewLoyaltyDiscountTest {
    private fun customerAt(tier: LoyaltyTier) = SeedCustomers.customer("cus-1").copy(loyaltyTier = tier)

    @Test
    fun `bronze customers see no discount`() {
        val customers = InMemoryCustomerRepository(seed = listOf(customerAt(LoyaltyTier.BRONZE)))
        val preview = PreviewLoyaltyDiscount(customers)

        val result = preview("cus-1", Money.ofUnits(100L))

        assertIs<Result.Success<LoyaltyDiscountPreview>>(result)
        assertEquals(Money.ZERO, result.value.savings)
        assertEquals(Money.ofUnits(100L), result.value.discountedTotal)
    }

    @Test
    fun `gold customers see a five percent discount`() {
        val customers = InMemoryCustomerRepository(seed = listOf(customerAt(LoyaltyTier.GOLD)))
        val preview = PreviewLoyaltyDiscount(customers)

        val result = preview("cus-1", Money.ofUnits(200L))

        assertIs<Result.Success<LoyaltyDiscountPreview>>(result)
        assertEquals(Money.ofUnits(10L), result.value.savings)
        assertEquals(Money.ofUnits(190L), result.value.discountedTotal)
    }

    @Test
    fun `platinum customers see the largest discount`() {
        val customers = InMemoryCustomerRepository(seed = listOf(customerAt(LoyaltyTier.PLATINUM)))
        val preview = PreviewLoyaltyDiscount(customers)

        val result = preview("cus-1", Money.ofUnits(100L))

        assertIs<Result.Success<LoyaltyDiscountPreview>>(result)
        assertEquals(Money.ofUnits(10L), result.value.savings)
    }

    @Test
    fun `preserves the original subtotal in the preview`() {
        val customers = InMemoryCustomerRepository(seed = listOf(customerAt(LoyaltyTier.SILVER)))
        val preview = PreviewLoyaltyDiscount(customers)

        val result = preview("cus-1", Money.ofUnits(80L)) as Result.Success<LoyaltyDiscountPreview>

        assertEquals(Money.ofUnits(80L), result.value.subtotal)
    }

    @Test
    fun `fails with NotFoundError for an unknown customer`() {
        val preview = PreviewLoyaltyDiscount(InMemoryCustomerRepository())

        val result = preview("cus-unknown", Money.ofUnits(50L))

        assertIs<NotFoundError>((result as Result.Failure).error)
    }

    @Test
    fun `savingsRatio expresses savings as a fraction of the subtotal`() {
        val customers = InMemoryCustomerRepository(seed = listOf(customerAt(LoyaltyTier.GOLD)))
        val preview = PreviewLoyaltyDiscount(customers)

        val result = preview("cus-1", Money.ofUnits(200L)) as Result.Success<LoyaltyDiscountPreview>

        assertEquals(0.05, result.value.savingsRatio())
    }

    @Test
    fun `savingsRatio is zero for a zero subtotal`() {
        val customers = InMemoryCustomerRepository(seed = listOf(customerAt(LoyaltyTier.PLATINUM)))
        val preview = PreviewLoyaltyDiscount(customers)

        val result = preview("cus-1", Money.ZERO) as Result.Success<LoyaltyDiscountPreview>

        assertEquals(0.0, result.value.savingsRatio())
    }

    @Test
    fun `nextTierAdditionalSavings shows the extra savings one tier up`() {
        val customers = InMemoryCustomerRepository(seed = listOf(customerAt(LoyaltyTier.SILVER)))
        val preview = PreviewLoyaltyDiscount(customers)

        val result = preview.nextTierAdditionalSavings("cus-1", Money.ofUnits(100L))

        assertIs<Result.Success<Money>>(result)
        assertEquals(Money(250L), result.value)
    }

    @Test
    fun `nextTierAdditionalSavings is zero at the top tier`() {
        val customers = InMemoryCustomerRepository(seed = listOf(customerAt(LoyaltyTier.PLATINUM)))
        val preview = PreviewLoyaltyDiscount(customers)

        val result = preview.nextTierAdditionalSavings("cus-1", Money.ofUnits(100L))

        assertIs<Result.Success<Money>>(result)
        assertEquals(Money.ZERO, result.value)
    }

    @Test
    fun `nextTierAdditionalSavings fails with NotFoundError for an unknown customer`() {
        val preview = PreviewLoyaltyDiscount(InMemoryCustomerRepository())

        val result = preview.nextTierAdditionalSavings("cus-unknown", Money.ofUnits(50L))

        assertIs<NotFoundError>((result as Result.Failure).error)
    }
}
