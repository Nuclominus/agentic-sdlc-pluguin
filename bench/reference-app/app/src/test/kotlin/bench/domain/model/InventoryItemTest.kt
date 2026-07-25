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

    @Test
    fun `healthPercent is 100 when available quantity exactly matches the threshold`() {
        val sample = item(onHand = 5, reserved = 0, threshold = 5)

        assertEquals(100.0, sample.healthPercent())
    }

    @Test
    fun `healthPercent is above 100 when comfortably stocked`() {
        val sample = item(onHand = 20, reserved = 0, threshold = 5)

        assertEquals(400.0, sample.healthPercent())
    }

    @Test
    fun `healthPercent handles a zero threshold without dividing by zero`() {
        val stocked = item(onHand = 5, reserved = 0, threshold = 0)
        val empty = item(onHand = 0, reserved = 0, threshold = 0)

        assertEquals(100.0, stocked.healthPercent())
        assertEquals(0.0, empty.healthPercent())
    }

    @Test
    fun `shortfallToClearThreshold is zero once comfortably stocked`() {
        val sample = item(onHand = 100, reserved = 0, threshold = 5)

        assertEquals(0, sample.shortfallToClearThreshold())
    }

    @Test
    fun `shortfallToClearThreshold reports how many more units are needed`() {
        val sample = item(onHand = 3, reserved = 0, threshold = 5)

        assertEquals(3, sample.shortfallToClearThreshold())
    }

    @Test
    fun `isEmpty is true only when both on-hand and reserved are zero`() {
        assertTrue(item(onHand = 0, reserved = 0).isEmpty())
        assertFalse(item(onHand = 0, reserved = 3).isEmpty())
        assertFalse(item(onHand = 5, reserved = 0).isEmpty())
    }

    @Test
    fun `reservationRate expresses reserved as a fraction of on-hand`() {
        val sample = item(onHand = 100, reserved = 25)

        assertEquals(0.25, sample.reservationRate())
    }

    @Test
    fun `reservationRate is zero when nothing is on hand`() {
        val sample = item(onHand = 0, reserved = 0)

        assertEquals(0.0, sample.reservationRate())
    }

    @Test
    fun `reservationRate is 1 when everything on hand is reserved`() {
        val sample = item(onHand = 40, reserved = 40)

        assertEquals(1.0, sample.reservationRate())
    }
}
