import {
  childEns,
  emptyDraft,
  validAddress,
  type OnboardingDraft,
} from "./onboarding";
import {
  starApi,
  StarApiError,
  type FamiliesByParentResponse,
} from "./star-api";
import { displayEnsName } from "./star-format";
import { selectFamilyId } from "./wallet-context";

type ExistingFamily = FamiliesByParentResponse["families"][number];

export function shouldCheckFamily(
  parent: string | undefined,
  requestedWallet: string | null,
  step: number,
) {
  return (
    step > 0 &&
    Boolean(
      parent &&
      validAddress(parent) &&
      parent.toLowerCase() === requestedWallet,
    )
  );
}

/** Called once after a successful empty lookup, never after an error or during setup. */
export function draftWithoutIndexedFamily(
  parent: string,
  saved: OnboardingDraft,
  indexedBlock: number,
): OnboardingDraft {
  const sameParent = saved.parentAddress.toLowerCase() === parent.toLowerCase();
  // A just-confirmed creation may not be indexed yet. Preserve its resumable
  // draft until the read model reaches that receipt instead of losing progress.
  if (
    sameParent &&
    saved.familyId &&
    /^[1-9][0-9]*$/.test(saved.familyCreationBlock) &&
    BigInt(saved.familyCreationBlock) > BigInt(indexedBlock)
  )
    return saved;
  const hasOldSetup =
    saved.familyId ||
    saved.vaultReady ||
    saved.childWallet ||
    saved.childCredential ||
    saved.registrationId ||
    saved.registrationProposed ||
    saved.registrationAccepted ||
    saved.step > 2;
  if (!sameParent || hasOldSetup)
    return { ...emptyDraft, parentAddress: parent, step: 1 };
  return { ...saved, parentAddress: parent };
}

/** Only a successful, wallet-scoped lookup can decide whether onboarding is needed. */
export function existingFamilyForWallet(
  response: FamiliesByParentResponse,
  parent: string,
  draft: OnboardingDraft,
): ExistingFamily | null {
  if (
    !validAddress(parent) ||
    !Array.isArray(response?.families) ||
    response.families.some(
      (family) =>
        !family ||
        typeof family.id !== "string" ||
        !/^[1-9][0-9]*$/.test(family.id) ||
        typeof family.parent !== "string" ||
        family.parent.toLowerCase() !== parent.toLowerCase() ||
        typeof family.active !== "boolean" ||
        !Number.isSafeInteger(family.childCount) ||
        family.childCount < 0 ||
        (family.ensName != null && typeof family.ensName !== "string"),
    )
  ) {
    throw new StarApiError(
      "Couldn’t verify this wallet’s family. Please try again.",
      {
        code: "STAR_API_INVALID_RESPONSE",
      },
    );
  }
  const preferred =
    draft.parentAddress.toLowerCase() === parent.toLowerCase()
      ? draft.familyId
      : null;
  const id = selectFamilyId(preferred, response.families);
  return response.families.find((family) => family.id === id) ?? null;
}

export function returningFamilyDraft(
  parent: string,
  family: ExistingFamily,
  saved: OnboardingDraft,
): OnboardingDraft {
  const sameFamily =
    saved.parentAddress.toLowerCase() === parent.toLowerCase() &&
    saved.familyId === family.id;
  return {
    ...(sameFamily ? saved : emptyDraft),
    parentAddress: parent,
    familyId: family.id,
    familyEnsName: family.ensName ?? "",
    familyName: displayEnsName(family.ensName, "Your family"),
    vaultReady: Boolean(family.vault),
  };
}

/** A family creation or pending child proposal alone never completes onboarding. */
export function resumeFamilyOnboarding(
  parent: string,
  family: ExistingFamily,
  saved: OnboardingDraft,
): OnboardingDraft {
  const restored = returningFamilyDraft(parent, family, saved);
  const canConfirmChild = Boolean(
    restored.childCredential &&
    restored.childName.trim().length >= 2 &&
    restored.childEnsName &&
    restored.childEnsName ===
      childEns(restored.childName, restored.familyEnsName),
  );
  return {
    ...restored,
    registrationAccepted: false,
    step: !restored.vaultReady ? 2 : canConfirmChild ? 4 : 3,
  };
}

/** One explicit read on completion; indexer lag never opens a parent-only picker. */
export async function familyForProfiles(
  parent: string,
  familyId: string,
  api: Pick<typeof starApi, "fullFamily"> = starApi,
) {
  const family = await api.fullFamily(familyId);
  existingFamilyForWallet(
    { families: [family], indexing: family.indexing },
    parent,
    emptyDraft,
  );
  if (family.id !== familyId || !Array.isArray(family.children))
    throw new StarApiError(
      "Couldn’t verify this wallet’s family. Please try again.",
      {
        code: "STAR_API_INVALID_RESPONSE",
      },
    );
  if (family.childCount === 0 || family.children.length === 0)
    throw new StarApiError(
      "Your child’s profile isn’t available yet. Finish child setup, or try again if registration just confirmed.",
      { code: "CHILD_SETUP_REQUIRED" },
    );
  return family;
}
