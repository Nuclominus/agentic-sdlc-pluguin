package bench.domain.usecase

import bench.data.InMemoryInventoryRepository
import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.model.InventoryItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ReleaseInventoryTest {
    private fun stockOf(onHand: Int, reserved: Int) =
        InventoryItem("sku-1001", quantityOnHand = onHand, quantityReserved = reserved, reorderThreshold = 5)

    private fun stockOf(productId: String, onHand: Int, reserved: Int) =
        InventoryItem(productId, quantityOnHand = onHand, quantityReserved = reserved, reorderThreshold = 5)

    @Test
    fun `releases previously reserved stock`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(onHand = 50, reserved = 10)))
        val releaseInventory = ReleaseInventory(inventory)

        val result = releaseInventory("sku-1001", 4)

        assertIs<Result.Success<InventoryItem>>(result)
        assertEquals(6, result.value.quantityReserved)
    }

    @Test
    fun `releasing more than reserved floors at zero`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(onHand = 50, reserved = 3)))
        val releaseInventory = ReleaseInventory(inventory)

        val result = releaseInventory("sku-1001", 10)

        assertIs<Result.Success<InventoryItem>>(result)
        assertEquals(0, result.value.quantityReserved)
    }

    @Test
    fun `leaves quantityOnHand unchanged`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(onHand = 50, reserved = 10)))
        val releaseInventory = ReleaseInventory(inventory)

        val result = releaseInventory("sku-1001", 5)

        assertIs<Result.Success<InventoryItem>>(result)
        assertEquals(50, result.value.quantityOnHand)
    }

    @Test
    fun `fails with NotFoundError when the product is not tracked`() {
        val inventory = InMemoryInventoryRepository(seed = emptyList())
        val releaseInventory = ReleaseInventory(inventory)

        val result = releaseInventory("sku-untracked", 1)

        assertIs<NotFoundError>((result as Result.Failure).error)
    }

    @Test
    fun `persists the release to the repository`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(onHand = 50, reserved = 10)))
        val releaseInventory = ReleaseInventory(inventory)

        releaseInventory("sku-1001", 10)

        assertEquals(0, inventory.findByProductId("sku-1001")?.quantityReserved)
    }

    @Test
    fun `releaseAll releases every line in the map`() {
        val inventory = InMemoryInventoryRepository(
            seed = listOf(stockOf("sku-a", onHand = 50, reserved = 10), stockOf("sku-b", onHand = 30, reserved = 5)),
        )
        val releaseInventory = ReleaseInventory(inventory)

        val result = releaseInventory.releaseAll(mapOf("sku-a" to 4, "sku-b" to 5))

        assertIs<Result.Success<List<InventoryItem>>>(result)
        assertEquals(6, inventory.findByProductId("sku-a")?.quantityReserved)
        assertEquals(0, inventory.findByProductId("sku-b")?.quantityReserved)
    }

    @Test
    fun `releaseAll fails with NotFoundError for an untracked product in the map`() {
        val inventory = InMemoryInventoryRepository(
            seed = listOf(stockOf("sku-a", onHand = 50, reserved = 10)),
        )
        val releaseInventory = ReleaseInventory(inventory)

        val result = releaseInventory.releaseAll(mapOf("sku-a" to 1, "sku-missing" to 1))

        assertIs<NotFoundError>((result as Result.Failure).error)
    }

    @Test
    fun `releaseAll returns every updated record in its success value`() {
        val inventory = InMemoryInventoryRepository(
            seed = listOf(stockOf("sku-a", onHand = 50, reserved = 10)),
        )
        val releaseInventory = ReleaseInventory(inventory)

        val result = releaseInventory.releaseAll(mapOf("sku-a" to 4)) as Result.Success<List<InventoryItem>>

        assertEquals(1, result.value.size)
        assertEquals(6, result.value.single().quantityReserved)
    }

    @Test
    fun `releaseEverythingReserved zeroes out the reserved counter`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(onHand = 50, reserved = 12)))
        val releaseInventory = ReleaseInventory(inventory)

        val result = releaseInventory.releaseEverythingReserved("sku-1001")

        assertIs<Result.Success<InventoryItem>>(result)
        assertEquals(0, result.value.quantityReserved)
    }

    @Test
    fun `releaseEverythingReserved is a no-op when nothing was reserved`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(onHand = 50, reserved = 0)))
        val releaseInventory = ReleaseInventory(inventory)

        val result = releaseInventory.releaseEverythingReserved("sku-1001")

        assertIs<Result.Success<InventoryItem>>(result)
        assertEquals(0, result.value.quantityReserved)
    }

    @Test
    fun `releaseEverythingReserved fails with NotFoundError when the product is not tracked`() {
        val releaseInventory = ReleaseInventory(InMemoryInventoryRepository(seed = emptyList()))

        val result = releaseInventory.releaseEverythingReserved("sku-untracked")

        assertIs<NotFoundError>((result as Result.Failure).error)
    }
}
