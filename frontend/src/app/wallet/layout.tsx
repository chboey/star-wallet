import type { ReactNode } from "react";
import { HomeAppShell } from "@/components/home/home-app-shell";
import { StarDataProvider } from "@/components/home/star-data-provider";

export default function WalletLayout({ children }: { children: ReactNode }) {
  return (
    <StarDataProvider>
      <HomeAppShell>{children}</HomeAppShell>
    </StarDataProvider>
  );
}
