package bench.domain.usecase

import bench.domain.Result
import bench.domain.model.Money
import bench.domain.model.Product
import bench.domain.repository.ProductRepository

/**
 * Searches the catalog for products matching a free-text query.
 *
 * This is the read path behind a storefront search box: it never fails
 * (an empty result set is a perfectly normal outcome of a search), which is
 * why it always returns [Result.Success] rather than modeling "no matches"
 * as an error.
 */
class FindProducts(
    private val products: ProductRepository,
) {
    /**
     * @param query free text matched case-insensitively against product
     *   names; blank or `null` matches everything.
     * @param onlyActive when `true` (the default), discontinued products
     *   are excluded from the results.
     * @param maxPrice an optional ceiling; when present, only products
     *   priced at or below it are returned.
     * @return [Result.Success] with the matching products, sorted by name.
     */
    operator fun invoke(
        query: String? = null,
        onlyActive: Boolean = true,
        maxPrice: Money? = null,
    ): Result<List<Product>> {
        val matches = products.findAll()
            .asSequence()
            .filter { !onlyActive || it.active }
            .filter { query.isNullOrBlank() || it.name.contains(query, ignoreCase = true) }
            .filter { maxPrice == null || it.isPricedAtMost(maxPrice) }
            .sortedBy { it.name }
            .toList()

        return Result.Success(matches)
    }
}
