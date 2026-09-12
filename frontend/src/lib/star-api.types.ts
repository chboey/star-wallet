import type { Address, Hex } from "viem";

export type SignerRole = "PARENT" | "CHILD" | "EMERGENCY_ADMIN";

export type TransactionIntent = {
  chainId: number;
  signerRole: SignerRole;
  to: Address;
  data: Hex;
  value: string;
  summary: string;
};

export type IntentEnvelope = {
  intents: TransactionIntent[];
};

export type CreateFamilyResponse = IntentEnvelope & {
  ensName: string;
  ensNode: Hex;
};

export type RegisterChildResponse = IntentEnvelope & {
  registrationState: "UNREGISTERED" | "PENDING" | "ACCEPTED";
  ensName: string;
  ensNode: Hex;
  registrationId: Hex;
  childWallet: Address;
  requiresSequentialConfirmation: true;
};

export type CreateChildAccountResponse = IntentEnvelope & {
  childWallet: Address;
  parent: Address;
  alreadyDeployed: boolean;
};

export type ChildCredential = { id: string; publicKey: Hex };
export type ChildAccountConfig = {
  chainId: number;
  entryPoint: Address;
  factory: Address;
  rpId: string;
  sponsorshipConfigured: boolean;
};
export type ChildAccountMetadata = {
  wallet: Address;
  familyId: string;
  rpId: string;
  credential: ChildCredential;
};

export type IndexingMetadata = {
  deployment: string;
  block: { number: number; hash?: Hex; timestamp?: number };
  hasIndexingErrors: boolean;
  currentBlock: number;
  blockLag: number;
  maximumBlockLag: number;
};

export type StarVault = {
  id: Address;
  questsAddress: Address;
  usdc: Address;
  parent: Address;
  emergencyAdmin: Address;
  aqua: Address;
  swapVm: Address;
  aquaPaused: boolean;
  createdAt: string;
  updatedAt: string;
  creationTransactionHash: Hex;
  updatedTransactionHash: Hex;
};

export type StarChild = {
  id: string;
  wallet: Address;
  ensName: string;
  ensNode: Hex;
  active: boolean;
  starBalance: string;
  reservedStars: string;
  totalStarsIssued: string;
  totalStarsBurned: string;
  totalPrincipalContributed: string;
  createdAt?: string;
  updatedAt?: string;
  family?: {
    id: string;
    ensName?: string | null;
    ensNode: Hex;
    active: boolean;
  };
  goals?: StarGoal[];
  rewards?: StarReward[];
  redemptions?: StarRedemption[];
  indexing?: IndexingMetadata;
};

export type StarGoal = {
  id: string;
  title: string;
  starCost: string;
  // Absent on legacy deployments; never derive contributions from wallet balance.
  allocatedStars?: string;
  status: "ACTIVE" | "COMPLETED" | "CANCELLED";
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  cancelledAt?: string | null;
  child?: { id: string };
  icon?: number;
  description?: string;
};

export type StarReward = {
  id: string;
  stars: string;
  principalUsdc?: string;
  reason: string;
  transactionHash: Hex;
  blockNumber?: string;
  timestamp: string;
  child?: { id: string };
};

export type StarRedemption = {
  id: string;
  reservedStars: string;
  status: "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED";
  requestedAt: string;
  resolvedAt?: string | null;
  requestTransactionHash: Hex;
  resolutionTransactionHash?: Hex | null;
  child?: { id: string; wallet?: Address };
  goal: Pick<
    StarGoal,
    | "id"
    | "title"
    | "starCost"
    | "allocatedStars"
    | "status"
    | "icon"
    | "description"
  >;
};

export type StarPosition = {
  id: string;
  strategyHash: Hex;
  maker: Address;
  openingUsdcAmount: string;
  openingWethAmount: string;
  currentUsdcAmount: string;
  currentWethAmount: string;
  closingUsdcAmount?: string | null;
  closingWethAmount?: string | null;
  sqrtPriceMin: string;
  sqrtPriceMax: string;
  feeBps: string;
  salt: string;
  deadline: string;
  oracleRawPrice: string;
  status: "ACTIVE" | "DOCKED";
  openedAt: string;
  closedAt?: string | null;
  updatedAt: string;
  executions?: StarAquaExecution[];
};

export type StarAquaExecution = {
  id: Hex;
  strategyHash: Hex;
  type: "SHIPPED" | "PUSHED" | "PULLED" | "SWAPPED" | "DOCKED";
  maker: Address;
  app: Address;
  taker?: Address | null;
  token?: Address | null;
  tokenIn?: Address | null;
  tokenOut?: Address | null;
  amount?: string | null;
  amountIn?: string | null;
  amountOut?: string | null;
  transactionHash: Hex;
  logIndex: string;
  sequence: string;
  blockNumber: string;
  timestamp: string;
};

export type StarActivityType =
  | "FAMILY_CREATED"
  | "FAMILY_STATUS_UPDATED"
  | "CHILD_REGISTRATION_PROPOSED"
  | "CHILD_REGISTRATION_ACCEPTED"
  | "CHILD_REGISTRATION_CANCELLED"
  | "CHILD_REGISTERED"
  | "CHILD_STATUS_UPDATED"
  | "GOAL_CREATED"
  | "GOAL_STARS_ADDED"
  | "GOAL_CANCELLED"
  | "GOAL_COMPLETED"
  | "REDEMPTION_REQUESTED"
  | "REDEMPTION_APPROVED"
  | "REDEMPTION_REJECTED"
  | "REDEMPTION_CANCELLED"
  | "FAMILY_VAULT_CREATED"
  | "STARS_REWARDED"
  | "PRINCIPAL_CONTRIBUTED"
  | "SAVINGS_USDC_WITHDRAWN"
  | "STRATEGY_WETH_FUNDED"
  | "STRATEGY_WETH_WITHDRAWN"
  | "SAVINGS_POSITION_ACTIVE"
  | "SAVINGS_POSITION_DOCKED"
  | "SAVINGS_POSITION_TOPPED_UP"
  | "AQUA_PAUSED"
  | "AQUA_RESUMED";

