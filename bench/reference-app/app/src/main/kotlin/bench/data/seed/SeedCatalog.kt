package bench.data.seed

import bench.domain.model.InventoryItem
import bench.domain.model.Money
import bench.domain.model.Product

/**
 * The starting product catalog and matching warehouse stock used to seed
 * the in-memory repositories.
 *
 * This is deliberately a plain object rather than something loaded from a
 * file or database: the specimen has no persistence layer of its own, and a
 * fixed, readable seed set makes every use case's behaviour reproducible
 * without any setup step.
 */
object SeedCatalog {
    /** The full starting catalog, spanning a handful of everyday product categories. */
    val products: List<Product> = listOf(
        Product("sku-1001", "Wireless Mouse", Money.ofUnits(24L), active = true),
        Product("sku-1002", "Mechanical Keyboard", Money.ofUnits(89L), active = true),
        Product("sku-1003", "USB-C Hub", Money.ofUnits(39L), active = true),
        Product("sku-1004", "27-inch Monitor", Money.ofUnits(249L), active = true),
        Product("sku-1005", "Laptop Stand", Money.ofUnits(45L), active = true),
        Product("sku-1006", "Webcam 1080p", Money.ofUnits(59L), active = true),
        Product("sku-1007", "Noise-Cancelling Headphones", Money.ofUnits(179L), active = true),
        Product("sku-1008", "Desk Mat", Money.ofUnits(19L), active = true),
        Product("sku-1009", "Portable SSD 1TB", Money.ofUnits(99L), active = true),
        Product("sku-1010", "Ergonomic Chair", Money.ofUnits(329L), active = true),
        Product("sku-1011", "Standing Desk Converter", Money.ofUnits(219L), active = true),
        Product("sku-1012", "Ring Light", Money.ofUnits(35L), active = true),
        Product("sku-1013", "Bluetooth Speaker", Money.ofUnits(69L), active = true),
        Product("sku-1014", "Cable Organizer Set", Money.ofUnits(12L), active = true),
        Product("sku-1015", "Discontinued Trackball", Money.ofUnits(55L), active = false),
        Product("sku-1016", "Retired Docking Station", Money.ofUnits(129L), active = false),
        Product("sku-1017", "Wireless Charging Pad", Money.ofUnits(29L), active = true),
        Product("sku-1018", "Monitor Arm, Single", Money.ofUnits(65L), active = true),
        Product("sku-1019", "Monitor Arm, Dual", Money.ofUnits(95L), active = true),
        Product("sku-1020", "Under-Desk Cable Tray", Money.ofUnits(22L), active = true),
        Product("sku-1021", "USB Microphone", Money.ofUnits(75L), active = true),
        Product("sku-1022", "Green Screen Backdrop", Money.ofUnits(49L), active = true),
        Product("sku-1023", "Laptop Sleeve 14-inch", Money.ofUnits(18L), active = true),
        Product("sku-1024", "Travel Charger, 65W", Money.ofUnits(32L), active = true),
        Product("sku-1025", "Wrist Rest, Gel", Money.ofUnits(14L), active = true),
        Product("sku-1026", "Footrest, Adjustable", Money.ofUnits(38L), active = true),
        Product("sku-1027", "External DVD Drive", Money.ofUnits(28L), active = false),
        Product("sku-1028", "VGA-to-HDMI Adapter", Money.ofUnits(16L), active = false),
        Product("sku-1029", "Mesh Office Chair", Money.ofUnits(199L), active = true),
        Product("sku-1030", "Adjustable Monitor Stand", Money.ofUnits(42L), active = true),
        Product("sku-1031", "USB-C to Ethernet Adapter", Money.ofUnits(21L), active = true),
        Product("sku-1032", "4-Port USB 3.0 Hub", Money.ofUnits(17L), active = true),
        Product("sku-1033", "Portable Monitor 15-inch", Money.ofUnits(189L), active = true),
        Product("sku-1034", "Wireless Charging Stand", Money.ofUnits(34L), active = true),
        Product("sku-1035", "HDMI Cable, 2m", Money.ofUnits(9L), active = true),
        Product("sku-1036", "Surge Protector, 8-outlet", Money.ofUnits(26L), active = true),
        Product("sku-1037", "Blue Light Glasses", Money.ofUnits(23L), active = true),
        Product("sku-1038", "Desk Lamp, LED", Money.ofUnits(31L), active = true),
        Product("sku-1039", "Legacy PS/2 Keyboard", Money.ofUnits(15L), active = false),
        Product("sku-1040", "Parallel Port Adapter", Money.ofUnits(11L), active = false),
    )

