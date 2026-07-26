Add input validation to the `CreateOrder` use case. Reject an empty customer id, a non-positive
quantity on any order line, and a product id that does not exist in `ProductRepository`. Surface
each failure as a `ValidationError` through the existing `Result` type rather than throwing.
Follow the existing test conventions.
