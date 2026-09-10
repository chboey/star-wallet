# Per-goal Star contributions

Goals begin with zero allocated Stars, even when the child already has a STAR balance. A child
explicitly adds whole Stars to a selected goal before requesting redemption.

## Accounting

- `allocatedStars(goalId)` records the Stars assigned to one goal.
- `reservedStars(childId)` is the sum reserved across that child's active goals.
- `availableStars(childId)` is the child's balance minus all reservations.
- Contributions reserve existing STAR; they do not transfer or burn it.
- A redemption can be requested only when the goal is fully allocated.
- Approval burns the goal allocation.
- Rejection, child cancellation, or goal cancellation releases the allocation.

This prevents one STAR balance from funding multiple goals while keeping the tokens in the child's
non-transferable account until a parent approves redemption.

## Compatibility

`goalContributionsVersion()` identifies deployments that require explicit per-goal contributions.
