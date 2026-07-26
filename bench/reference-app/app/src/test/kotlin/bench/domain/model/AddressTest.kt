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

    @Test
    fun `hasRegion is true when a non-blank region is present`() {
        val address = Address("12 Elm Street", "Portland", "OR", "97201", "US")

        assertTrue(address.hasRegion())
    }

    @Test
    fun `hasRegion is false when the region is null or blank`() {
        val withoutRegion = Address("77 Harbour Road", "Dublin", null, "D02", "IE")
        val blankRegion = withoutRegion.copy(region = "  ")

        assertFalse(withoutRegion.hasRegion())
        assertFalse(blankRegion.hasRegion())
    }

    @Test
    fun `withCountry replaces only the country field`() {
        val address = Address("12 Elm Street", "Portland", "OR", "97201", "US")

        val moved = address.withCountry("CA")

        assertEquals("CA", moved.country)
        assertEquals(address.street, moved.street)
        assertEquals(address.city, moved.city)
    }

    @Test
    fun `sameCountryAs is true regardless of city or street`() {
        val first = Address("12 Elm Street", "Portland", "OR", "97201", "US")
        val second = Address("500 Other Ave", "Miami", "FL", "33101", "us")

        assertTrue(first.sameCountryAs(second))
    }

    @Test
    fun `sameCountryAs is false for different countries`() {
        val first = Address("12 Elm Street", "Portland", "OR", "97201", "US")
        val second = Address("15 Via Roma", "Milan", null, "20121", "IT")

        assertFalse(first.sameCountryAs(second))
    }
}
