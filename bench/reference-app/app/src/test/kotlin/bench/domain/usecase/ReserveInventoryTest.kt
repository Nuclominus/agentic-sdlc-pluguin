package bench.domain.usecase

import bench.data.InMemoryInventoryRepository
import bench.domain.NotFoundError
import bench.domain.Result
import bench.domain.ValidationError
import bench.domain.model.InventoryItem
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertIs

class ReserveInventoryTest {
    private fun stockOf(available: Int, reserved: Int = 0) =
        InventoryItem("sku-1001", quantityOnHand = available + reserved, quantityReserved = reserved, reorderThreshold = 5)

    private fun stockOf(productId: String, available: Int) =
        InventoryItem(productId, quantityOnHand = available, quantityReserved = 0, reorderThreshold = 5)

    @Test
    fun `reserves stock when enough is available`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(available = 20)))
        val reserveInventory = ReserveInventory(inventory)

        val result = reserveInventory("sku-1001", 10)

        assertIs<Result.Success<InventoryItem>>(result)
        assertEquals(10, result.value.quantityReserved)
    }

    @Test
    fun `reserving exactly the available amount succeeds`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(available = 5)))
        val reserveInventory = ReserveInventory(inventory)

        val result = reserveInventory("sku-1001", 5)

        assertIs<Result.Success<InventoryItem>>(result)
        assertEquals(0, result.value.availableQuantity)
    }

    @Test
    fun `fails when the requested quantity exceeds availability`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(available = 3)))
        val reserveInventory = ReserveInventory(inventory)

        val result = reserveInventory("sku-1001", 4)

        assertIs<ValidationError>((result as Result.Failure).error)
    }

    @Test
    fun `fails with NotFoundError when the product is not tracked`() {
        val inventory = InMemoryInventoryRepository(seed = emptyList())
        val reserveInventory = ReserveInventory(inventory)

        val result = reserveInventory("sku-untracked", 1)

        assertIs<NotFoundError>((result as Result.Failure).error)
    }

    @Test
    fun `persists the reservation to the repository`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(available = 20)))
        val reserveInventory = ReserveInventory(inventory)

        reserveInventory("sku-1001", 7)

        assertEquals(7, inventory.findByProductId("sku-1001")?.quantityReserved)
    }

    @Test
    fun `does not change stock when a reservation is rejected`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf(available = 3)))
        val reserveInventory = ReserveInventory(inventory)

        reserveInventory("sku-1001", 10)

        assertEquals(0, inventory.findByProductId("sku-1001")?.quantityReserved)
    }

    @Test
    fun `reserveAllOrNothing reserves every line when all are satisfiable`() {
        val inventory = InMemoryInventoryRepository(
            seed = listOf(stockOf("sku-a", available = 10), stockOf("sku-b", available = 20)),
        )
        val reserveInventory = ReserveInventory(inventory)

        val result = reserveInventory.reserveAllOrNothing(mapOf("sku-a" to 5, "sku-b" to 8))

        assertIs<Result.Success<List<InventoryItem>>>(result)
        assertEquals(5, inventory.findByProductId("sku-a")?.quantityReserved)
        assertEquals(8, inventory.findByProductId("sku-b")?.quantityReserved)
    }

    @Test
    fun `reserveAllOrNothing reserves nothing when one line cannot be satisfied`() {
        val inventory = InMemoryInventoryRepository(
            seed = listOf(stockOf("sku-a", available = 10), stockOf("sku-b", available = 2)),
        )
        val reserveInventory = ReserveInventory(inventory)

        val result = reserveInventory.reserveAllOrNothing(mapOf("sku-a" to 5, "sku-b" to 8))

        assertIs<Result.Failure>(result)
        assertEquals(0, inventory.findByProductId("sku-a")?.quantityReserved)
        assertEquals(0, inventory.findByProductId("sku-b")?.quantityReserved)
    }

    @Test
    fun `reserveAllOrNothing fails with NotFoundError when any product is untracked`() {
        val inventory = InMemoryInventoryRepository(seed = listOf(stockOf("sku-a", available = 10)))
        val reserveInventory = ReserveInventory(inventory)

        val result = reserveInventory.reserveAllOrNothing(mapOf("sku-a" to 1, "sku-missing" to 1))

        assertIs<NotFoundError>((result as Result.Failure).error)
    }
}
