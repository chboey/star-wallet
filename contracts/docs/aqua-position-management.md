# Managing an existing Aqua position

## Close: supported and wired in the UI

`StarFamilyVault.dockSavingsPosition()` is a parent-only exit. It reads Aqua's **current** balances, docks the strategy, and makes those USDC/WETH amounts available in the same family vault. It does not transfer savings to the parent or mint/burn Stars. Closing remains possible while the family is inactive or Aqua is paused.

The parent on-chain-details options menu opens the Close confirmation. The UI checks the selected vault/strategy against fresh on-chain state, validates one exact zero-value parent dock intent, and simulates it before signing. The purple button spins throughout submission and confirmation; full copyable transaction hashes appear in a light purple panel above Done only after successful completion. The live position query is invalidated after confirmation, separately from subgraph indexing.

The existing dock method takes no strategy hash argument: it closes whichever strategy is active when the transaction executes. The UI detects changes before signing and prevents duplicate submissions, but cannot impose a new on-chain expected-hash condition on this immutable contract. Avoid concurrently replacing the position from another session while a close is pending.

## Add: the funding source matters

| Source of additional tokens | Current capability |
| --- | --- |
| Parent's wallet | Aqua's `push(maker, app, strategyHash, token, amount)` transfers new tokens from the caller to the vault and increases the existing position allocation. It requires a token approval to Aqua and keeps the strategy hash. |
| Already available inside the family vault | The new `addToSavingsPosition(expectedStrategyHash, usdcAmount, wethAmount)` method reallocates available USDC/WETH into the same strategy. This requires the updated vault deployment; old vaults do not acquire the method automatically. |
| Replacing the position | `replaceSavingsPosition` docks and ships in one transaction. It can allocate returned inventory plus idle vault funds, but creates a **new strategy hash**; it is not a same-position top-up. |

A direct parent-wallet Aqua push does not emit the vault's `PrincipalContributed` / `StarsRewarded` events, mint Stars, or increase `totalPrincipalContributed`. Any UI for this path needs to distinguish it from rewarding Stars and use current Aqua holdings rather than opening allocations.

## Vault-funded top-ups

The parent on-chain-details menu offers **Add into existing position** and **Close position**. Add reuses the Choose amounts → Review → Success popup. It reads available vault balances and remaining capacity using **current Aqua holdings**, not opening amounts. One token or both may be added; the total must be nonzero. An active position alone never counts as a successful top-up.

`POST /v1/intents/savings/add` takes `familyId`, `expectedStrategyHash`, `usdcAmountUnits` and `wethAmountUnits` (base-unit decimal strings). It resolves the vault through the configured factory and prepares exactly one zero-value parent call. The frontend checks `savingsTopUpsVersion() == 1`, pins the reviewed vault/hash/amounts, rejects additional or altered calls, re-reads state and simulates the parent call before signing. The contract remains the authority when the transaction executes.

The contract requires an active family, its registered parent, unpaused Aqua, the expected active strategy hash, an unexpired deadline, fresh oracle prices satisfying the stored range, enough available inventory, and current holdings plus additions within the position caps. It deducts the available amounts before calling Aqua's `push` for each nonzero token. A failed push reverts both allocations atomically.

Aqua is non-custodial. A vault-initiated `push` performs `transferFrom(vault, vault, amount)` using the vault's existing Aqua allowance: physical token holdings stay unchanged, while Aqua's virtual position balance increases. There is no additional wallet deposit, approval, Star mint/burn, or principal contribution. The original opening balances, fee, range, salt, hash and deadline are unchanged. Adding only one token can shift the trading price within the existing range; top-ups do not reset the price or renew expiry. Expired positions must be closed and a new strategy created.

`SavingsPositionToppedUp(familyId, strategyHash, usdcAmount, wethAmount)` is emitted after Aqua's `Pushed` logs. The subgraph's Aqua handler credits current position holdings; the vault handler **only debits available balances**, preserves opening/principal figures, and records a `SAVINGS_POSITION_TOPPED_UP` activity. Same-block template replay is covered by mapping tests. The UI refreshes live position reads after confirmation independently of indexing delay.

The purple action spins throughout submission/confirmation. Actual full transaction hashes appear in a light purple panel above the purple success button only after the entire action completes successfully. Pending and failed actions do not display transaction details; broadcast hashes remain tracked internally. No placeholder hashes are shown.

## Rollout boundary

These changes are source/build artifacts only. No contracts were deployed and no live approval, transfer, top-up or close was performed. Existing family vaults are immutable and the factory permits one vault per family: editing source or updating the ABI does not upgrade them. A separately planned deployment/migration and matching subgraph rollout are required. Do not repoint the app to new contracts or abandon old vault funds without an explicit migration plan. Old vaults can still be viewed and closed; Add reports that the updated vault is required.

Local verification includes real-Aqua self-push and close tests, single-token/repeated additions, ownership and child-selector rejection, pause/inactive/expiry/oracle/amount/cap failures, atomic rollback, backend intent validation, indexer replay/accounting, and frontend amount, signing-plan, spinner and transaction-hash rendering tests.
