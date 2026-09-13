"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { displayEnsName } from "@/lib/star-format";
import {
  type ActiveProfile,
  readActiveProfile,
  saveActiveProfile,
} from "../active-profile";
import { HomeIllustration, SectionEmptyState } from "../home-ui";
import { useStarData } from "../star-data-provider";

export function ProfileSwitcherScreen() {
  const router = useRouter();
  const { family, familyName, child, selectChild } = useStarData();
  const [activeProfile, setActiveProfile] = useState<ActiveProfile>("parent");
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setActiveProfile(readActiveProfile());
      setProfileLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const switchToParent = () => {
    saveActiveProfile("parent");
    setActiveProfile("parent");
    router.replace("/wallet");
  };

  const switchToChild = (wallet: string) => {
    selectChild(wallet);
    saveActiveProfile("child");
    setActiveProfile("child");
    router.replace("/wallet/kid");
  };

  return (
    <div className="wallet-screen profile-switcher-screen">
      <header className="profile-switcher-header">
        <span aria-hidden="true" />
        <h1>Profiles</h1>
        <button
          type="button"
          aria-label="Close profiles"
          disabled={!profileLoaded}
          onClick={() =>
            router.replace(
              activeProfile === "child"
                ? "/wallet/kid/profile"
                : "/wallet/profile",
            )
          }
        >
          <X size={20} strokeWidth={2.1} />
        </button>
      </header>

      <div className="profile-switcher-list" aria-label="Family profiles">
        {family ? (
          <>
            <button
              className={`profile-switcher-profile ${activeProfile === "parent" ? "is-active" : ""}`}
              type="button"
              aria-pressed={activeProfile === "parent"}
              aria-label={`Switch to ${familyName}'s parent profile`}
              disabled={!profileLoaded}
              onClick={switchToParent}
            >
              <span className="profile-switcher-avatar profile-switcher-avatar-parent">
                <HomeIllustration name="dad" alt="" size={118} />
              </span>
              <strong>{familyName}</strong>
            </button>
            {family.children.map((familyChild) => {
              const name = displayEnsName(familyChild.ensName, "Child");
              const selected =
                activeProfile === "child" && child?.id === familyChild.id;
              return (
                <button
                  className={`profile-switcher-profile ${selected ? "is-active" : ""}`}
                  type="button"
                  aria-pressed={selected}
                  aria-label={`Switch to ${name}'s child profile`}
                  disabled={!profileLoaded}
                  onClick={() => switchToChild(familyChild.wallet)}
                  key={familyChild.id}
                >
                  <span className="profile-switcher-avatar profile-switcher-avatar-child">
                    <HomeIllustration name="girl" alt="" size={118} />
                  </span>
                  <strong>{name}</strong>
                </button>
              );
            })}
          </>
        ) : (
          <SectionEmptyState className="is-tall" />
        )}
      </div>
    </div>
  );
}
