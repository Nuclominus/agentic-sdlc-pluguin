package bench.domain.usecase

import bench.data.InMemoryInventoryRepository
import bench.data.InMemoryProductRepository
import bench.domain.Result
import bench.domain.model.InventoryItem
import bench.domain.model.Money
import bench.domain.model.Product
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class ListLowStockProductsTest {
    private val catalog = listOf(
        Product("sku-a", "Widget A", Money.ofUnits(10L), active = true),
        Product("sku-b", "Widget B", Money.ofUnits(20L), active = true),
        Product("sku-c", "Widget C", Money.ofUnits(30L), active = true),
    )

    @Test
    fun `includes only products flagged for reorder`() {
        val inventory = InMemoryInventoryRepository(
            seed = listOf(
                InventoryItem("sku-a", quantityOnHand = 2, quantityReserved = 0, reorderThreshold = 5),
                InventoryItem("sku-b", quantityOnHand = 100, quantityReserved = 0, reorderThreshold = 5),
            ),
        )
        val listLowStock = ListLowStockProducts(inventory, InMemoryProductRepository(seed = catalog))

        val result = listLowStock()

        assertIs<Result.Success<List<LowStockEntry>>>(result)
        assertEquals(listOf("sku-a"), result.value.map { it.product.id })
    }

    @Test
    fun `orders the most urgent shortfall first`() {
        val inventory = InMemoryInventoryRepository(
            seed = listOf(
                InventoryItem("sku-a", quantityOnHand = 4, quantityReserved = 0, reorderThreshold = 5),
                InventoryItem("sku-b", quantityOnHand = 0, quantityReserved = 0, reorderThreshold = 5),
            ),
        )
        val listLowStock = ListLowStockProducts(inventory, InMemoryProductRepository(seed = catalog))

        val result = listLowStock() as Result.Success<List<LowStockEntry>>

        assertEquals(listOf("sku-b", "sku-a"), result.value.map { it.product.id })
    }

    @Test
    fun `pairs each entry with its own stock record`() {
        val inventory = InMemoryInventoryRepository(
            seed = listOf(InventoryItem("sku-a", quantityOnHand = 1, quantityReserved = 0, reorderThreshold = 5)),
        )
        val listLowStock = ListLowStockProducts(inventory, InMemoryProductRepository(seed = catalog))

        val result = listLowStock() as Result.Success<List<LowStockEntry>>

        assertEquals(1, result.value.single().inventory.quantityOnHand)
    }

    @Test
    fun `skips a product no longer present in the catalog`() {
        val inventory = InMemoryInventoryRepository(
            seed = listOf(InventoryItem("sku-removed", quantityOnHand = 0, quantityReserved = 0, reorderThreshold = 5)),
        )
        val listLowStock = ListLowStockProducts(inventory, InMemoryProductRepository(seed = catalog))

        val result = listLowStock() as Result.Success<List<LowStockEntry>>

        assertTrue(result.value.isEmpty())
    }

    @Test
    fun `returns an empty report when nothing needs reordering`() {
        val inventory = InMemoryInventoryRepository(
            seed = listOf(InventoryItem("sku-a", quantityOnHand = 100, quantityReserved = 0, reorderThreshold = 5)),
        )
        val listLowStock = ListLowStockProducts(inventory, InMemoryProductRepository(seed = catalog))

        val result = listLowStock() as Result.Success<List<LowStockEntry>>

        assertTrue(result.value.isEmpty())
    }

    @Test
    fun `excludes a discontinued product by default`() {
        val discontinued = Product("sku-d", "Widget D", Money.ofUnits(40L), active = false)
        val inventory = InMemoryInventoryRepository(
            seed = listOf(InventoryItem("sku-d", quantityOnHand = 0, quantityReserved = 0, reorderThreshold = 5)),
        )
        val listLowStock = ListLowStockProducts(inventory, InMemoryProductRepository(seed = catalog + discontinued))

        val result = listLowStock() as Result.Success<List<LowStockEntry>>

        assertTrue(result.value.isEmpty())
    }

    @Test
    fun `includes a discontinued product when explicitly requested`() {
        val discontinued = Product("sku-d", "Widget D", Money.ofUnits(40L), active = false)
        val inventory = InMemoryInventoryRepository(
            seed = listOf(InventoryItem("sku-d", quantityOnHand = 0, quantityReserved = 0, reorderThreshold = 5)),
        )
        val listLowStock = ListLowStockProducts(inventory, InMemoryProductRepository(seed = catalog + discontinued))

        val result = listLowStock(includeDiscontinued = true) as Result.Success<List<LowStockEntry>>

        assertEquals(listOf("sku-d"), result.value.map { it.product.id })
    }

    @Test
    fun `suggestedReorderQuantity reports the shortfall to clear the threshold`() {
        val inventory = InMemoryInventoryRepository(
            seed = listOf(InventoryItem("sku-a", quantityOnHand = 2, quantityReserved = 0, reorderThreshold = 5)),
        )
        val listLowStock = ListLowStockProducts(inventory, InMemoryProductRepository(seed = catalog))

        val result = listLowStock() as Result.Success<List<LowStockEntry>>

        assertEquals(4, result.value.single().suggestedReorderQuantity())
    }
}
