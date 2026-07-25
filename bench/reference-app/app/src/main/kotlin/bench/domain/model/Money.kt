package bench.domain.model

@JvmInline
value class Money(val cents: Long) {
    operator fun plus(other: Money): Money = Money(cents + other.cents)
    operator fun times(quantity: Int): Money = Money(cents * quantity)

    companion object {
        val ZERO = Money(0)
        fun ofUnits(units: Long): Money = Money(units * 100)
    }
}
