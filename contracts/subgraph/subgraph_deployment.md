You already have the subgraph code—**no `graph init` or local Graph Node needed.**

### 1. Finish contract deployment first

Keep both generated contract deployment manifests:

```text
contracts/deployments/sepolia-aqua.json
contracts/deployments/sepolia.json
```

If these are missing, restore them from your contract deployment. See [tldr.md](../../tldr.md); do not redeploy contracts just to deploy the subgraph.

### 2. Create the Studio project

Open [Subgraph Studio](https://thegraph.com/studio/):

- Connect your wallet.
- Click **Create a Subgraph**.
- Name it `Star Wallet Sepolia`.
- Copy the project’s **slug** and **deploy key**.

### 3. Configure and build

From the repository root:

```sh
cd contracts/subgraph
npm ci
npm run configure:sepolia
npm run codegen
npm run build
npm run validate:queries
```

The configure command reads `contracts/deployments/sepolia.json` and generates `networks.json` with the addresses and starting blocks.

Addresses load automatically from that manifest. `.env` holds the Studio credentials below. Stop if any command fails.

### 4. Authenticate and deploy

In `contracts/subgraph`, copy `.env.example` to `.env` only if `.env` does not exist. Fill:

```dotenv
SUBGRAPH_DEPLOY_KEY=YOUR_DEPLOY_KEY
SUBGRAPH_SLUG=YOUR_SUBGRAPH_SLUG
```

Then run; both commands read `.env` automatically:

```sh
npm run auth:studio
npm run deploy:studio
```

When asked for a version label, enter `0.0.1`. Keep the deploy key private.

### 5. Check indexing

In Studio, watch the indexing status and logs. Once synchronized, run this in its query playground:

```graphql
{
  _meta {
    deployment
    hasIndexingErrors
    block {
      number
    }
  }
}
```

You want `hasIndexingErrors: false` and a block number close to Sepolia’s current block. `deployment` is your deployment CID.

### 6. Connect the backend

Copy Studio’s **development query URL** and the CID into `backend/.env`:

```dotenv
STAR_SUBGRAPH_URL=YOUR_DEVELOPMENT_QUERY_URL
STAR_SUBGRAPH_DEPLOYMENT_ID=YOUR_DEPLOYMENT_CID
```

Then validate the live schema:

```sh
npm run validate:queries -- --endpoint "YOUR_DEVELOPMENT_QUERY_URL"
```
