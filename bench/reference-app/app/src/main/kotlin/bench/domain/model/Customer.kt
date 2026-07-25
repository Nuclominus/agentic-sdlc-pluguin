package bench.domain.model

/**
 * A registered customer of the store.
 *
 * @property id a stable, opaque identifier, e.g. "cus-1042".
 * @property name the customer's full display name.
 * @property email the customer's contact email address.
 * @property shippingAddress the address used by default for deliveries.
 * @property billingAddress the address used for invoicing. Frequently equal
 *   to [shippingAddress], but kept separate because they can diverge (a
 *   gift order, a business billing to head office, and so on).
 * @property loyaltyTier the customer's current standing in the loyalty
 *   program, defaulting to [LoyaltyTier.BRONZE] for a brand-new account.
 */
data class Customer(
    val id: String,
    val name: String,
    val email: String,
    val shippingAddress: Address,
    val billingAddress: Address,
    val loyaltyTier: LoyaltyTier = LoyaltyTier.BRONZE,
) {
    /**
     * A short label suitable for a support ticket or an order confirmation
     * header, combining the customer's name and id.
     */
    fun displayLabel(): String = "$name ($id)"

    /**
     * Whether this customer has earned enough loyalty standing to receive
     * premium perks such as free returns or priority support.
     */
    fun isPremium(): Boolean = loyaltyTier.isAtLeast(LoyaltyTier.GOLD)

    /**
     * Whether the shipping and billing addresses are the same location.
     * Useful for checkout flows that offer a "same as shipping" shortcut.
     */
    fun hasUnifiedAddress(): Boolean = shippingAddress == billingAddress

    /**
     * Uppercase initials derived from [name], e.g. "Ava Thompson" -> "AT".
     * Used by avatar placeholders in place of a profile photo.
     */
    fun initials(): String = name
        .split(" ")
        .filter { it.isNotBlank() }
        .mapNotNull { it.firstOrNull()?.uppercaseChar() }
        .joinToString(separator = "")

    /**
     * A copy of this customer with [shippingAddress] set to [address] and,
     * when [alsoUpdateBilling] is `true` (the default), [billingAddress]
     * moved to match it too — the common "moved house" case where both
     * addresses should track together unless the customer says otherwise.
     */
    fun movedTo(address: Address, alsoUpdateBilling: Boolean = true): Customer =
        copy(
            shippingAddress = address,
            billingAddress = if (alsoUpdateBilling) address else billingAddress,
        )

    /** Whether [candidate] matches [email], compared case-insensitively. */
    fun hasEmail(candidate: String): Boolean = email.equals(candidate, ignoreCase = true)
}
