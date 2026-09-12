import { getAddress, isAddress } from "viem";
import { normalize } from "viem/ens";
import type { ChildCredential } from "./star-api.types";

export const ONBOARDING_STORAGE_KEY = "star-wallet:11155111:onboarding:v1";
export const steps = [
  "Introduction",
  "Connect wallet",
  "Create family",
  "Add child",
  "Confirm child",
  "Complete",
] as const;

export type OnboardingDraft = {
  step: number;
  parentAddress: string;
  familyName: string;
  familyEnsName: string;
  familyId: string;
  familyCreationBlock: string;
  vaultReady: boolean;
  childName: string;
  childEnsName: string;
  childWallet: string;
  childCredential: ChildCredential | null;
  registrationId: string;
  registrationProposed: boolean;
  registrationAccepted: boolean;
};

export const emptyDraft: OnboardingDraft = {
  step: 0,
  parentAddress: "",
  familyName: "",
  familyEnsName: "",
  familyId: "",
  familyCreationBlock: "",
  vaultReady: false,
  childName: "",
  childEnsName: "",
  childWallet: "",
  childCredential: null,
  registrationId: "",
  registrationProposed: false,
  registrationAccepted: false,
};

export function ensLabel(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);
}

export function familyEns(familyName: string, root: string): string {
  const label = ensLabel(familyName);
  if (!label) return "";
  return normalize(`${label}.${root}`);
}

export function childEns(childName: string, familyName: string): string {
  const label = ensLabel(childName);
  if (!label || !familyName) return "";
  return normalize(`${label}.${familyName}`);
}

export function validAddress(value: string): boolean {
  return isAddress(value) && !/^0x0{40}$/i.test(value);
}

export function checksumAddress(value: string): string {
  return validAddress(value) ? getAddress(value) : value;
}

export function shortAddress(value: string): string {
  if (!validAddress(value)) return value;
  const address = getAddress(value);
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

export function readDraft(parent?: string): OnboardingDraft {
  if (typeof window === "undefined") return { ...emptyDraft };
  try {
    const legacy = parseDraft(localStorage.getItem(ONBOARDING_STORAGE_KEY));
    if (!parent) return legacy;
    if (!validAddress(parent)) return { ...emptyDraft };
    // Preserve an existing draft when switching parents, including pre-scoping drafts.
    if (validAddress(legacy.parentAddress))
      localStorage.setItem(
        draftKey(legacy.parentAddress),
        JSON.stringify(legacy),
      );
    const saved = parseDraft(localStorage.getItem(draftKey(parent)));
    return saved.parentAddress.toLowerCase() === parent.toLowerCase()
      ? saved
      : { ...emptyDraft, parentAddress: parent };
  } catch {
    return { ...emptyDraft };
  }
}

export function saveDraft(draft: OnboardingDraft): void {
  if (validAddress(draft.parentAddress))
    localStorage.setItem(draftKey(draft.parentAddress), JSON.stringify(draft));
  localStorage.setItem(ONBOARDING_STORAGE_KEY, JSON.stringify(draft));
}

export function clearDraft(): void {
  const draft = readDraft();
  if (validAddress(draft.parentAddress))
    localStorage.removeItem(draftKey(draft.parentAddress));
  localStorage.removeItem(ONBOARDING_STORAGE_KEY);
}

function draftKey(parent: string) {
  return `${ONBOARDING_STORAGE_KEY}:${parent.toLowerCase()}`;
}

function parseDraft(raw: string | null): OnboardingDraft {
  const value: unknown = JSON.parse(raw ?? "null");
  if (!value || typeof value !== "object" || Array.isArray(value))
    return { ...emptyDraft };
  const parsed = value as Record<string, unknown>;
  const draft = { ...emptyDraft };
  for (const key of Object.keys(emptyDraft) as (keyof OnboardingDraft)[]) {
    if (key === "childCredential") continue;
    if (typeof parsed[key] === typeof emptyDraft[key])
      Object.assign(draft, { [key]: parsed[key] });
  }
  if (
    !Number.isInteger(draft.step) ||
    draft.step < 0 ||
    draft.step >= steps.length
  )
    draft.step = 0;
  const credential = parsed.childCredential;
  if (
    credential &&
    typeof credential === "object" &&
    "id" in credential &&
    "publicKey" in credential &&
    typeof credential.id === "string" &&
    credential.id.length > 0 &&
    credential.id.length <= 1024 &&
    typeof credential.publicKey === "string" &&
    /^0x[0-9a-f]{128}$/i.test(credential.publicKey)
  )
    draft.childCredential = {
      id: credential.id,
      publicKey: credential.publicKey as `0x${string}`,
    };
  if (draft.familyId && !/^[1-9][0-9]*$/.test(draft.familyId))
    return { ...emptyDraft };
  if (draft.parentAddress && !validAddress(draft.parentAddress))
    return { ...emptyDraft };
  return draft;
}
