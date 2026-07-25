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
}
