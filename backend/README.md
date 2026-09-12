# Star protocol utility API

The backend is non-custodial and required by the current frontend, though the
contracts do not depend on it for authorization. The Graph is the indexed read
model; parent/emergency wallets sign transactions and child passkeys sign
UserOperations. The API holds no signing key or protocol ledger. It forwards
scoped child operations to the configured bundler/paymaster.

Child sponsorship now uses a small **persistent operational security ledger**, not a
protocol/family database. Node >=22.13 is required. In development it lives at
`backend/.security/child-limits.sqlite` (gitignored); in production configure
`CHILD_SECURITY_DB_PATH` as an absolute path on a persistent local volume. All workers
on the same host must share that file. Do not deploy independent ephemeral/serverless
copies; distributed hosts need a shared transactional implementation first.

The ledger enforces per-account request rates, rolling sponsored-operation counts,
and conservative per-account/global gas budgets before sponsorship data is returned.
Retries with the same account/nonce share the highest reserved cost. Errors are 429
with `Retry-After`, or 503 if safety storage cannot be used. Limits never expire parent
approval. Defaults and limitations (including external bundlers and unsigned quote
denial-of-service) are documented [below](#browser-and-sponsorship-security)
and in `.env.example`. Also configure provider-side global spending caps; local quote
reservations are not a reconciliation of the provider's settled bill.

## Browser and sponsorship security

The authorization flow is unchanged: Papa's approval lasts until revocation or lost/
unusable device authorization. No daily authentication timer was added. A usage-limit
error never deletes the saved key or opens a new approval prompt. Read-only browsing,
receipt polling and parent financial transactions are excluded from child allowances.

- The frontend uses fresh 256-bit script nonces, `strict-dynamic`, no inline event
  handlers and no production `unsafe-eval`. HTML is dynamically rendered and marked
  private/no-store; do not override that with CDN HTML caching. This follows
  [Next's nonce-based CSP guidance](https://nextjs.org/docs/app/guides/content-security-policy).
- Connections are restricted to the app and configured browser RPC origin. Fonts and
  illustrations are local. Framing, objects and base-URL injection are blocked. The
  Permissions Policy retains same-origin passkeys and disables camera/microphone/
  geolocation. Development-only eval/WebSocket permissions support HMR; inline styles
  remain permitted for React animations, **not** inline scripts. Only injected wallets
  are configured today; adding embedded wallets or WalletConnect needs a policy review.
- The API proxy rejects cross-site Fetch Metadata on writes. ESLint rejects unsafe
  HTML rendering, direct HTML insertion, eval/string timers, dynamic Function creation
  and JavaScript URLs. A targeted source scan found no such injection sinks or app
  postMessage handlers; user descriptions/names render as React text or controlled
  inputs. Both FE and BE `npm audit` checks reported zero known advisories at verification.
  Recheck before releases; this is not a complete security audit. As
  [OWASP notes](https://cheatsheetseries.owasp.org/cheatsheets/Content_Security_Policy_Cheat_Sheet.html),
  CSP is defense in depth, not protection from already-trusted malicious scripts.
- Each canonical child account gets **60 operation RPCs/minute and 360/hour**, across
  IPs and devices, plus existing IP limits. Gas preparation uses multiple RPCs per action.
  The service additionally caps recorded account RPCs at 10,000 per rolling hour.
- Defaults allow **60 sponsored nonces / 0.05 test ETH** in maximum gas reservations
  per child per rolling 24 hours; globally **600 nonces / 0.5 test ETH**. These are
  configurable safety limits, not charges, USDC deposits, Star limits or auth expiry.
- Both paymaster stages, including `isFinal` stub responses, reserve budget before
  data reaches the client. Direct submission is also checked. Requotes/retries of one
  account/nonce share its highest reserved cost: EntryPoint permits only one execution
  of that nonce. All five v0.8 gas fields times `maxFeePerGas` are counted. Missing fields
  use existing caps rather than zero. Reservations last 24 hours after their most recent
  issue and are not refunded on failure because an earlier quote may still be usable.
- Atomic SQLite transactions persist counters across restarts and serialize workers
  using the same local file. Storage failures stop requests with 503; there is no
  in-memory fallback outside tests. The file contains addresses, nonces, timestamps
  and reserved gas costs—no keys, proofs, PINs, descriptions, or family balances.

These limits cover the app backend/sponsorship channel, not independently funded
external bundlers. The contract's existing child-only permission allowlist remains
authoritative and unchanged. During unsigned gas preparation, canonical-account
checks are not proof of device possession, so targeted quota exhaustion remains a
denial-of-service risk. Keep provider credentials private and configure independent
provider-wide spending caps. This ledger limits **quote issuance**, not the provider's
precise daily settled bill: quotes may execute later and maximum reservations exceed
actual fees. It assumes the trusted paymaster binds quotes to operation gas/fee limits.

Run FE/BE tests/builds/lint, `npm --prefix frontend run test:security` after the FE
production build, and `npm --prefix backend run test:parent-auth:integration`. The HTTP
smoke test checks nonces/script tags/no-store headers, not browser execution. The local
Anvil interoperability test checks real WebCrypto signatures and revocation without
remote transactions. A connected real browser/wallet/passkey test is still required
before release. No contracts, registered parent passkeys or saved grants were changed.

Configuration uses `STAR_FAMILY_VAULT_FACTORY_ADDRESS`. For every vault write,
the API resolves `vaultByFamily(familyId)` from the live factory, verifies the
vault's family ID, reverse registration, bytecode, dependency wiring, STAR
role, emergency administrator, and Aqua allowance state, then encodes the
per-family vault ABI. It never accepts or configures one shared vault.
It requires the Sepolia manifest's runtime hashes for Registry, Token, Goals,
Vault Factory, Child Account Factory, Aqua and SwapVM in every environment, and pins the Sepolia test
USDC, WETH and Chainlink addresses. Both router dependencies are verified.

## Run and verify

The development API binds to `127.0.0.1:3000`; the frontend runs on `:3001`
and proxies its API requests server-side. Set `HOST=0.0.0.0` explicitly when
required by your container/reverse-proxy deployment. The API environment never
needs signing keys or 1inch API/SDK credentials.

`.env.example` leaves Aqua/router and core deployment fields blank. There is no
implicit legacy Aqua/router fallback. Blank fields inherit a configured
deployment manifest; nonempty environment values override the manifest. With
neither present, deployment-dependent operations fail as unconfigured. Deploy
the unchanged Aqua/router copies and new Star contracts using the contracts'
Sepolia scripts, then load `../contracts/deployments/sepolia.json`. Addresses
alone are not sufficient: the recorded runtime hashes must match on-chain code.

```sh
cp .env.example .env
npm install
npm run build
npm run lint
npm run dev
```

Swagger UI is available at `http://localhost:3000/docs`. `GET /health` is a
liveness check; `GET /ready` verifies the Sepolia core/factory wiring, roles,
pinned dependencies, ENS access, Subgraph identity/indexing, and Chainlink pricing
feed freshness, plus bundler chain/EntryPoint support. Paymaster configuration
alone does not prove that its policy is funded. All RPC checks require Ethereum Sepolia (11155111); L1 has no
sequencer feed. ENS also uses `SEPOLIA_RPC_URL`, with the pinned official
Sepolia ENSv2 registries, factory and Universal Resolver. You must control the
configured parent namespace on Sepolia, independently of mainnet ownership.
ENS readiness requires an attached, verified child registry and the deployed family
registrar's registration permission. ENS reads and manual namespace preparation work
independently of Star; public family claims require `StarEnsRegistrar` from the manifest.
The deployer completes operator setup before parent onboarding. Use `/health` for
liveness and require `/ready` HTTP 200 after all deployment/configuration steps.

Configure `CHILD_ACCOUNT_RP_ID` through the deployment manifest and set server-only
`CHILD_BUNDLER_RPC_URL` / `CHILD_PAYMASTER_RPC_URL` / `CHILD_PAYMASTER_POLICY_ID`. All
three are required for child sponsorship. Both `pm_getPaymasterStubData` and
`pm_getPaymasterData` receive a server-owned `{ policyId }` context, following
[Alchemy's ERC-7677 API](https://www.alchemy.com/docs/wallets/api-reference/gas-manager-admin-api/gas-abstraction-api-endpoints/pm-get-paymaster-data).
Client policy, webhook and token-payment overrides are rejected; signed submissions
are forwarded unchanged. The policy ID is not included in public configuration/readiness
responses. Child passkeys remain required for submission; policy sponsorship only covers gas.

Passkey gas estimation uses the bundler's estimate plus a measured full-validation
delta from the deployed account. `SEPOLIA_RPC_URL` must support `eth_call` state
overrides and native P256 (available on Sepolia). A simulation-only probe substitutes
EntryPoint code in two read-only calls; account code/storage are never overridden.
Both probe signatures must remain invalid. The probe is never deployed, sponsored,
or submitted. Unsupported measurements fail closed; there is no fixed-gas fallback.
The frontend requests final sponsorship and the real passkey signature only after
the corrected gas values are ready. No existing account or contract redeployment is needed.

Important unsigned-intent routes include:

- `POST /v1/intents/families` and `/v1/intents/families/vault`
- `POST /v1/intents/children/account` (parent deploys the passkey account)
- `POST /v1/intents/children`, `/v1/intents/children/registration/cancel`, and
  `/v1/intents/children/registration/reject`
- `POST /v1/intents/rewards`
- `GET /v1/families/:familyId/inbox?view=available|waiting|history&childId=...&first=50&skip=0`
- `POST /v1/intents/quests/{create,cancel,submit,request,cancel-request,approve,reject}`
- `POST /v1/intents/goals` and `/v1/intents/goals/cancel`
- `POST /v1/intents/redemptions/{request,cancel,approve,reject}`
- `POST /v1/intents/savings/{withdraw,withdraw-weth,fund-weth,ship,replace,dock}`
- `POST /v1/intents/savings/aqua-pause` (requires `familyId`)

Every returned intent declares the wallet role that must sign it.
`POST /v1/child-accounts/rpc` forwards only the supported child ERC-4337 / ERC-7677
methods. Public account metadata/configuration is under `/v1/child-accounts`.

Quest bodies always include `childId`. `create`: `stars`, `text` (64 UTF-8 bytes).
`request`: `stars`, `text` (128 bytes), nonzero bytes32 `submissionId`.
`submit`: `id`, `submissionId`. `approve`: `id`, expected `stars` (checked against RPC).
`cancel`, `cancel-request`, `reject`: `id`. IDs/amounts are decimal strings;
quest/request IDs are local to the child's family workflow. Reuse submission IDs on retries.

Inbox reads come from the subgraph with existing freshness/deployment checks and
pagination. Write preparation reads the canonical vault/request from RPC. A request
is approved only by a successful parent-signed vault transaction that consumes it,
transfers USDC and mints Stars atomically. The API does not record approval in a
database. New child selectors share one strict calldata allowlist across BE/FE.
Use the new Star deployment and updated subgraph; no additional `.env` fields.

## ENSv2 subdomains

The [ENS deployment documentation](https://docs.ens.domains/learn/deployments/)
lists Sepolia as ENSv2 Beta. This integration pins the official deployment at
`ensdomains/contracts-v2@97a57293f3b4279d94b571e678edb53ce62638f4` in
`contracts/network.js`. No ENS SDK or modified ENS contracts are needed.
Remove obsolete `ENS_REGISTRY_ADDRESS`, `ENS_NAME_WRAPPER_ADDRESS`,
`ENS_PUBLIC_RESOLVER_ADDRESS` and `ENS_PARENT_WRAPPED` settings: startup rejects
them rather than silently mixing v1 registration with v2 resolution.

- `GET /v1/ens/namespace?name=starwallet.eth`: current owner, ancestor-bounded
  expiry, registry, token ID, child registry, setup requirement and checked block.
- `POST /v1/ens/namespace`: `{ "signer": "0x...", "name": "starwallet.eth" }`.
  `name` defaults to `ENS_PARENT_NAME`. The current namespace owner must sign
  initial setup: deploy a UserRegistry proxy, set its parent, attach it, then grant
  only `ROLE_REGISTRAR` to the manifest-pinned `StarEnsRegistrar`.
- `POST /v1/ens/families`: `{ "signer": "0x...", "label": "tan", "secret": "0x..." }`.
  The parent signs a commitment, then a claim after at least 10 seconds. `secret`
  is a random nonzero 32-byte reveal secret, not a wallet key; retain it across retries.
  The claim atomically creates the family registry/resolver, assigns name ownership
  and resolution to the signer, and gives that parent control of nested child names.
  No caller-selected recipient, root authority or backend signing key is accepted.
- `POST /v1/ens/subdomains`: prepare setup if necessary, then deploy a dedicated
  PermissionedResolver proxy and register the name in its parent's UserRegistry.
- `GET /v1/ens/resolve?name=maya.starwallet.eth&expectedAddress=0x...`:
  verify the final ETH address through Sepolia's Universal Resolver.

Example registration body (replace the example addresses):

```json
{
  "parentName": "starwallet.eth",
  "label": "maya",
  "signer": "0x1111111111111111111111111111111111111111",
  "owner": "0x2222222222222222222222222222222222222222",
  "address": "0x3333333333333333333333333333333333333333"
}
```

`signer` must hold registrar permission in the namespace. `owner` receives the
name NFT and resolver control; `address` is the ETH resolution record, which
can be a child's smart wallet while the guardian retains ownership. A contract
chosen as `owner` must accept ERC-1155 tokens. `expiresAt` optionally supplies
Unix seconds as a decimal string; the default is the earliest ancestor expiry.
Nested parents must stay inside the configured namespace and already exist.

Each response is either `READY` with no transaction, or `TRANSACTION_REQUIRED`
with one simulated `{ chainId, from, to, data, value: "0" }` transaction and a
`step`. Switch the wallet to Sepolia, enforce **exact `from`**, review and sign
only that transaction, wait for a successful receipt, and repeat the same POST.
Do not send concurrently or cache calldata for later signing. Re-simulate before
sending: on-chain ownership, expiry and permissions can change after preparation.
The factory's CREATE2 address depends on the signer. An exact completed retry
returns `READY`; conflicting ownership, resolution or expiry returns 409.
Partial setup is resumable. Preparation does not reserve a name or guarantee mining.

The ENS API never broadcasts or holds wallet keys. Ordinary parents sign through
the root-owner-authorized registrar, never directly as administrators of
`starwallet.eth`. Family labels are canonical ASCII (2–63 lowercase letters,
digits and interior hyphens); existing/reserved names cannot be overwritten.
Commitments bind the chain, registrar, namespace, label, parent and secret, expire
after one day, and cannot be reset while live. A copied reveal cannot claim for
another wallet. This is free, first-come registration, not proof of a real surname
or Sybil resistance. Root owners can revoke registrar permission to stop new claims.
The family endpoint can also return `WAITING` with `readyAt` Unix seconds; it never
asks a parent to authorize the root registrar. The frontend persists the secret,
validates claim calldata and resumes from confirmed on-chain state.
For guardian-managed names, use the guardian as `owner`. When transferring a
name later, also transfer its resolver permissions or replace the resolver;
PermissionedResolver control does not automatically follow the NFT. Similarly,
a parent-name transfer does not transfer an attached child registry's root roles.
This API deliberately does not transfer, renew or overwrite existing identities.
Offchain-only resolution is not supported (CCIP Read is disabled on the API).

One-time operator setup uses the existing `DEPLOYER_PRIVATE_KEY` in `contracts/.env`
and the generated Star manifest. No additional private key or environment file.
The deployer must own the configured second-level `.eth` name on Sepolia.

```sh
# From the repository root: first inspect the next unsigned step.
npm --prefix contracts run preflight:ens:sepolia
# Broadcast the one-time operator setup with the deployer.
npm --prefix contracts run setup:ens:sepolia
```

Preflight prints only the next currently simulatable step. Setup waits for two
confirmations between steps and safely resumes after interruption. These commands
are operator setup, not an onboarding/demo runner. The HTTP server never loads
the deployer key. Registrar address/hash are inherited from the Star manifest.

`SEPOLIA_FORK_RPC_URL=... npm run test:ens:integration` exercises the real
deployed factory/registries/resolvers on a local Anvil fork: bootstrap,
registration, nested names, permissions, expiry validation and idempotent retry.
It sends no public transactions. The Star Subgraph schema is unchanged: Star
events still index ENS strings/nodes; live ENS registration checks use RPC.

## Indexed reads

Indexed read routes used by the frontend are:

- `GET /v1/families/by-parent/:parent` for family discovery;
- `GET /v1/families/:familyId` for the full family dashboard;
- `GET /v1/children/by-wallet/:wallet` for child-wallet family discovery;
- `GET /v1/families/:familyId/activity` for cursor-paginated history;
- `GET /v1/families/:familyId/portfolio` for oracle-valued holdings; and
- `GET /v1/indexing/status` for receipt-to-index synchronization.

`GET /v1/config` supplies the chain ID and ENS parent name; the frontend does not
maintain a separate ENS namespace setting.

Family discovery, family and child reads return `nextOffset`. Continue with
`skip=nextOffset` and `blockHash=indexing.block.hash` until `nextOffset` is null.
The frontend merges these pages at the same verified block. Number-pinned Graph
queries return a null metadata hash, so pagination uses the hash directly.

Activity pagination is ordered by the deterministic event `sequence`. Pass the
returned `nextCursor` as `before`; do not paginate event history by timestamp.

`GET /v1/families/:familyId/portfolio` derives the current USD portfolio value
from indexed Subgraph inventory and the configured Sepolia Chainlink USDC/USD
and ETH/USD proxy feeds. It validates the feed descriptions, positive answers,
decimals, and update age and returns all amounts as integer strings with
explicit decimals. It also identifies the block at which the holdings were
indexed separately from the block used for pricing. This derived view is not a
protocol ledger. `parentWallet` reports the parent's live USDC/WETH balances at
the valuation block; `assets` remains the family vault's indexed inventory.

Subgraph-backed reads reject indexing errors and reject an index more than
`STAR_SUBGRAPH_MAX_BLOCK_LAG` behind the configured Sepolia RPC (20 blocks by
default). Configure both `STAR_SUBGRAPH_URL` and `STAR_SUBGRAPH_DEPLOYMENT_ID`
(the exact deployment CID from Studio, not the slug). Reads fail closed when the
CID is missing or `_meta.deployment` differs, even on the same chain. Update the
expected CID after deploying a new Subgraph version.
Reads also verify the RPC chain ID and compare the indexed block hash
with Sepolia, rejecting a wrong-chain index or unreconciled reorg. That still does
not make the Subgraph transaction-authoritative: all intent preflight and live
contract safety checks use Sepolia RPC. After a confirmed wallet receipt, the
frontend makes at most four lightweight indexing checks (immediately, then
after 2, 4 and 8 seconds), stopping immediately on any error. Once indexed, it
invalidates only the affected family's relevant reads. If indexing has not caught
up, the transaction stays confirmed and related data is marked stale for the next
page entry; the transaction is never automatically resubmitted.

Wallet reads are event-driven: wallet discovery on connection, relevant data on
page/tab/popup entry, pagination on demand, and scoped updates after actions.
There are no recurring Subgraph timers, focus/reconnect refetches, or automatic
read retries. Hidden panels do not fetch. Goal requests and portfolio quotes
load only on pages that use them. Child profiles and Home activity previews
reuse the complete family snapshot instead of querying the same data again.
Changes from another device become visible on the next relevant page entry or
explicit retry, not while an unchanged page sits idle.

The backend coalesces identical concurrent GraphQL requests. HTTP 429 responses
(including plain-text Studio errors) preserve their status and `Retry-After`.
During that cooldown, new reads fail locally without contacting the provider.
There is no scheduled retry; a subsequent requested read can resume afterward.

Oracle fields are read at one explicit Sepolia block, which is also used for
freshness checks and the returned valuation metadata. API error responses keep
client-error HTTP statuses but omit internal upstream failure details.

## SDK-free Aqua connector

All Aqua/SwapVM wire encoding lives in
[`src/services/aqua-connector.ts`](src/services/aqua-connector.ts), using only
viem and bigint. Neither 1inch SDK is installed. `AquaStrategyService` remains
the application layer for validated Chainlink pricing, configuration and salts.
Automated integration tests exercise the same connector for quote/swap calldata
and events without live-account keys.

The connector targets the unmodified SwapVM snapshot
`f09a41e689240adc645934f965c8061749397cd2` and Aqua snapshot
`9c5c42e5840e8741fba3597c48456c9510212b66`. It implements:

- Canonical Aqua orders with sorted token addresses, the 40-byte pair prefix and
  exact hook-free maker traits; hashes cover the complete ABI-encoded order.
- `deadline -> optional input fee -> concentrated swap -> salt`. The new curve
  instruction already executes the swap. Fees use the upstream `1e7` scale
  (`30` user bps encodes as `30_000` in three bytes).
- Three-argument quote/swap calls with directional taker traits, no partial
  fills, no custom recipients/callbacks, and mandatory positive minimum output
  and deadline for swaps. Quotes are simulated with `eth_call`.
- Direct maker ship/dock calls. For Star positions, the signer calls the vault's
  `shipSavingsPosition`/`dockSavingsPosition` instead, preserving its accounting.

Create a connector with explicit `{ aqua, swapVm }` deployment addresses.
`AquaConnector.buildOrder(...)` returns `{ strategy, strategyHash, order, ... }`;
`connector.quote(...)` and `connector.swap(...)` return unsigned `{ to, data,
value }` calls. The connector never submits transactions, holds keys or grants
allowances. Callers must verify deployment bytecode/wiring and simulate against
the intended sender immediately before signing; accepting an address is not
proof of compatibility. No network configuration or key is embedded in it.

Prices are `tokenB base units / tokenA base units * 1e18`, with sorted addresses.
The application pricing layer and vault handle both address orders. Sepolia has
USDC < WETH, so the ratio is `USDC_USD_18 * 1e30 / ETH_USD_18` (5e26 at
2,000 USDC/WETH). The low square root rounds up and the high one rounds down,
keeping the encoded band within the on-chain limits even at that larger scale.

```sh
npm run build
npm test
npm run test:aqua:integration
```

The integration test requires Foundry/Anvil and `npm ci` in `contracts/`. It
starts its own ephemeral localhost chain, uses no environment keys or external
RPC, compares order/taker bytes with the unchanged upstream Solidity builders,
and deploys the real Aqua and AquaSwapVMRouter alongside a Star vault. It tests
both swap directions, slippage/expiry rejection, inventory reconciliation,
pause/revoke, dock and withdrawals. Registry, STAR, token and oracle fixtures
are test doubles; this is not an audit or evidence of a public deployment.

For a read-only Sepolia fork test of both deployment scripts and backend readiness:

```sh
SEPOLIA_FORK_RPC_URL=https://your-sepolia-archive-rpc npm run test:sepolia:deployment
```

This starts localhost Anvil, uses a public test mnemonic only there, writes
manifests to an isolated temporary directory, and sends no public transactions.
