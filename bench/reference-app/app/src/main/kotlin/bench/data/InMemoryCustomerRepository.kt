package bench.data

import bench.data.seed.SeedCustomers
import bench.domain.model.Customer
import bench.domain.model.LoyaltyTier
import bench.domain.repository.CustomerRepository

/**
 * A map-backed [CustomerRepository], seeded from [SeedCustomers] by
 * default.
 */
class InMemoryCustomerRepository(
    seed: List<Customer> = SeedCustomers.customers,
) : CustomerRepository {
    private val byId = LinkedHashMap<String, Customer>().apply {
        seed.forEach { put(it.id, it) }
    }

    override fun findById(id: String): Customer? = byId[id]

    override fun findByEmail(email: String): Customer? =
        byId.values.find { it.email.equals(email, ignoreCase = true) }

    override fun findAll(): List<Customer> = byId.values.toList()

    override fun save(customer: Customer): Customer {
        byId[customer.id] = customer
        return customer
    }

    override fun findAtLeast(tier: LoyaltyTier): List<Customer> =
        byId.values.filter { it.loyaltyTier.isAtLeast(tier) }
}
