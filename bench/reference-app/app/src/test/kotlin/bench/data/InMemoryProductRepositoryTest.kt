package bench.data

import bench.domain.model.Money
import bench.domain.model.Product
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class InMemoryProductRepositoryTest {
    @Test
    fun `findById returns a seeded product`() {
        val repository = InMemoryProductRepository()

        val found = repository.findById("sku-1001")

        assertEquals("Wireless Mouse", found?.name)
    }

    @Test
    fun `findById returns null for an unknown id`() {
        val repository = InMemoryProductRepository()

        val found = repository.findById("sku-9999")

        assertNull(found)
    }

    @Test
    fun `findAll returns every seeded product`() {
        val repository = InMemoryProductRepository()

        val all = repository.findAll()

        assertTrue(all.size >= 16)
        assertTrue(all.any { it.id == "sku-1001" })
    }

    @Test
    fun `findAll reflects a custom seed instead of the default catalog`() {
        val custom = Product("sku-x", "Test Widget", Money.ofUnits(10L), active = true)
        val repository = InMemoryProductRepository(seed = listOf(custom))

        val all = repository.findAll()

        assertEquals(listOf(custom), all)
    }

    @Test
    fun `upsert inserts a new product`() {
        val repository = InMemoryProductRepository(seed = emptyList())
        val product = Product("sku-new", "Brand New Gadget", Money.ofUnits(15L), active = true)

        repository.upsert(product)

        assertEquals(product, repository.findById("sku-new"))
    }

    @Test
    fun `upsert replaces an existing product with the same id`() {
        val repository = InMemoryProductRepository()
        val replacement = Product("sku-1001", "Wireless Mouse Pro", Money.ofUnits(34L), active = true)

        repository.upsert(replacement)

        assertEquals("Wireless Mouse Pro", repository.findById("sku-1001")?.name)
    }

    @Test
    fun `upsert does not affect the count of unrelated products`() {
        val repository = InMemoryProductRepository()
        val before = repository.findAll().size

        repository.upsert(repository.findById("sku-1002")!!.copy(name = "Renamed Keyboard"))

        assertEquals(before, repository.findAll().size)
    }

    @Test
    fun `findActive excludes discontinued products`() {
        val repository = InMemoryProductRepository()

        val active = repository.findActive()

        assertTrue(active.all { it.active })
        assertTrue(active.none { it.id == "sku-1015" })
    }

    @Test
    fun `findActive returns fewer products than findAll when some are discontinued`() {
        val repository = InMemoryProductRepository()

        assertTrue(repository.findActive().size < repository.findAll().size)
    }

    @Test
    fun `remove drops the product and returns it`() {
        val repository = InMemoryProductRepository()

        val removed = repository.remove("sku-1001")

        assertEquals("Wireless Mouse", removed?.name)
        assertNull(repository.findById("sku-1001"))
    }

    @Test
    fun `remove returns null for a product that was never present`() {
        val repository = InMemoryProductRepository()

        assertNull(repository.remove("sku-never-existed"))
    }

    @Test
    fun `count reflects the number of products currently stored`() {
        val repository = InMemoryProductRepository(seed = emptyList())

        assertEquals(0, repository.count())

        repository.upsert(Product("sku-x", "X", Money.ofUnits(1L), active = true))

        assertEquals(1, repository.count())
    }
}
