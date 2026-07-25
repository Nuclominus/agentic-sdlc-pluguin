package bench.domain.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class InventoryItemTest {
    private fun item(onHand: Int, reserved: Int, threshold: Int = 5) =
        InventoryItem("sku-1001", quantityOnHand = onHand, quantityReserved = reserved, reorderThreshold = threshold)

    @Test
    fun `availableQuantity subtracts reserved from on-hand`() {
        val sample = item(onHand = 100, reserved = 30)

        assertEquals(70, sample.availableQuantity)
    }

    @Test
    fun `needsReorder is true once available quantity drops to the threshold`() {
        val sample = item(onHand = 25, reserved = 20, threshold = 5)

        assertTrue(sample.needsReorder())
    }

    @Test
    fun `needsReorder is false comfortably above the threshold`() {
        val sample = item(onHand = 100, reserved = 10, threshold = 5)

        assertFalse(sample.needsReorder())
    }

    @Test
    fun `canReserve is true when enough stock is available`() {
        val sample = item(onHand = 50, reserved = 10)

        assertTrue(sample.canReserve(40))
    }

    @Test
    fun `canReserve is false when the requested quantity exceeds availability`() {
        val sample = item(onHand = 50, reserved = 10)

        assertFalse(sample.canReserve(41))
    }

    @Test
    fun `withReserved increases the reserved counter without touching on-hand`() {
        val sample = item(onHand = 50, reserved = 10)

        val updated = sample.withReserved(5)

        assertEquals(15, updated.quantityReserved)
        assertEquals(50, updated.quantityOnHand)
    }

    @Test
    fun `withReleased decreases the reserved counter`() {
        val sample = item(onHand = 50, reserved = 10)

        val updated = sample.withReleased(4)

        assertEquals(6, updated.quantityReserved)
    }

    @Test
    fun `withReleased floors at zero instead of going negative`() {
        val sample = item(onHand = 50, reserved = 3)

        val updated = sample.withReleased(10)

        assertEquals(0, updated.quantityReserved)
    }
}
