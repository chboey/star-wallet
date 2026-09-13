"use client";

import { X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import {
  type ActiveProfile,
  readActiveProfile,
  saveActiveProfile,
} from "../active-profile";
import { HomeIllustration } from "../home-ui";

const profiles = [
  {
    id: "parent" as const,
    name: "Tan Family",
    image: "dad",
    destination: "/wallet",
  },
  {
    id: "child" as const,
    name: "Jane",
    image: "girl",
    destination: "/wallet/kid",
  },
];

export function ProfileSwitcherScreen() {
  const router = useRouter();
  const [activeProfile, setActiveProfile] = useState<ActiveProfile>("parent");
  const [profileLoaded, setProfileLoaded] = useState(false);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      setActiveProfile(readActiveProfile());
      setProfileLoaded(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  const selectProfile = (profile: (typeof profiles)[number]) => {
    saveActiveProfile(profile.id);
    setActiveProfile(profile.id);
    router.replace(profile.destination);
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
        {profiles.map((profile) => {
          const selected = activeProfile === profile.id;
          return (
            <button
              className={`profile-switcher-profile ${selected ? "is-active" : ""}`}
              type="button"
              aria-pressed={selected}
              aria-label={`Switch to ${profile.name}'s ${profile.id} profile`}
              disabled={!profileLoaded}
              onClick={() => selectProfile(profile)}
              key={profile.id}
            >
              <span
                className={`profile-switcher-avatar profile-switcher-avatar-${profile.id}`}
              >
                <HomeIllustration name={profile.image} alt="" size={118} />
              </span>
              <strong>{profile.name}</strong>
            </button>
          );
        })}
      </div>
    </div>
  );
}
