package bench.domain.usecase

import bench.data.InMemoryInventoryRepository
import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.ValidationError
import bench.domain.model.InventoryItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs
import kotlin.test.assertTrue

class RestockInventoryTest {
    private fun stockOf(onHand: Int, reserved: Int = 0, threshold: Int = 5) =
        InventoryItem("sku-1001", quantityOnHand = onHand, quantityReserved = reserved, reorderThreshold = threshold)

    @Test
    fun `increases quantityOnHand by the amount received`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(onHand = 10)))
        val restockInventory = RestockInventory(inventory)

        val result = restockInventory("sku-1001", 25)

        assertIs<Result.Success<InventoryItem>>(result)
        assertEquals(35, result.value.quantityOnHand)
    }

    @Test
    fun `leaves quantityReserved untouched`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(onHand = 10, reserved = 4)))
        val restockInventory = RestockInventory(inventory)

        val result = restockInventory("sku-1001", 10)

        assertIs<Result.Success<InventoryItem>>(result)
        assertEquals(4, result.value.quantityReserved)
    }

    @Test
    fun `fails with NotFoundError when the product is not tracked`() {
        val restockInventory = RestockInventory(InMemoryInventoryRepository(seed = emptyList()))

        val result = restockInventory("sku-untracked", 10)

        assertIs<NotFoundError>((result as Result.Failure).error)
    }

    @Test
    fun `fails when the received quantity is zero`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(onHand = 10)))
        val restockInventory = RestockInventory(inventory)

        val result = restockInventory("sku-1001", 0)

        assertIs<ValidationError>((result as Result.Failure).error)
    }

    @Test
    fun `fails when the received quantity is negative`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(onHand = 10)))
        val restockInventory = RestockInventory(inventory)

        val result = restockInventory("sku-1001", -3)

        assertIs<ValidationError>((result as Result.Failure).error)
    }

    @Test
    fun `restockEverythingLow tops up only items below their reorder threshold`() {
        val inventory = InMemoryInventoryRepository(
            seed = listOf(
                InventoryItem("sku-low", quantityOnHand = 2, quantityReserved = 0, reorderThreshold = 5),
                InventoryItem("sku-healthy", quantityOnHand = 100, quantityReserved = 0, reorderThreshold = 5),
            ),
        )
        val restockInventory = RestockInventory(inventory)

        val updated = restockInventory.restockEverythingLow(targetQuantity = 20)

        assertEquals(listOf("sku-low"), updated.map { it.productId })
        assertEquals(20, inventory.findByProductId("sku-low")?.quantityOnHand)
        assertEquals(100, inventory.findByProductId("sku-healthy")?.quantityOnHand)
    }

    @Test
    fun `restockEverythingLow does nothing when every item is already at or above the target`() {
        val inventory = InMemoryInventoryRepository(
            seed = listOf(InventoryItem("sku-low", quantityOnHand = 25, quantityReserved = 21, reorderThreshold = 5)),
        )
        val restockInventory = RestockInventory(inventory)

        val updated = restockInventory.restockEverythingLow(targetQuantity = 20)

        assertTrue(updated.isEmpty())
    }
}
