package bench.domain.usecase

import bench.domain.NotFoundError
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
        val candidates = if (onlyActive) products.findActive() else products.findAll()
        val matches = candidates
            .asSequence()
            .filter { query.isNullOrBlank() || it.matchesName(query) }
            .filter { maxPrice == null || it.isPricedAtMost(maxPrice) }
            .sortedBy { it.name }
            .toList()

        return Result.Success(matches)
    }

    /**
     * Looks up a single product by id, for the product-detail page a
     * search result links to.
     *
     * Unlike [invoke], this *can* fail: a search always returning
     * "possibly zero results" is normal, but following a specific link to
     * a specific product id that turns out not to exist is a genuine
     * not-found case worth reporting distinctly.
     *
     * @return [Result.Success] with the product, or [Result.Failure]
     *   wrapping a [NotFoundError] if no product has that id.
     */
    fun byId(productId: String): Result<Product> {
        val product = products.findById(productId)
            ?: return Result.Failure(NotFoundError("No product with id $productId", productId))
        return Result.Success(product)
    }

    /**
     * The cheapest currently-active product matching [query], or `null`
     * if nothing matches. A thin convenience over [invoke] for a "show me
     * your best deal on X" style prompt.
     */
    fun cheapestMatching(query: String): Product? {
        val matches = invoke(query = query, onlyActive = true)
        return (matches as Result.Success).value.minByOrNull { it.unitPrice.cents }
    }
}
