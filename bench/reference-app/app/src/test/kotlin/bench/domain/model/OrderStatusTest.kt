package bench.domain.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class OrderStatusTest {
    @Test
    fun `isTerminal is true for delivered, cancelled and archived`() {
        assertTrue(OrderStatus.DELIVERED.isTerminal())
        assertTrue(OrderStatus.CANCELLED.isTerminal())
        assertTrue(OrderStatus.ARCHIVED.isTerminal())
    }

    @Test
    fun `isTerminal is false for the in-flight statuses`() {
        assertFalse(OrderStatus.PENDING.isTerminal())
        assertFalse(OrderStatus.CONFIRMED.isTerminal())
        assertFalse(OrderStatus.PROCESSING.isTerminal())
        assertFalse(OrderStatus.SHIPPED.isTerminal())
    }

    @Test
    fun `pipeline statuses can only move to the next step`() {
        assertTrue(OrderStatus.PENDING.canTransitionTo(OrderStatus.CONFIRMED))
        assertFalse(OrderStatus.PENDING.canTransitionTo(OrderStatus.SHIPPED))
    }

    @Test
    fun `any non-terminal status can move to cancelled`() {
        assertTrue(OrderStatus.PENDING.canTransitionTo(OrderStatus.CANCELLED))
        assertTrue(OrderStatus.CONFIRMED.canTransitionTo(OrderStatus.CANCELLED))
        assertTrue(OrderStatus.SHIPPED.canTransitionTo(OrderStatus.CANCELLED))
    }

    @Test
    fun `delivered or cancelled can move to archived`() {
        assertTrue(OrderStatus.DELIVERED.canTransitionTo(OrderStatus.ARCHIVED))
        assertTrue(OrderStatus.CANCELLED.canTransitionTo(OrderStatus.ARCHIVED))
        assertFalse(OrderStatus.SHIPPED.canTransitionTo(OrderStatus.ARCHIVED))
    }

    @Test
    fun `archived never transitions anywhere, not even to itself`() {
        assertFalse(OrderStatus.ARCHIVED.canTransitionTo(OrderStatus.PENDING))
        assertFalse(OrderStatus.ARCHIVED.canTransitionTo(OrderStatus.ARCHIVED))
    }

    @Test
    fun `delivered and cancelled cannot move anywhere except archived`() {
        assertFalse(OrderStatus.DELIVERED.canTransitionTo(OrderStatus.CANCELLED))
        assertFalse(OrderStatus.CANCELLED.canTransitionTo(OrderStatus.CONFIRMED))
        assertFalse(OrderStatus.CANCELLED.canTransitionTo(OrderStatus.PENDING))
    }

    @Test
    fun `isActive is the opposite of isTerminal`() {
        assertTrue(OrderStatus.PROCESSING.isActive())
        assertFalse(OrderStatus.ARCHIVED.isActive())
    }

    @Test
    fun `customerFacingLabel gives every status a readable label`() {
        assertEquals("Order received", OrderStatus.PENDING.customerFacingLabel())
        assertEquals("Being prepared", OrderStatus.PROCESSING.customerFacingLabel())
        assertEquals("On its way", OrderStatus.SHIPPED.customerFacingLabel())
        assertEquals("Delivered", OrderStatus.DELIVERED.customerFacingLabel())
    }

    @Test
    fun `customerFacingLabel covers cancelled and archived too`() {
        assertEquals("Cancelled", OrderStatus.CANCELLED.customerFacingLabel())
        assertEquals("Closed", OrderStatus.ARCHIVED.customerFacingLabel())
    }

    @Test
    fun `stepsUntilDelivered counts down to zero at delivered`() {
        assertEquals(4, OrderStatus.PENDING.stepsUntilDelivered())
        assertEquals(1, OrderStatus.SHIPPED.stepsUntilDelivered())
        assertEquals(0, OrderStatus.DELIVERED.stepsUntilDelivered())
    }

    @Test
    fun `stepsUntilDelivered is null for statuses off the normal pipeline`() {
        assertNull(OrderStatus.CANCELLED.stepsUntilDelivered())
        assertNull(OrderStatus.ARCHIVED.stepsUntilDelivered())
    }
}
