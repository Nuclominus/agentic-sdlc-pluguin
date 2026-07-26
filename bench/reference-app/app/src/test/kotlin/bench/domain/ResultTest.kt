package bench.domain

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ResultTest {
    @Test
    fun `map transforms a success`() {
        val result: Result<Int> = Result.Success(2)
        assertEquals(Result.Success(4), result.map { it * 2 })
    }

    @Test
    fun `map leaves a failure untouched`() {
        val failure: Result<Int> = Result.Failure(ValidationError("bad", "qty"))
        assertTrue(failure.map { it * 2 } is Result.Failure)
    }
}
