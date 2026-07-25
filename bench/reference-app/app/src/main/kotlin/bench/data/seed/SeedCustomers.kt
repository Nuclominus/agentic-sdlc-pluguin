package bench.data.seed

import bench.domain.model.Address
import bench.domain.model.Customer
import bench.domain.model.LoyaltyTier

/**
 * The starting customer directory used to seed
 * [InMemoryCustomerRepository][bench.data.InMemoryCustomerRepository].
 *
 * Customers are spread across every [LoyaltyTier] so that tier-dependent
 * behaviour (loyalty discounts, premium perks) has a realistic example to
 * exercise without any test having to construct its own customer from
 * scratch just to pick a tier.
 */
object SeedCustomers {
    val customers: List<Customer> = listOf(
        Customer(
            id = "cus-1",
            name = "Ava Thompson",
            email = "ava.thompson@example.com",
            shippingAddress = Address("12 Elm Street", "Portland", "OR", "97201", "US"),
            billingAddress = Address("12 Elm Street", "Portland", "OR", "97201", "US"),
            loyaltyTier = LoyaltyTier.BRONZE,
        ),
        Customer(
            id = "cus-2",
            name = "Noah Kim",
            email = "noah.kim@example.com",
            shippingAddress = Address("48 Maple Avenue", "Austin", "TX", "73301", "US"),
            billingAddress = Address("48 Maple Avenue", "Austin", "TX", "73301", "US"),
            loyaltyTier = LoyaltyTier.SILVER,
        ),
        Customer(
            id = "cus-3",
            name = "Mia Alvarez",
            email = "mia.alvarez@example.com",
            shippingAddress = Address("9 Birch Court", "Denver", "CO", "80202", "US"),
            billingAddress = Address("200 Corporate Plaza", "Denver", "CO", "80202", "US"),
            loyaltyTier = LoyaltyTier.GOLD,
        ),
        Customer(
            id = "cus-4",
            name = "Liam O'Brien",
            email = "liam.obrien@example.com",
            shippingAddress = Address("77 Harbour Road", "Dublin", null, "D02", "IE"),
            billingAddress = Address("77 Harbour Road", "Dublin", null, "D02", "IE"),
            loyaltyTier = LoyaltyTier.PLATINUM,
        ),
        Customer(
            id = "cus-5",
            name = "Sofia Rossi",
            email = "sofia.rossi@example.com",
            shippingAddress = Address("15 Via Roma", "Milan", null, "20121", "IT"),
            billingAddress = Address("15 Via Roma", "Milan", null, "20121", "IT"),
            loyaltyTier = LoyaltyTier.SILVER,
        ),
        Customer(
            id = "cus-6",
            name = "Ethan Walker",
            email = "ethan.walker@example.com",
            shippingAddress = Address("3 Willow Lane", "Seattle", "WA", "98101", "US"),
            billingAddress = Address("3 Willow Lane", "Seattle", "WA", "98101", "US"),
            loyaltyTier = LoyaltyTier.BRONZE,
        ),
        Customer(
            id = "cus-7",
            name = "Chloe Martin",
            email = "chloe.martin@example.com",
            shippingAddress = Address("22 Rue de Paris", "Lyon", null, "69001", "FR"),
            billingAddress = Address("22 Rue de Paris", "Lyon", null, "69001", "FR"),
            loyaltyTier = LoyaltyTier.GOLD,
        ),
        Customer(
            id = "cus-8",
            name = "Benjamin Foster",
            email = "benjamin.foster@example.com",
            shippingAddress = Address("5 King Street", "Toronto", "ON", "M5H", "CA"),
            billingAddress = Address("5 King Street", "Toronto", "ON", "M5H", "CA"),
            loyaltyTier = LoyaltyTier.BRONZE,
        ),
    )

    /** Convenience lookup for a seeded customer by id, mainly used from tests. */
    fun customer(id: String): Customer = customers.first { it.id == id }
}
