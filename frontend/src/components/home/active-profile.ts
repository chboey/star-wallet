export const ACTIVE_PROFILE_SESSION_KEY = "star-wallet-active-profile-v1";

export type ActiveProfile = "parent" | "child";

export function readActiveProfile(): ActiveProfile {
  if (typeof window === "undefined") return "parent";
  return window.sessionStorage.getItem(ACTIVE_PROFILE_SESSION_KEY) === "child"
    ? "child"
    : "parent";
}

export function saveActiveProfile(profile: ActiveProfile): void {
  window.sessionStorage.setItem(ACTIVE_PROFILE_SESSION_KEY, profile);
}
