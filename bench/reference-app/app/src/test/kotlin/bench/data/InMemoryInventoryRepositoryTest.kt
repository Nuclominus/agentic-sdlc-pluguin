package bench.data

import bench.domain.model.InventoryItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class InMemoryInventoryRepositoryTest {
    @Test
    fun `findByProductId returns a seeded stock record`() {
        val repository = InMemoryInventoryRepository()

        val found = repository.findByProductId("sku-1001")

        assertEquals(120, found?.quantityOnHand)
    }

    @Test
    fun `findByProductId returns null for an untracked product`() {
        val repository = InMemoryInventoryRepository()

        assertNull(repository.findByProductId("sku-9999"))
    }

    @Test
    fun `save inserts a new stock record`() {
        val repository = InMemoryInventoryRepository(seed = emptyList())
        val item = InventoryItem("sku-new", quantityOnHand = 10, quantityReserved = 0, reorderThreshold = 2)

        repository.save(item)

        assertEquals(item, repository.findByProductId("sku-new"))
    }

    @Test
    fun `save overwrites an existing stock record for the same product`() {
        val repository = InMemoryInventoryRepository()
        val existing = repository.findByProductId("sku-1001")!!

        repository.save(existing.withReserved(5))

        assertEquals(15, repository.findByProductId("sku-1001")?.quantityReserved)
    }

    @Test
    fun `findAll returns every tracked stock record`() {
        val repository = InMemoryInventoryRepository()

        val all = repository.findAll()

        assertTrue(all.size >= 16)
        assertTrue(all.any { it.productId == "sku-1004" })
    }

    @Test
    fun `findNeedingReorder returns only stock at or below its threshold`() {
        val repository = InMemoryInventoryRepository(
            seed = listOf(
                InventoryItem("sku-low", quantityOnHand = 5, quantityReserved = 3, reorderThreshold = 5),
                InventoryItem("sku-healthy", quantityOnHand = 100, quantityReserved = 5, reorderThreshold = 10),
            ),
        )

        val needingReorder = repository.findNeedingReorder()

        assertEquals(listOf("sku-low"), needingReorder.map { it.productId })
    }

    @Test
    fun `findNeedingReorder is empty when every item is comfortably stocked`() {
        val repository = InMemoryInventoryRepository(
            seed = listOf(InventoryItem("sku-healthy", quantityOnHand = 100, quantityReserved = 5, reorderThreshold = 10)),
        )

        assertTrue(repository.findNeedingReorder().isEmpty())
    }

    @Test
    fun `totalAvailableUnits sums available quantity across every tracked product`() {
        val repository = InMemoryInventoryRepository(
            seed = listOf(
                InventoryItem("sku-a", quantityOnHand = 50, quantityReserved = 10, reorderThreshold = 5),
                InventoryItem("sku-b", quantityOnHand = 30, quantityReserved = 5, reorderThreshold = 5),
            ),
        )

        assertEquals(65, repository.totalAvailableUnits())
    }

    @Test
    fun `totalAvailableUnits is zero for an empty repository`() {
        val repository = InMemoryInventoryRepository(seed = emptyList())

        assertEquals(0, repository.totalAvailableUnits())
    }

    @Test
    fun `isTracked is true for a seeded product`() {
        val repository = InMemoryInventoryRepository()

        assertTrue(repository.isTracked("sku-1001"))
    }

    @Test
    fun `isTracked is false for a product with no stock record`() {
        val repository = InMemoryInventoryRepository(seed = emptyList())

        assertFalse(repository.isTracked("sku-untracked"))
    }

    @Test
    fun `findByProductIds returns matching stock records in one call`() {
        val repository = InMemoryInventoryRepository()

        val found = repository.findByProductIds(listOf("sku-1001", "sku-1002"))

        assertEquals(setOf("sku-1001", "sku-1002"), found.map { it.productId }.toSet())
    }

    @Test
    fun `findByProductIds silently omits ids with no stock record`() {
        val repository = InMemoryInventoryRepository()

        val found = repository.findByProductIds(listOf("sku-1001", "sku-untracked"))

        assertEquals(listOf("sku-1001"), found.map { it.productId })
    }
}
