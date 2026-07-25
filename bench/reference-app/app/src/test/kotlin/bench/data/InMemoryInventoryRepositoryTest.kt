package bench.data

import bench.domain.model.InventoryItem
import kotlin.test.Test
import kotlin.test.assertEquals
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
}
