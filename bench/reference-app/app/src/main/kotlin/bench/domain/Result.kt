package bench.domain

sealed interface Result<out T> {
    data class Success<T>(val value: T) : Result<T>
    data class Failure(val error: DomainError) : Result<Nothing>
}

sealed interface DomainError {
    val message: String
}

data class ValidationError(override val message: String, val field: String) : DomainError

data class NotFoundError(override val message: String, val id: String) : DomainError

inline fun <T, R> Result<T>.map(transform: (T) -> R): Result<R> = when (this) {
    is Result.Success -> Result.Success(transform(value))
    is Result.Failure -> this
}
