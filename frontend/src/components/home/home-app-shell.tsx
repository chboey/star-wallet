"use client";

import { Cloud, House, UserRound, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useState,
} from "react";
import { clearWalletSelection } from "@/lib/wallet-context";
import { readActiveProfile, saveActiveProfile } from "./active-profile";
import { OnchainDetailsSheet } from "./onchain-details-sheet";
import { StarDataBoundary, useStarData } from "./star-data-provider";
import { WalletRefreshStatus } from "./home-ui";
import { ParentAuthorizationProvider } from "./parent-authorization-provider";

const parentNavigation = [
  { href: "/wallet", label: "Home", icon: House },
  { href: "/wallet/family", label: "Family", icon: UsersRound },
  { href: "/wallet/profile", label: "Profile", icon: UserRound },
] as const;

const kidNavigation = [
  { href: "/wallet/kid", label: "Home", icon: House },
  { href: "/wallet/kid/journey", label: "Dreams", icon: Cloud },
  { href: "/wallet/kid/profile", label: "Profile", icon: UserRound },
] as const;

const OnchainDetailsSheetContext = createContext<(() => void) | null>(null);

export function useOnchainDetailsSheet() {
  const openOnchainDetails = useContext(OnchainDetailsSheetContext);
  if (!openOnchainDetails)
    throw new Error("useOnchainDetailsSheet must be used inside HomeAppShell");
  return openOnchainDetails;
}

export function HomeAppShell({ children }: { children: ReactNode }) {
  const { loading, error, needsOnboarding, family, refreshRequested } =
    useStarData();
  const pathname = usePathname();
  const router = useRouter();
  const profilesOpen = pathname === "/wallet/profiles";
  const kidMode = pathname.startsWith("/wallet/kid");
  const navigation = kidMode ? kidNavigation : parentNavigation;
  const [onchainDetailsOpen, setOnchainDetailsOpen] = useState(false);

  useEffect(() => {
    if (loading || error) return;
    if (needsOnboarding) {
      clearWalletSelection();
      router.replace("/onboarding");
      return;
    }
    if (!family || profilesOpen) return;
    if (kidMode) {
      saveActiveProfile("child");
      return;
    }
    if (readActiveProfile() === "child") router.replace("/wallet/kid");
  }, [loading, error, needsOnboarding, family, profilesOpen, kidMode, router]);

  return (
    <OnchainDetailsSheetContext.Provider
      value={() => setOnchainDetailsOpen(true)}
    >
      <main className="wallet-app-page">
        <section
          className={`wallet-app-frame ${profilesOpen ? "profile-switcher-active" : ""}`}
        >
          <ParentAuthorizationProvider>
            <div className="wallet-app-scroll">
              <StarDataBoundary>{children}</StarDataBoundary>
            </div>
            <WalletRefreshStatus requested={!loading && refreshRequested} />
            {!profilesOpen && !loading && !needsOnboarding && family && (
              <nav
                className={`wallet-bottom-nav ${kidMode ? "kid-bottom-nav" : ""}`}
                aria-label="Star Wallet navigation"
              >
                {navigation.map(({ href, label, icon: Icon }) => {
                  const active = isActivePath(pathname, href);
                  return (
                    <Link
                      className={active ? "active" : ""}
                      href={href}
                      key={href}
                      aria-current={active ? "page" : undefined}
                    >
                      <Icon size={22} strokeWidth={active ? 2.6 : 2.1} />
                      <span>{label}</span>
                    </Link>
                  );
                })}
              </nav>
            )}
            {onchainDetailsOpen && !kidMode && (
              <OnchainDetailsSheet
                key={family?.vault?.id}
                onClose={() => setOnchainDetailsOpen(false)}
              />
            )}
          </ParentAuthorizationProvider>
        </section>
      </main>
    </OnchainDetailsSheetContext.Provider>
  );
}

function isActivePath(pathname: string, href: string): boolean {
  if (href === "/wallet/kid") return pathname === href;
  if (href === "/wallet/kid/journey")
    return (
      pathname.startsWith(href) ||
      pathname.startsWith("/wallet/kid/quests") ||
      pathname.startsWith("/wallet/kid/goals") ||
      pathname.startsWith("/wallet/kid/add-goal")
    );
  if (href === "/wallet")
    return (
      pathname === href ||
      pathname.startsWith("/wallet/quests") ||
      pathname.startsWith("/wallet/goals") ||
      pathname.startsWith("/wallet/rewards") ||
      pathname.startsWith("/wallet/stars")
    );
  return pathname.startsWith(href);
}
