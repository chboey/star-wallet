<img width="1983" height="793" alt="Image" src="https://github.com/user-attachments/assets/bf70c9ec-5c4c-4077-87a6-9ee28efda30b" />


<b>Star Wallet</b> is a family savings app that turns kids' completed tasks into parent-controlled onchain savings, depositing one USDC for every Star a parent awards. It runs on Ethereum Sepolia, uses **1inch Aqua + SwapVM** for programmable savings positions, and uses **The Graph** to turn onchain events into the data shown in the parent and child interfaces.

## Explore Star Wallet

- Try out our app: https://star-frontend-mu.vercel.app

- View [Aqua](https://sepolia.etherscan.io/address/0x38C8c7073cEc4153fA090f819528E69a857f3D90) and [SwapVM](https://sepolia.etherscan.io/address/0x2b893B0B15D71E735BB975daF8ffe26CEC449629) on Sepolia Etherscan
- Review The Graph [schema](contracts/subgraph/schema.graphql), [data sources](contracts/subgraph/subgraph.yaml) and [application queries](contracts/subgraph/queries)

## TL;DR — What is Star Wallet?

Star Wallet helps families turn kids' completed tasks into onchain savings: parents award Stars backed by matching USDC deposits, then manage those savings through 1inch Aqua and SwapVM.

The child sees Stars, quests and goals. A device passkey can sign only those actions; it cannot transfer tokens, withdraw savings, trade assets or call arbitrary contracts. The parent uses a normal Ethereum wallet and retains control over USDC, WETH, savings positions and financial approvals.

When a parent awards five Stars, the same transaction contributes five USDC to the family vault and issues five STAR to the child. If the USDC transfer fails, the STAR issuance also fails.

> 1 STAR issued = 1 USDC of principal contributed at that moment

STAR is a zero-decimal, non-transferable reward token. It is not a stablecoin, a claim on one USDC or a share of the vault. After issuance, the reward and savings ledgers are independent. A child can spend Stars while the original savings remain invested, change in value or are withdrawn by the parent.

Parents can keep the contributed USDC in the family vault or combine it with WETH in a programmable savings position powered by **1inch Aqua and SwapVM**. Aqua tracks the position's balances, SwapVM handles exchanges between USDC and WETH, and the vault applies Chainlink-based price and safety checks before any position is opened or changed.

**The Graph** turns the protocol's Sepolia events into the family data shown throughout Star Wallet, including children, Star balances, quests, goals, requests, savings positions and activity history. Live blockchain reads are still used whenever current balances, permissions or transaction status must be confirmed.

## What Star Wallet delivers

**Restricted child accounts.** Each child uses an ERC-4337 smart account that accepts only supported Star Wallet actions. The restrictions are enforced onchain, while WebAuthn passkeys remove the need for seed phrases.

**Savings-backed rewards.** Every new STAR requires an equal USDC principal contribution in the same transaction. Children receive a simple reward unit while parents build and control the underlying family savings.

**Parent-managed DeFi.** Family vaults use 1inch Aqua and SwapVM for programmable USDC/WETH liquidity positions. Parents control funding, strategy configuration and withdrawals; children interact only with Stars, quests and goals.

**Indexed family data.** The Graph converts protocol events into a GraphQL model covering families, children, requests, goals, STAR balances, savings positions and activity history. Both interfaces load this indexed model instead of rebuilding it from separate RPC calls.

## Architecture

<img width="2692" height="1157" alt="Image" src="https://github.com/user-attachments/assets/5a5603c3-979b-4226-8f4a-3a15c0721c44" />

Star Wallet separates child rewards from family savings while connecting both through a shared onchain protocol. Parents authorize financial actions with an Ethereum wallet. Children use WebAuthn P-256 passkeys to submit sponsored ERC-4337 UserOperations through a bundler, paymaster and EntryPoint. The deterministic child smart account validates every operation and permits only supported Star Wallet actions.

The protocol contracts coordinate family ownership, child membership, ENS names, quests, goals, STAR accounting and isolated family vaults. When a parent approves a reward, the protocol atomically transfers matching USDC principal into that family's vault and mints non-transferable STAR to the child. Goal contributions reserve STAR, while approved redemptions burn it; neither action transfers control of the family's savings to the child.

Each family vault holds its own USDC and WETH inventory. Parents can allocate that inventory to 1inch Aqua through a canonical SwapVM concentrated-liquidity strategy. Chainlink prices, exposure caps, price bounds, deadlines and onchain program validation constrain every position. Aqua maintains the strategy's virtual balances, SwapVM executes exchanges, and closing the position returns the resulting inventory to the vault's available accounting.

Sepolia contract, Aqua and SwapVM events flow into the Star Subgraph, which organizes them into families, children, balances, requests, goals, rewards, savings positions and activity history. The indexed deployment and block are verified before the state is used, while live Sepolia RPC remains authoritative for permissions, balances, pricing, simulations, nonces and transaction receipts.

## How does Star Wallet work?

### Setting up a family

**Connect the parent's wallet.** The parent connects an Ethereum wallet such as MetaMask. Every financial action appears in that wallet for review and approval, so the parent's private key never leaves it.

**Choose a family name.** The parent claims a name below `starwallet.eth`, such as `smith.starwallet.eth`. Registration happens in two steps to stop someone else from seeing the name and claiming it first. Once complete, the parent owns the family name and it points to their wallet.

**Create the family vault.** Star Wallet records the family onchain and creates a dedicated savings vault. Children, funds and activity are kept separate for each family, so one parent cannot access another family's accounts or savings.

**Set up a child.** On the child's device, the parent creates a passkey using the device's normal security prompt. That passkey controls a smart account made specifically for the child. It can approve Star Wallet activities, but it cannot freely transfer tokens, withdraw savings or call unrelated contracts.

**Give the child a family name.** The child receives a name below the family's name, and that name points to the child's smart account. Star Wallet checks the link before adding the child to the family.

**Confirm the child.** The parent sends the invitation and the child accepts it with their passkey. Either side can cancel while the invitation is waiting. A child account can belong to only one family and cannot also be used as a parent account.

### What parents can do

**See the whole family in one place.** The dashboard shows each child, their Stars, Stars committed to goals, family savings, available USDC and WETH, the current savings position, requests that need attention and recent activity.

**Give Stars directly.** The parent chooses a child, an amount and a reason. If a USDC approval is needed, the wallet asks for it first. The reward then adds one USDC to the family vault for every Star issued. Both parts succeed together, or neither happens.

**Create a quest.** The parent assigns a one-time task with a title and Star reward. It remains available until the child submits it or the parent cancels it.

**Review completed quests.** When a child marks a quest as done, it waits for the parent. Approving it adds the matching USDC, gives the child their Stars and completes the quest in one transaction. Rejecting it makes the quest available to try again.

**Answer Star requests.** A child can ask for Stars without completing a quest and explain why. The parent can approve or reject the request. Approval follows the same one-USDC-per-Star rule, and each child can have up to five requests waiting at once.

**Review goals suggested by a child.** A child can suggest a goal with a name, reason and picture. The parent either rejects it or accepts it and decides how many Stars it should cost. Suggesting a goal does not spend Stars or move any savings.

**Complete a funded goal.** Once a child has assigned enough Stars to a goal, they can ask the parent to complete it. Approval uses up those Stars and marks the goal complete. Rejection releases the Stars so the child can use them again. The family's USDC is not automatically withdrawn in either case.

**Review activity.** The parent can look through rewards, quests, goals, savings changes and transaction details, including links to the confirmed Sepolia transactions.

### What children can do

**See their Stars.** A child sees how many Stars they have, how many are committed to goals and how many are still free to use. Financial balances such as USDC, WETH and portfolio value stay in the parent view.

**See their quests.** Quests are grouped into tasks ready to do, submissions waiting for a parent and previous results.

**Submit a completed quest.** The child confirms completion with their passkey. Star Wallet protects retries so the same submission cannot accidentally create more than one reward request.

**Ask for Stars.** The child chooses an amount, writes a reason and sends the request to the parent. They can cancel it at any time before the parent responds.

**Suggest a goal.** The child chooses a picture, title and optional reason. The parent decides whether to create it and how many Stars it should require. The child can cancel the suggestion while it is waiting.

**Put Stars toward a goal.** The child moves available Stars into a goal. Those Stars are reserved for that goal, so they cannot be used somewhere else at the same time. The child cannot add more than the goal still needs.

**Ask to complete a goal.** After a goal has enough Stars, the child asks the parent to approve it. Cancelling the request before the parent responds releases the reserved Stars.

**Switch between family profiles.** Families with more than one child can switch profiles while keeping each child's goals, quests, Stars and activity separate.

### How family savings work

**Add WETH when needed.** Star rewards add USDC to the family vault, not WETH. A parent who wants to open a two-asset savings position adds WETH separately.

**Start a savings position.** The parent chooses how much available USDC and WETH to use. The current setup charges a 0.3% trading fee and limits how far and how long the strategy can operate. Star Wallet checks a fresh Chainlink price, and the family vault repeats the safety checks onchain before opening the position through Aqua.

**Add more funds.** The parent can add available USDC, WETH or both to the open position without changing its price range, fee or end time. A top-up does not issue Stars or count as new reward-backed principal.

**Close the position.** Closing moves the position's current USDC and WETH balances back into the family vault, where they become available again. The final mix may differ from the starting mix because trades and fees can change how much of each asset the position holds.

## The 1inch implementation

**Aqua is the liquidity accounting layer.** The family vault acts as the maker and continues to hold its ERC-20 assets. Aqua stores strategy-specific virtual balances keyed by maker, application, strategy hash and token. During a swap, the taker's input reaches the vault and the vault's output reaches the taker. Liquidity does not need to sit in a conventional shared AMM pool before it can be allocated.

**SwapVM is the execution layer.** Star Wallet produces bytecode for a USDC/WETH concentrated constant-product curve. The permitted program contains a deadline, an optional input fee for the liquidity provider, lower and upper square-root price bounds, and a non-zero salt. SwapVM evaluates the same program in either direction and Aqua updates the virtual balances after settlement.

The integration uses pinned, unmodified copies of the official 1inch Solidity sources. An SDK-free viem connector produces canonical token ordering, maker traits, order encoding and instruction bytes. Its output is tested against the upstream Solidity builders and the real Aqua/SwapVM contracts on a local chain.

The vault does not accept arbitrary SwapVM programs. It decodes the submitted bytes and verifies the maker, token pair, traits, instruction order, fee, deadline, price range and salt. Chainlink ETH/USD and USDC/USD feeds supply the reference price. The Sepolia deployment rejects stale rounds, limits the range to 10% around that price, limits strategy lifetime to 30 minutes, and caps one position at 1,000 USDC and 0.5 WETH.

Pinned sources: [Aqua](https://github.com/1inch/aqua/tree/9c5c42e5840e8741fba3597c48456c9510212b66) and [SwapVM](https://github.com/1inch/swap-vm/tree/f09a41e689240adc645934f965c8061749397cd2).

Aqua — © Degensoft Ltd 2025. SwapVM — © Degensoft Ltd 2025.

## The Graph implementation

The custom Subgraph is Star Wallet's primary read model, not an analytics add-on. AssemblyScript mappings turn events into GraphQL entities for families, children, registrations, STAR balances, quests, requests, goals, redemptions, savings accounts, withdrawals, positions and Aqua/SwapVM executions.

Static data sources index the shared family registry, STAR ledger, goals, vault factory, Aqua and SwapVM. Dynamic templates begin indexing each family vault and quest ledger when it is created. This is required because those contract addresses do not exist when the Subgraph is deployed.

Aqua positions are keyed by both maker and strategy hash because two families can submit identical strategy bytes. Aqua events that occur before the family position event in the same transaction are temporarily queued, then applied once in log order. Balance-changing events update the indexed inventory; the swap event is retained as execution history and is not counted again.

The Graph is an eventually consistent read layer. The backend pins the expected Subgraph deployment, rejects indexing errors and verifies the indexed block against Sepolia RPC. Live RPC remains authoritative for transaction preparation, permissions, token balances, oracle data, nonces, simulations and receipts. The backend does not maintain a duplicate family ledger; SQLite is used only for request-rate and sponsored-gas limits.

## Standards and supporting technology

**ERC-20:** USDC and WETH are the financial assets. STAR is based on OpenZeppelin ERC-20, uses zero decimals and rejects user-to-user transfers.

**ERC-4337 and ERC-7677:** child smart accounts send restricted UserOperations through the v0.8 EntryPoint, bundler and paymaster infrastructure.

**WebAuthn and P-256:** passkeys replace seed phrases for child actions. The smart account verifies the relying-party hash, authenticator data, user-verification flag and P-256 signature onchain.

**ENSv2 and ERC-1155:** hierarchical User Registries, Permissioned Resolvers, Enhanced Access Control and singleton name tokens provide family ownership and child address resolution on Sepolia.

**OpenZeppelin:** the contracts use its account-abstraction base, role-based access control, safe ERC-20 wrappers, reentrancy guard, checked multiplication/division and WebAuthn/P-256 cryptography.

## Business model

**The free plan** supports one parent, one child, manual rewards, quests, goals and basic savings. It gives families a complete reason to start using the product without requiring them to deposit a minimum amount or buy a token. Parents either pay their own network fees or receive a small sponsored monthly allowance.

**Star Family**, priced at roughly USD 9.99 per month or USD 99 per year, supports multiple children and guardians, scheduled allowances, recurring quests, account recovery, device management, notifications, exports and a larger sponsored-operation allowance. Subscription revenue pays for bundler and paymaster costs, The Graph queries, RPC access, notifications, support, security work and ongoing account recovery infrastructure.

**Star Platform** licenses the same account, reward and family-dashboard system to wallets, neobanks, schools and education products. Partners pay per active family or child account, with separate charges for custom integrations, branded interfaces and higher gas-sponsorship limits. This gives Star Wallet a B2B revenue stream without requiring every household to become a direct subscriber.

## Roadmap

**Sepolia MVP — complete.** Parent and child modes, passkey accounts, ENSv2 names, multi-child families, quests, STAR requests, goals, redemption, USDC-backed STAR issuance, family vaults, Aqua/SwapVM positions and the Subgraph read model are implemented.

**Product work.** Scheduled Stars, recurring allowances, notifications, goal-specific savings buckets and clearer savings-performance reporting come after the security work.

**Production deployment.** Select a suitable mainnet or L2, add fiat onboarding and compliance boundaries, deploy audited contracts, and publish the Subgraph with production query capacity.

**Platform work.** Package the family account and reward workflow as an SDK. Additional SwapVM strategies should be added only after strategy-specific review and testing.
