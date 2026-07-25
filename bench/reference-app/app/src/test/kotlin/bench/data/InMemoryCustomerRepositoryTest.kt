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

    @Test
    fun `findAtLeast includes customers above the given tier`() {
        val repository = InMemoryCustomerRepository(
            seed = listOf(
                SeedCustomers.customer("cus-1").copy(loyaltyTier = LoyaltyTier.PLATINUM),
                SeedCustomers.customer("cus-2").copy(id = "cus-2", loyaltyTier = LoyaltyTier.BRONZE),
            ),
        )

        val goldAndUp = repository.findAtLeast(LoyaltyTier.GOLD)

        assertEquals(listOf("cus-1"), goldAndUp.map { it.id })
    }

    @Test
    fun `findAtLeast includes customers exactly at the given tier`() {
        val repository = InMemoryCustomerRepository(
            seed = listOf(SeedCustomers.customer("cus-1").copy(loyaltyTier = LoyaltyTier.GOLD)),
        )

        assertEquals(1, repository.findAtLeast(LoyaltyTier.GOLD).size)
    }

    @Test
    fun `findAtLeast is empty when nobody qualifies`() {
        val repository = InMemoryCustomerRepository(
            seed = listOf(SeedCustomers.customer("cus-1").copy(loyaltyTier = LoyaltyTier.BRONZE)),
        )

        assertTrue(repository.findAtLeast(LoyaltyTier.PLATINUM).isEmpty())
    }
}
