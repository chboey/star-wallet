# Star Subgraph

This custom Sepolia Subgraph is Star Wallet's primary indexed read model.

Quests and Star requests are indexed through a `StarQuestsTemplate` discovered
from each new vault's `quests()` address. IDs are workflow-address + local ID;
approved requests link to the existing vault-scoped `Reward`. Workflow handlers
never alter STAR balances: only the token Transfer handler does that. Redeploy
the updated subgraph against the fresh Star deployment; no extra source address
or environment field is required.
It reconstructs:

- families, pending/accepted/cancelled child registrations, child smart
  wallets, and human-readable ENS names with their nodes;
- zero-decimal STAR issuance, balances, reservations, and burns, with token
  `Transfer` events as the balance authority;
- goals and the full redemption state machine;
- factory-created per-family vaults, rewards, principal contributions, and
  independent withdrawals;
- family savings accounts, net principal, asset withdrawals, strategy bounds,
  and historical Aqua positions;
- Aqua `Shipped`, `Pushed`, `Pulled`, `Docked`, and SwapVM `Swapped` executions;
- each family vault's Aqua pause state and emergency administrator, plus
  protocol-wide vault and paused-vault counts.

The factory data source creates a `StarFamilyVaultTemplate` data source for
every `FamilyVaultCreated` event. Singleton Aqua and SwapVM data sources accept
events only when the maker is one of those factory-registered vaults. Aqua
events emitted inside a vault's `ship` call arrive before the vault's position
event, so the mappings temporarily queue those executions by strategy hash and
link them to the family position once it is created.
The lookup key is `maker || strategyHash`, not the hash alone: Aqua hashes the
strategy bytes, so two family vaults can legitimately ship identical bytes.
Each position stores separate opening, current, and closing USDC/WETH amounts.
The factory snapshots each vault's USDC/WETH token addresses. Aqua `Pushed`
and `Pulled` events update the corresponding current balance directly, without
an RPC read of whichever position happens to be active at the end of the block.
`Swapped` is execution history only; counting its amounts again would double-count
settlement. Initial ship allocations are already included in the opening snapshot.
When a new vault template processes its creation block after the singleton
handlers, queued balance changes after the opening event's sequence are replayed
exactly once. This also handles direct pushes, docking and replacement in that block.

## Configure and build

```sh
cp -n .env.example .env
npm install
npm run configure:sepolia
npm run codegen
npm run build
```

After `contracts/scripts/deploy.mjs` succeeds, `configure:sepolia` automatically
loads `../deployments/sepolia.json`; copying addresses by hand is unnecessary.
`DEPLOYMENT_FILE` can select a different manifest, and explicit environment
variables override manifest values. Manifests from other networks are rejected.
The Aqua and SwapVM data sources start at their own deployment blocks; their handlers
discard events whose maker is not a factory-created Star family vault.
The STAR token data source must start at the token deployment block so its
mint/burn ledger cannot miss an earlier balance change.

## Deploy

Create a Subgraph Studio project and fill `contracts/subgraph/.env`:

```dotenv
SUBGRAPH_DEPLOY_KEY=YOUR_DEPLOY_KEY
SUBGRAPH_SLUG=YOUR_SUBGRAPH_SLUG
```

Keep the deploy key out of `.env.example` and source control. Then run:

```sh
npm run auth:studio
npm run deploy:studio
```

Both commands load `.env` automatically. `auth:studio` saves the key in the
standard Graph CLI configuration; `deploy:studio` uses the current `.env` key
directly and configures the Sepolia sources before deploying. Missing/invalid
values stop the command without prompting for credentials. Deployment still
prompts for a version label (for example, `0.0.1`).

Set the resulting query URL as `STAR_SUBGRAPH_URL` and the exact deployment CID
shown by `graph deploy` / Studio as `STAR_SUBGRAPH_DEPLOYMENT_ID` in the backend.
The CID is not the project slug or numeric Subgraph ID. Update it whenever you
deploy a new version; the backend rejects responses from any other deployment.
The backend only forwards indexed reads; it does not duplicate this state in
a database.

## Read/write boundary

The Subgraph is an eventually consistent read model. Use it for family and
child dashboards, goals, rewards, redemptions, savings positions, and activity
history. Every consumer must inspect `_meta.hasIndexingErrors` and compare
`_meta.block.number` with a trusted Sepolia RPC head; the backend performs both
checks, pins `_meta.deployment`, verifies the RPC chain ID and indexed block hash, and returns the
indexing metadata with read responses. Deploy a fresh Sepolia Subgraph; do not
reuse another network's index or copy its entity data.

Do not use the Subgraph as the authority for a transaction preflight. Current
roles, pause state, allowances, balances required by a write, oracle
state, nonce, gas, simulation, transaction submission, and receipts
must come from Sepolia RPC and the contracts. After a receipt succeeds, either
show an optimistic pending state or wait until the Subgraph's `_meta` block is
at least the receipt block before treating the indexed view as synchronized.

## Validation and regression tests

`npm run check` regenerates entity/ABI types, compiles every mapping, validates
all checked-in and backend GraphQL operations against an offline API schema
derived from `schema.graphql`, and runs both query and compiled mapping tests.
The API derivation supports this project's object/enum entity model and rejects
unsupported features. It checks fields, arguments, enums and variable types—not
only GraphQL syntax. Singular lookups take `ID!`; relationship filters take
`String`, while actual `Bytes` scalar fields keep `Bytes` filters.

`npm run test:queries` exercises schema validation. `npm run test:mappings` runs
Matchstick 0.6.0 against the actual AssemblyScript handlers, with a mocked store
and immutable factory getters. It covers new-template event ordering, opening
allocations, swaps in both directions, direct pushes, dock/replacement, token
ordering, maker/hash isolation, registration retries, STAR mint/burn history and
redemption approval/rejection/cancellation. The first run downloads the pinned Matchstick
binary; use a supported macOS or Ubuntu 22/24 environment. These are unit tests,
not proof that a live Graph Node has successfully indexed a deployment.

After deploying, also validate against the actual endpoint via introspection:

```sh
npm run validate:queries -- --endpoint <SUBGRAPH_QUERY_URL>
```

Then run the lifecycle against small Sepolia test balances and compare indexed
balances at the receipt block with the contracts. This update adds required
`FamilyVault.usdc` and `FamilyVault.weth` fields and changes balance accounting:
deploy a new version and fully reindex from the configured deployment blocks.
Do not graft an old index or treat this as an in-place database migration.

## Deployment readiness

The checked-in zero addresses and block zero are build placeholders, not a
deployable configuration. `deploy:studio` runs the same source configuration as `configure:sepolia` and
refuses missing, zero or duplicate addresses, invalid blocks, and manifests for
another chain or WETH. Deploy the contracts first, preserve their manifest,
configure the sources, then deploy this existing custom Subgraph—do not run
`graph init` over these mappings.

Studio deployment is sufficient for a rate-limited Sepolia development demo;
publishing to the decentralized Graph Network is a separate, optional on-chain
step. The Graph's protocol publishing network is not the chain being indexed.
See [The Graph quick start](https://thegraph.com/docs/en/subgraphs/quick-start/).
