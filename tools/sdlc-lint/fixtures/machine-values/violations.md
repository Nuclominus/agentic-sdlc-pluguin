# Violations

  - `cost_usd = (input_tokens - cached_input_tokens)/1e6 * P.input`
- `total_input_tokens` = sum of phase `input_tokens`.
- `total_cost_usd` = **sum of phase `cost_usd` PLUS overhead**
- `cache_hit_ratio` = `total_cached_input_tokens / max(total_input_tokens, 1)`
- `total_cost_usd` is the sum of every priced phase
- `cost_usd` computed from the registry pricing
