# Clean

caps:    max_total_cost_usd=0.60
1. Maintain a running total. Initialize `CONTEXT.running_cost_usd = 0`,
⚠️ `total_cost_usd` is NOT what the cost cap gates on, and the two legitimately disagree.
Read `cost_usd` from the phase entry that `phase-cost` wrote.
The report renders `cache_hit_ratio` beside the cap verdict.
"total_cost_usd": 16.87,
