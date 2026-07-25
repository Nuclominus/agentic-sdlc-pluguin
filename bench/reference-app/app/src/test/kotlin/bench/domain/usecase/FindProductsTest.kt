package bench.domain.usecase

import bench.data.InMemoryProductRepository
import bench.domain.Result
import bench.domain.model.Money
import bench.domain.model.Product
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class FindProductsTest {
    private val catalog = listOf(
        Product("sku-1", "Wireless Mouse", Money.ofUnits(24L), active = true),
        Product("sku-2", "Wired Mouse", Money.ofUnits(12L), active = true),
        Product("sku-3", "Mechanical Keyboard", Money.ofUnits(89L), active = true),
        Product("sku-4", "Old Mouse Pad", Money.ofUnits(9L), active = false),
    )

    @Test
    fun `with no arguments returns every active product sorted by name`() {
        val findProducts = FindProducts(InMemoryProductRepository(seed = catalog))

        val result = findProducts()

        assertIs<Result.Success<List<Product>>>(result)
        assertEquals(listOf("Mechanical Keyboard", "Wired Mouse", "Wireless Mouse"), result.value.map { it.name })
    }

    @Test
    fun `excludes inactive products by default`() {
        val findProducts = FindProducts(InMemoryProductRepository(seed = catalog))

        val result = findProducts()

        assertIs<Result.Success<List<Product>>>(result)
        assertTrue(result.value.none { !it.active })
    }

    @Test
    fun `includes inactive products when explicitly requested`() {
        val findProducts = FindProducts(InMemoryProductRepository(seed = catalog))

        val result = findProducts(onlyActive = false)

        assertIs<Result.Success<List<Product>>>(result)
        assertTrue(result.value.any { it.id == "sku-4" })
    }

    @Test
    fun `matches the query case-insensitively against the name`() {
        val findProducts = FindProducts(InMemoryProductRepository(seed = catalog))

        val result = findProducts(query = "mouse")

        assertIs<Result.Success<List<Product>>>(result)
        assertEquals(setOf("sku-1", "sku-2"), result.value.map { it.id }.toSet())
    }

    @Test
    fun `filters by a maximum price`() {
        val findProducts = FindProducts(InMemoryProductRepository(seed = catalog))

        val result = findProducts(maxPrice = Money.ofUnits(20L))

        assertIs<Result.Success<List<Product>>>(result)
        assertEquals(listOf("sku-2"), result.value.map { it.id })
    }

    @Test
    fun `returns an empty list when nothing matches`() {
        val findProducts = FindProducts(InMemoryProductRepository(seed = catalog))

        val result = findProducts(query = "nonexistent widget")

        assertIs<Result.Success<List<Product>>>(result)
        assertTrue(result.value.isEmpty())
    }

    @Test
    fun `combines query and price filters`() {
        val findProducts = FindProducts(InMemoryProductRepository(seed = catalog))

        val result = findProducts(query = "mouse", maxPrice = Money.ofUnits(15L))

        assertIs<Result.Success<List<Product>>>(result)
        assertEquals(listOf("sku-2"), result.value.map { it.id })
    }

    @Test
    fun `withPrice replaces only the unit price`() {
        val original = catalog[0]

        val repriced = original.withPrice(Money.ofUnits(30L))

        assertEquals(Money.ofUnits(30L), repriced.unitPrice)
        assertEquals(original.name, repriced.name)
        assertEquals(original.id, repriced.id)
    }

    @Test
    fun `discontinue marks a product inactive without changing anything else`() {
        val original = catalog[0]

        val discontinued = original.discontinue()

        assertEquals(false, discontinued.active)
        assertEquals(original.unitPrice, discontinued.unitPrice)
    }

    @Test
    fun `matchesName is case-insensitive`() {
        assertTrue(catalog[0].matchesName("WIRELESS"))
        assertTrue(catalog[0].matchesName("mouse"))
    }

    @Test
    fun `matchesName is false when the query is not part of the name`() {
        assertTrue(!catalog[0].matchesName("keyboard"))
    }

    @Test
    fun `catalogLabel flags a discontinued product`() {
        assertEquals("Old Mouse Pad (discontinued)", catalog[3].catalogLabel())
    }

    @Test
    fun `catalogLabel is the plain name for an active product`() {
        assertEquals("Wireless Mouse", catalog[0].catalogLabel())
    }

    @Test
    fun `subtotalFor multiplies unit price by quantity`() {
        assertEquals(Money.ofUnits(48L), catalog[0].subtotalFor(2))
    }
}
