import { validAddress, type OnboardingDraft } from "./onboarding";

export const SELECTED_CHILD_KEY = "star-wallet:11155111:selected-child:v1";
export const CHILD_LINK_KEY = "star-wallet:11155111:child-link:v1";

export function needsFamilyOnboarding(state: {
  hydrated: boolean;
  loading: boolean;
  error: Error | null;
  familyId: string | null;
  childCount?: number;
}): boolean {
  return (
    state.hydrated &&
    !state.loading &&
    !state.error &&
    (state.familyId === null || state.childCount === 0)
  );
}

/** A saved family is a navigation hint, never authority for a different connected wallet. */
export function walletContext(
  address: string | undefined,
  draft: OnboardingDraft | null,
  childLink: string,
  explicitChildLink = false,
) {
  const connected = address && validAddress(address) ? address : "";
  const ownsDraft =
    !connected ||
    connected.toLowerCase() === draft?.parentAddress.toLowerCase();
  const link =
    validAddress(childLink) &&
    (explicitChildLink ||
      ownsDraft ||
      connected.toLowerCase() === childLink.toLowerCase())
      ? childLink
      : "";
  return {
    discoveryAddress: link || connected || draft?.parentAddress || "",
    storedFamilyId:
      !link &&
      ownsDraft &&
      draft?.familyId &&
      /^[1-9][0-9]*$/.test(draft.familyId)
        ? draft.familyId
        : null,
  };
}

export function clearWalletSelection() {
  window.sessionStorage.removeItem(SELECTED_CHILD_KEY);
  window.sessionStorage.removeItem(CHILD_LINK_KEY);
}

export function selectFamilyId(
  preferredId: string | null,
  families: { id: string; active: boolean }[] | undefined,
  childFamilyId?: string,
): string | null {
  return (
    families?.find((family) => family.id === preferredId)?.id ??
    families?.find((family) => family.active)?.id ??
    families?.[0]?.id ??
    childFamilyId ??
    null
  );
}
