"use client";

import { Cloud, House, UserRound, UsersRound } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

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

export function HomeAppShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const profilesOpen = pathname === "/wallet/profiles";
  const kidMode = pathname.startsWith("/wallet/kid");
  const navigation = kidMode ? kidNavigation : parentNavigation;

  return (
    <main className="wallet-app-page">
      <section
        className={`wallet-app-frame ${profilesOpen ? "profile-switcher-active" : ""}`}
      >
        <div className="wallet-app-scroll">{children}</div>
        {!profilesOpen && (
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
      </section>
    </main>
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
