# Per-goal Star contributions

This change is implemented in source; it does not upgrade an existing deployment.

## Accounting

- New goals start with `allocatedStars(goalId) == 0`, even when the child already owns Stars.
- Only the registered child's wallet can call `addStarsToGoal(goalId, amount)`. Smart accounts expose that exact method through the existing EntryPoint/passkey authorization path.
- Each positive whole-Star contribution increases the goal's allocation and the child's aggregate `reservedStars`. It neither transfers tokens nor withdraws family savings.
- Contributions cannot exceed the remaining target or `balanceOf(child) - reservedStars(childId)`. Different goals therefore cannot spend the same Stars.
- `requestRedemption` requires the goal's own allocation to equal its target. The request does not reserve Stars a second time.
- Approval consumes that allocation, releases the reservation and burns the Stars, then completes the goal. Rejection or child cancellation clears the allocation and releases Stars without burning. Parent cancellation of a partially funded goal also releases its allocation; a pending claim must be resolved first.

`GoalStarsAdded` supplies the exact delta and new goal total to the subgraph. The indexed `Goal.allocatedStars` and `Child.reservedStars` must come from these events, not from a UI estimate. The activity feed uses the goal's saved artwork for contribution events too.

## UI and compatibility

Ongoing goals open the shared contribution sheet from kid Home and Dreams. It shows only available Stars, a count control and the purple Add button. Ready and completed goals keep their claim/status flow.

The sheet checks the immutable goal contract and both `goalContributionsVersion()` markers at one fresh block before offering a contribution. Unsupported existing accounts cannot sign the new action. Backend simulation and frontend intent validation pin the child, goal, exact amount, network and zero native value.

Successful contributions refresh live goal state. Confirmed block-pinned data temporarily supplies progress and available Stars until the indexer catches up; it never overwrites the indexed snapshot. There is no background polling or automatic write retry.

## Deployment requirements

1. Build and test contracts (`node scripts/compile.mjs`, `forge test`, `npm run test:scripts`), backend, frontend and subgraph.
2. Plan the testnet migration **before broadcasting**. `StarGoals`, `StarChildAccount` and its factory use immutable addresses/code. Existing child accounts cannot be repointed to the new goal contract by changing environment variables. Existing balances, pending redemptions, credentials and active savings positions require an explicit migration decision; no migration or automatic recreation is included here.
3. Deploy the compatible goal/account contracts and wire token roles and registry/account bindings together. The current deployment script creates a new protocol deployment; it is not an in-place upgrade. Do not blindly run it against an existing family expecting its balances or Aqua position to migrate.
4. Configure and deploy the updated subgraph against the compatible deployment's start blocks, then let it index. These new mappings require contribution history before a redemption; do not point them at a legacy deployment where redemption itself reserved Stars.
5. Update the verified backend deployment addresses, code hashes and subgraph deployment ID together, restart the backend, and onboard/migrate only according to the approved migration plan. Old graph schemas remain readable during rollout, but absent allocation data never makes a goal automatically funded.

No deployment, `.env` edit, live transaction, balance migration, passkey replacement or Aqua-position change is performed by this source change.
