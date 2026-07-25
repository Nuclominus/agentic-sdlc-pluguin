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

    @Test
    fun `initials takes the first letter of each word in the name`() {
        val sample = customer(LoyaltyTier.BRONZE).copy(name = "Ava Thompson")

        assertEquals("AT", sample.initials())
    }

    @Test
    fun `initials ignores extra whitespace between words`() {
        val sample = customer(LoyaltyTier.BRONZE).copy(name = "  Mia   Alvarez  ")

        assertEquals("MA", sample.initials())
    }

    @Test
    fun `movedTo updates both addresses by default`() {
        val sample = customer(LoyaltyTier.BRONZE)
        val newAddress = Address("9 New Street", "Chicago", "IL", "60601", "US")

        val moved = sample.movedTo(newAddress)

        assertEquals(newAddress, moved.shippingAddress)
        assertEquals(newAddress, moved.billingAddress)
    }

    @Test
    fun `movedTo can leave billing address untouched`() {
        val sample = customer(LoyaltyTier.BRONZE)
        val newAddress = Address("9 New Street", "Chicago", "IL", "60601", "US")

        val moved = sample.movedTo(newAddress, alsoUpdateBilling = false)

        assertEquals(newAddress, moved.shippingAddress)
        assertEquals(sample.billingAddress, moved.billingAddress)
    }

    @Test
    fun `hasEmail matches case-insensitively`() {
        val sample = customer(LoyaltyTier.BRONZE).copy(email = "test@example.com")

        assertTrue(sample.hasEmail("TEST@EXAMPLE.COM"))
        assertFalse(sample.hasEmail("other@example.com"))
    }
}

/**
 * Covers [LoyaltyTier] itself, kept alongside [CustomerTest] since every
 * scenario needs a tier to reason about a customer, and the two concerns
 * are small enough that splitting them into a further file would only add
 * indirection without adding clarity.
 */
class LoyaltyTierTest {
    @Test
    fun `discountFor applies zero discount at bronze`() {
        assertEquals(Money.ofUnits(100L), LoyaltyTier.BRONZE.discountFor(Money.ofUnits(100L)))
    }

    @Test
    fun `discountFor applies the full basis-point reduction at platinum`() {
        assertEquals(Money.ofUnits(90L), LoyaltyTier.PLATINUM.discountFor(Money.ofUnits(100L)))
    }

    @Test
    fun `isAtLeast compares tiers by program standing, not declaration order alone`() {
        assertTrue(LoyaltyTier.GOLD.isAtLeast(LoyaltyTier.SILVER))
        assertFalse(LoyaltyTier.SILVER.isAtLeast(LoyaltyTier.GOLD))
        assertTrue(LoyaltyTier.GOLD.isAtLeast(LoyaltyTier.GOLD))
    }

    @Test
    fun `nextTier steps up one tier at a time`() {
        assertEquals(LoyaltyTier.SILVER, LoyaltyTier.BRONZE.nextTier())
        assertEquals(LoyaltyTier.GOLD, LoyaltyTier.SILVER.nextTier())
        assertEquals(LoyaltyTier.PLATINUM, LoyaltyTier.GOLD.nextTier())
    }

    @Test
    fun `nextTier is null at the top of the ladder`() {
        assertEquals(null, LoyaltyTier.PLATINUM.nextTier())
    }

    @Test
    fun `spendToNextTier reports the remaining gap`() {
        val remaining = LoyaltyTier.BRONZE.spendToNextTier(Money.ofUnits(50L))

        assertEquals(Money.ofUnits(150L), remaining)
    }

    @Test
    fun `spendToNextTier floors at zero once the next tier is already met`() {
        val remaining = LoyaltyTier.BRONZE.spendToNextTier(Money.ofUnits(500L))

        assertEquals(Money.ZERO, remaining)
    }

    @Test
    fun `spendToNextTier is null at the top of the ladder`() {
        assertEquals(null, LoyaltyTier.PLATINUM.spendToNextTier(Money.ofUnits(999_999L)))
    }

    @Test
    fun `qualifying returns bronze below every threshold`() {
        assertEquals(LoyaltyTier.BRONZE, LoyaltyTier.qualifying(Money.ofUnits(50L)))
    }

    @Test
    fun `qualifying returns the exact tier at its threshold boundary`() {
        assertEquals(LoyaltyTier.SILVER, LoyaltyTier.qualifying(Money.ofUnits(200L)))
        assertEquals(LoyaltyTier.GOLD, LoyaltyTier.qualifying(Money.ofUnits(1_000L)))
    }

    @Test
    fun `qualifying returns platinum for spend well beyond its threshold`() {
        assertEquals(LoyaltyTier.PLATINUM, LoyaltyTier.qualifying(Money.ofUnits(50_000L)))
    }
}
