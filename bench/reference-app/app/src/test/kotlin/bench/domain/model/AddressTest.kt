package bench.domain.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class AddressTest {
    @Test
    fun `singleLine includes the region when present`() {
        val address = Address("12 Elm Street", "Portland", "OR", "97201", "US")

        assertEquals("12 Elm Street, Portland, OR 97201, US", address.singleLine())
    }

    @Test
    fun `singleLine omits the region when absent`() {
        val address = Address("77 Harbour Road", "Dublin", null, "D02", "IE")

        assertEquals("77 Harbour Road, Dublin D02, IE", address.singleLine())
    }

    @Test
    fun `isDomesticTo matches the country case-insensitively`() {
        val address = Address("12 Elm Street", "Portland", "OR", "97201", "us")

        assertTrue(address.isDomesticTo("US"))
    }

    @Test
    fun `isDomesticTo is false for a different country`() {
        val address = Address("15 Via Roma", "Milan", null, "20121", "IT")

        assertFalse(address.isDomesticTo("US"))
    }

    @Test
    fun `shortLabel combines city and country`() {
        val address = Address("15 Via Roma", "Milan", null, "20121", "IT")

        assertEquals("Milan, IT", address.shortLabel())
    }

    @Test
    fun `unspecified produces a syntactically plausible placeholder`() {
        val address = Address.unspecified()

        assertTrue(address.singleLine().isNotBlank())
    }
}
