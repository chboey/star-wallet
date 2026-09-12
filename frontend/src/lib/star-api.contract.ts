import type {
  CreateFamilyResponse,
  CreateChildAccountResponse,
  ChildCredential,
  IntentEnvelope,
  RegisterChildResponse,
} from "./star-api.types";

// One route registry shared by the typed client and the server proxy allowlist.
export const intentPaths = {
  createQuest: "intents/quests/create",
  cancelQuest: "intents/quests/cancel",
  submitQuest: "intents/quests/submit",
  requestStars: "intents/quests/request",
  cancelStarRequest: "intents/quests/cancel-request",
  approveStarRequest: "intents/quests/approve",
  rejectStarRequest: "intents/quests/reject",
  createFamily: "intents/families",
  createVault: "intents/families/vault",
  setFamilyStatus: "intents/families/status",
  registerChild: "intents/children",
  createChildAccount: "intents/children/account",
  setChildStatus: "intents/children/status",
  cancelChildRegistration: "intents/children/registration/cancel",
  rejectChildRegistration: "intents/children/registration/reject",
  rewardStars: "intents/rewards",
  createGoal: "intents/goals",
  addStarsToGoal: "intents/goals/add-stars",
  requestGoal: "intents/goal-requests/request",
  approveGoalRequest: "intents/goal-requests/approve",
  rejectGoalRequest: "intents/goal-requests/reject",
  cancelGoalRequest: "intents/goal-requests/cancel",
  cancelGoal: "intents/goals/cancel",
  requestRedemption: "intents/redemptions/request",
  cancelRedemption: "intents/redemptions/cancel",
  approveRedemption: "intents/redemptions/approve",
  rejectRedemption: "intents/redemptions/reject",
  withdrawSavings: "intents/savings/withdraw",
  fundWeth: "intents/savings/fund-weth",
  withdrawWeth: "intents/savings/withdraw-weth",
  shipSavings: "intents/savings/ship",
  replaceSavings: "intents/savings/replace",
  dockSavings: "intents/savings/dock",
  addSavings: "intents/savings/add",
  setAquaPaused: "intents/savings/aqua-pause",
} as const;

type PositionInput = {
  familyId: string;
  usdcAmountUnits: string;
  wethAmountUnits: string;
  feeBps?: number;
  priceBandBps?: number;
  validForSeconds?: number;
};
export type IntentInputs = {
  createQuest: { childId: string; stars: string; text: string };
  cancelQuest: { childId: string; id: string };
  submitQuest: { childId: string; id: string; submissionId: `0x${string}` };
  requestStars: {
    childId: string;
    stars: string;
    text: string;
    submissionId: `0x${string}`;
  };
  cancelStarRequest: { childId: string; id: string };
  approveStarRequest: { childId: string; id: string; stars: string };
  rejectStarRequest: { childId: string; id: string };
  createFamily: { ensName: string };
  createVault: { familyId: string };
  setFamilyStatus: { familyId: string; active: boolean };
  registerChild: { familyId: string; childWallet: string; ensName: string };
  createChildAccount: {
    familyId: string;
    ensName: string;
    credential: ChildCredential;
  };
  setChildStatus: { childId: string; active: boolean };
  cancelChildRegistration: { registrationId: string };
  rejectChildRegistration: { registrationId: string };
  rewardStars: { childId: string; stars: string; reason: string };
  createGoal: { childId: string; title: string; starCost: string };
  addStarsToGoal: { goalId: string; amount: string };
  requestGoal: {
    childId: string;
    title: string;
    reason: string;
    icon: number;
    submissionId: `0x${string}`;
  };
  approveGoalRequest: { childId: string; requestId: string; starCost: string };
  rejectGoalRequest: { childId: string; requestId: string };
  cancelGoalRequest: { childId: string; requestId: string };
  cancelGoal: { goalId: string };
  requestRedemption: { goalId: string };
  cancelRedemption: { redemptionId: string };
  approveRedemption: { redemptionId: string };
  rejectRedemption: { redemptionId: string };
  withdrawSavings: {
    familyId: string;
    amountUsdcUnits: string;
    recipient: string;
  };
  fundWeth: { familyId: string; amountWethUnits: string };
  withdrawWeth: {
    familyId: string;
    amountWethUnits: string;
    recipient: string;
  };
  shipSavings: PositionInput;
  replaceSavings: PositionInput;
  dockSavings: { familyId: string };
  addSavings: {
    familyId: string;
    expectedStrategyHash: `0x${string}`;
    usdcAmountUnits: string;
    wethAmountUnits: string;
  };
  setAquaPaused: { familyId: string; paused: boolean };
};
export type IntentAction = keyof typeof intentPaths;
export type IntentResponse<Action extends IntentAction> =
  Action extends "createFamily"
    ? CreateFamilyResponse
    : Action extends "registerChild"
      ? RegisterChildResponse
      : Action extends "createChildAccount"
        ? CreateChildAccountResponse
        : IntentEnvelope;

/** ENS onboarding plans can take arbitrarily long; caller cancellation still applies.
 * Keep this policy shared by the browser and proxy so neither cuts setup short.
 */
export function isDeadlineFreeStarRequest(
  route: string,
  method: string,
): boolean {
  return (
    (method === "GET" && route === "child-accounts/config") ||
    (method === "POST" &&
      ["ens/namespace", "ens/families", "ens/subdomains"].includes(route))
  );
}

const postRoutes = new Set<string>([
  ...Object.values(intentPaths),
  "ens/namespace",
  "ens/subdomains",
  "ens/families",
  "child-accounts/rpc",
]);
const getRoutes = new Set([
  "status",
  "config",
  "ens/resolve",
  "ens/namespace",
  "indexing/status",
  "protocol/state",
  "child-accounts/config",
  "child-accounts/lookup",
]);
export function isStarRouteAllowed(route: string, method: string): boolean {
  if (method === "POST") return postRoutes.has(route);
  if (method !== "GET") return false;
  return (
    getRoutes.has(route) ||
    /^families\/[1-9][0-9]*(?:\/portfolio|\/activity|\/inbox|\/goal-requests)?$/.test(
      route,
    ) ||
    /^families\/by-parent\/0x[a-fA-F0-9]{40}$/.test(route) ||
    /^children\/by-wallet\/0x[a-fA-F0-9]{40}$/.test(route) ||
    /^child-accounts\/0x[a-fA-F0-9]{40}$/.test(route)
  );
}
