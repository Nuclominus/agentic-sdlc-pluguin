package shop.payments

import java.util.concurrent.LinkedBlockingQueue

data class PaymentRequest(val orderId: String, val amountCents: Long)

object PaymentQueue {
    private const val MAX_ATTEMPTS = 5
    private val queue = LinkedBlockingQueue<PaymentRequest>()

    fun enqueue(request: PaymentRequest) {
        queue.put(request)
    }

    fun runWorker(provider: PaymentProvider) {
        while (true) {
            val request = queue.take()
            var attempt = 0
            while (attempt < MAX_ATTEMPTS) {
                try {
                    provider.charge(request.orderId, request.amountCents)
                    break
                } catch (e: ProviderUnavailable) {
                    attempt++
                    Thread.sleep(1000L * attempt)
                }
            }
        }
    }
}