export type StarActivity = {
  id: Hex;
  type: StarActivityType;
  amount?: string | null;
  active?: boolean | null;
  transactionHash: Hex;
  logIndex: string;
  sequence: string;
  blockNumber: string;
  timestamp: string;
  child?: { id: string } | null;
  registration?: { id: Hex; registrationId: Hex } | null;
  goal?: { id: string } | null;
  redemption?: { id: string } | null;
};

export type StarSavings = {
  id: string;
  totalPrincipalContributed: string;
  totalPrincipalWithdrawn: string;
  netPrincipal: string;
  totalUsdcWithdrawn: string;
  totalWethWithdrawn: string;
  availableUsdc: string;
  availableWeth: string;
  updatedAt: string;
  vault?: { id: Address; aquaPaused: boolean } | null;
  activePosition?: StarPosition | null;
  contributions: Array<{
    id: Hex;
    child: { id: string };
    amount: string;
    transactionHash: Hex;
    blockNumber: string;
    timestamp: string;
  }>;
  withdrawals: Array<{
    id: Hex;
    asset: "USDC" | "WETH";
    amount: string;
    principalAmount: string;
    recipient: Address;
    transactionHash: Hex;
    blockNumber: string;
    timestamp: string;
  }>;
  positions: StarPosition[];
};

export type StarFamily = {
  id: string;
  parent: Address;
  ensName?: string | null;
  ensNode: Hex;
  active: boolean;
  childCount: number;
  createdAt: string;
  updatedAt: string;
  vault?: StarVault | null;
  childRegistrations: Array<{
    id: Hex;
    registrationId: Hex;
    childWallet: Address;
    ensName: string;
    ensNode: Hex;
    status: "PENDING" | "ACCEPTED" | "CANCELLED";
    proposedAt: string;
    resolvedAt?: string | null;
    resolvedBy?: Address | null;
    updatedAt: string;
    proposalTransactionHash: Hex;
    resolutionTransactionHash?: Hex | null;
    child?: { id: string; wallet: Address } | null;
  }>;
  children: StarChild[];
  goals: StarGoal[];
  rewards: StarReward[];
  redemptions: StarRedemption[];
  savings: StarSavings;
  activities: StarActivity[];
  indexing: IndexingMetadata;
};

export type StarPortfolio = {
  parentWallet: {
    address: Address;
    usdc: { amount: string; decimals: number };
    weth: { amount: string; decimals: number };
  };
  familyId: string;
  currentPortfolioValue: { amount: string; decimals: 18; currency: "USD" };
  assets: {
    usdc: StarPortfolioAsset;
    weth: StarPortfolioAsset;
  };
  valuedAtBlock: string;
  valuedAt: string;
  holdingsIndexedAtBlock: string;
  holdingsIndexedAt?: string;
};

export type StarPortfolioAsset = {
  availableAmount: string;
  positionAmount: string;
  totalAmount: string;
  decimals: number;
  valueUsd18: string;
  price: {
    address: Address;
    description: string;
    answer: string;
    decimals: number;
    roundId: string;
    updatedAt: string;
  };
};

export type FamiliesByParentResponse = {
  families: Array<
    Pick<
      StarFamily,
      | "id"
      | "parent"
      | "ensName"
      | "ensNode"
      | "active"
      | "childCount"
      | "createdAt"
      | "updatedAt"
    > & { vault?: { id: Address; aquaPaused: boolean } | null }
  >;
  indexing: IndexingMetadata;
};

export type ActivityPage = {
  items: StarActivity[];
  nextCursor: string | null;
  indexing: IndexingMetadata;
};
export type EnsNamespace = {
  chainId: 11155111;
  name: string;
  owner: `0x${string}`;
  registry: `0x${string}`;
  tokenId: string;
  expiresAt: string;
  subregistry: `0x${string}`;
  setupRequired: boolean;
  checkedAtBlock: string;
};

export type EnsTransactionPlan = {
  name: string;
  checkedAtBlock: string;
} & (
  | {
      status: "READY";
      step: null;
      transaction: null;
      requiresConfirmation: false;
    }
  | {
      status: "TRANSACTION_REQUIRED";
      step:
        | "DEPLOY_REGISTRY"
        | "SET_REGISTRY_PARENT"
        | "ATTACH_REGISTRY"
        | "DEPLOY_RESOLVER"
        | "REGISTER_SUBDOMAIN"
        | "AUTHORIZE_FAMILY_REGISTRAR"
        | "COMMIT_FAMILY_NAME"
        | "REGISTER_FAMILY_NAME";
      requiresConfirmation: true;
      transaction: {
        chainId: 11155111;
        from: `0x${string}`;
        to: `0x${string}`;
        data: `0x${string}`;
        value: "0";
      };
    }
);

export type EnsSubdomainInput = {
  parentName?: string;
  label: string;
  signer: string;
  owner: string;
  address: string;
  expiresAt?: string;
};

export type EnsFamilyPlan =
  | EnsTransactionPlan
  | {
      status: "WAITING";
      name: string;
      checkedAtBlock: string;
      readyAt: string;
      step: null;
      transaction: null;
      requiresConfirmation: false;
    };