    /**
     * Stock levels for every product above. Kept in lockstep with
     * [products] by product id; [InMemoryInventoryRepository][bench.data.InMemoryInventoryRepository]
     * does not enforce that every product has a stock record, but the seed
     * data provides one for each so tests never have to special-case a
     * missing record unless they explicitly want to.
     */
    val inventory: List<InventoryItem> = listOf(
        InventoryItem("sku-1001", quantityOnHand = 120, quantityReserved = 10, reorderThreshold = 20),
        InventoryItem("sku-1002", quantityOnHand = 60, quantityReserved = 5, reorderThreshold = 15),
        InventoryItem("sku-1003", quantityOnHand = 200, quantityReserved = 30, reorderThreshold = 40),
        InventoryItem("sku-1004", quantityOnHand = 25, quantityReserved = 4, reorderThreshold = 5),
        InventoryItem("sku-1005", quantityOnHand = 80, quantityReserved = 8, reorderThreshold = 15),
        InventoryItem("sku-1006", quantityOnHand = 45, quantityReserved = 5, reorderThreshold = 10),
        InventoryItem("sku-1007", quantityOnHand = 30, quantityReserved = 2, reorderThreshold = 8),
        InventoryItem("sku-1008", quantityOnHand = 300, quantityReserved = 20, reorderThreshold = 50),
        InventoryItem("sku-1009", quantityOnHand = 15, quantityReserved = 1, reorderThreshold = 10),
        InventoryItem("sku-1010", quantityOnHand = 12, quantityReserved = 3, reorderThreshold = 4),
        InventoryItem("sku-1011", quantityOnHand = 18, quantityReserved = 2, reorderThreshold = 5),
        InventoryItem("sku-1012", quantityOnHand = 70, quantityReserved = 6, reorderThreshold = 15),
        InventoryItem("sku-1013", quantityOnHand = 55, quantityReserved = 5, reorderThreshold = 12),
        InventoryItem("sku-1014", quantityOnHand = 400, quantityReserved = 25, reorderThreshold = 80),
        InventoryItem("sku-1015", quantityOnHand = 4, quantityReserved = 0, reorderThreshold = 2),
        InventoryItem("sku-1016", quantityOnHand = 2, quantityReserved = 0, reorderThreshold = 2),
        InventoryItem("sku-1017", quantityOnHand = 150, quantityReserved = 12, reorderThreshold = 25),
        InventoryItem("sku-1018", quantityOnHand = 40, quantityReserved = 6, reorderThreshold = 10),
        InventoryItem("sku-1019", quantityOnHand = 22, quantityReserved = 3, reorderThreshold = 6),
        InventoryItem("sku-1020", quantityOnHand = 90, quantityReserved = 8, reorderThreshold = 18),
        InventoryItem("sku-1021", quantityOnHand = 35, quantityReserved = 4, reorderThreshold = 8),
        InventoryItem("sku-1022", quantityOnHand = 20, quantityReserved = 1, reorderThreshold = 5),
        InventoryItem("sku-1023", quantityOnHand = 210, quantityReserved = 15, reorderThreshold = 40),
        InventoryItem("sku-1024", quantityOnHand = 85, quantityReserved = 9, reorderThreshold = 16),
        InventoryItem("sku-1025", quantityOnHand = 260, quantityReserved = 18, reorderThreshold = 50),
        InventoryItem("sku-1026", quantityOnHand = 33, quantityReserved = 2, reorderThreshold = 8),
        InventoryItem("sku-1027", quantityOnHand = 3, quantityReserved = 0, reorderThreshold = 2),
        InventoryItem("sku-1028", quantityOnHand = 6, quantityReserved = 0, reorderThreshold = 2),
        InventoryItem("sku-1029", quantityOnHand = 14, quantityReserved = 3, reorderThreshold = 4),
        InventoryItem("sku-1030", quantityOnHand = 95, quantityReserved = 10, reorderThreshold = 20),
        InventoryItem("sku-1031", quantityOnHand = 130, quantityReserved = 15, reorderThreshold = 25),
        InventoryItem("sku-1032", quantityOnHand = 175, quantityReserved = 20, reorderThreshold = 35),
        InventoryItem("sku-1033", quantityOnHand = 18, quantityReserved = 2, reorderThreshold = 5),
        InventoryItem("sku-1034", quantityOnHand = 60, quantityReserved = 5, reorderThreshold = 12),
        InventoryItem("sku-1035", quantityOnHand = 500, quantityReserved = 40, reorderThreshold = 100),
        InventoryItem("sku-1036", quantityOnHand = 75, quantityReserved = 8, reorderThreshold = 15),
        InventoryItem("sku-1037", quantityOnHand = 110, quantityReserved = 9, reorderThreshold = 20),
        InventoryItem("sku-1038", quantityOnHand = 65, quantityReserved = 6, reorderThreshold = 14),
        InventoryItem("sku-1039", quantityOnHand = 1, quantityReserved = 0, reorderThreshold = 1),
        InventoryItem("sku-1040", quantityOnHand = 2, quantityReserved = 0, reorderThreshold = 1),
    )

    /** Convenience lookup for a seeded product by id, mainly used from tests. */
    fun product(id: String): Product = products.first { it.id == id }

    /** Convenience lookup for a seeded stock record by product id, mainly used from tests. */
    fun stockOf(productId: String): InventoryItem = inventory.first { it.productId == productId }
}
