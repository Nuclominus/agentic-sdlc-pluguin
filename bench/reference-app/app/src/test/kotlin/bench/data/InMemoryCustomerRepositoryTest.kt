package bench.data

import bench.data.seed.SeedCustomers
import bench.domain.model.LoyaltyTier
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class InMemoryCustomerRepositoryTest {
    @Test
    fun `findById returns a seeded customer`() {
        val repository = InMemoryCustomerRepository()

        val found = repository.findById("cus-1")

        assertEquals("Ava Thompson", found?.name)
    }

    @Test
    fun `findById returns null for an unknown id`() {
        val repository = InMemoryCustomerRepository()

        assertNull(repository.findById("cus-missing"))
    }

    @Test
    fun `findByEmail matches case-insensitively`() {
        val repository = InMemoryCustomerRepository()

        val found = repository.findByEmail("AVA.THOMPSON@EXAMPLE.COM")

        assertEquals("cus-1", found?.id)
    }

    @Test
    fun `findByEmail returns null when no account uses that address`() {
        val repository = InMemoryCustomerRepository()

        assertNull(repository.findByEmail("nobody@example.com"))
    }

    @Test
    fun `findAll returns every seeded customer`() {
        val repository = InMemoryCustomerRepository()

        val all = repository.findAll()

        assertTrue(all.size >= 8)
        assertTrue(all.any { it.id == "cus-4" })
    }

    @Test
    fun `save inserts a new customer`() {
        val repository = InMemoryCustomerRepository(seed = emptyList())
        val customer = SeedCustomers.customer("cus-1")

        repository.save(customer)

        assertEquals(customer, repository.findById("cus-1"))
    }

    @Test
    fun `save overwrites an existing customer's loyalty tier`() {
        val repository = InMemoryCustomerRepository()
        val promoted = repository.findById("cus-1")!!.copy(loyaltyTier = LoyaltyTier.PLATINUM)

        repository.save(promoted)

        assertEquals(LoyaltyTier.PLATINUM, repository.findById("cus-1")?.loyaltyTier)
    }
}
