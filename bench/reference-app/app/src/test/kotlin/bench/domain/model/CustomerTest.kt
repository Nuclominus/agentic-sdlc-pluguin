package bench.domain.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CustomerTest {
    private fun customer(tier: LoyaltyTier, shipping: Address = Address.unspecified(), billing: Address = shipping) =
        Customer(
            id = "cus-1",
            name = "Test Customer",
            email = "test@example.com",
            shippingAddress = shipping,
            billingAddress = billing,
            loyaltyTier = tier,
        )

    @Test
    fun `displayLabel combines name and id`() {
        val sample = customer(LoyaltyTier.BRONZE)

        assertEquals("Test Customer (cus-1)", sample.displayLabel())
    }

    @Test
    fun `isPremium is true for gold and above`() {
        assertTrue(customer(LoyaltyTier.GOLD).isPremium())
        assertTrue(customer(LoyaltyTier.PLATINUM).isPremium())
    }

    @Test
    fun `isPremium is false below gold`() {
        assertFalse(customer(LoyaltyTier.BRONZE).isPremium())
        assertFalse(customer(LoyaltyTier.SILVER).isPremium())
    }

    @Test
    fun `hasUnifiedAddress is true when shipping and billing match`() {
        val address = Address.unspecified()

        val sample = customer(LoyaltyTier.BRONZE, shipping = address, billing = address)

        assertTrue(sample.hasUnifiedAddress())
    }

    @Test
    fun `hasUnifiedAddress is false when shipping and billing differ`() {
        val shipping = Address.unspecified()
        val billing = shipping.copy(city = "Other City")

        val sample = customer(LoyaltyTier.BRONZE, shipping = shipping, billing = billing)

        assertFalse(sample.hasUnifiedAddress())
    }
}
