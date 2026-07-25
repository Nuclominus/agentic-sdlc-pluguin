package bench.domain.repository

import bench.domain.model.Customer

/**
 * Read access to the registered customer directory.
 *
 * Customer creation and profile edits are handled by the store's account
 * management flow, which is out of scope for this order-processing slice —
 * every use case here treats customers as already existing.
 */
interface CustomerRepository {
    /** Returns the customer with the given [id], or `null` if none exists. */
    fun findById(id: String): Customer?

    /**
     * Returns the customer registered under [email], or `null` if no
     * account uses that address. Lookup is expected to be case-insensitive,
     * matching how most email providers treat the local part.
     */
    fun findByEmail(email: String): Customer?

    /** Returns every registered customer. */
    fun findAll(): List<Customer>

    /**
     * Persists [customer], overwriting the existing record with the same
     * id. Unlike [findById] and [findByEmail], this is not a pure read —
     * it exists specifically so loyalty-program use cases (such as
     * [PromoteCustomerTier][bench.domain.usecase.PromoteCustomerTier]) can
     * save a tier change without reaching into account-management
     * internals that are otherwise out of scope here.
     */
    fun save(customer: Customer): Customer
}
