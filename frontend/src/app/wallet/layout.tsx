import type { ReactNode } from "react";
import { HomeAppShell } from "@/components/home/home-app-shell";

export default function WalletLayout({ children }: { children: ReactNode }) {
  return <HomeAppShell>{children}</HomeAppShell>;
}
