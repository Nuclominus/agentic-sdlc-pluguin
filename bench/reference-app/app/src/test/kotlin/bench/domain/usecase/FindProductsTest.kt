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
}
