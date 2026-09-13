import "@fontsource/quicksand/400.css";
import "@fontsource/quicksand/500.css";
import "@fontsource/quicksand/600.css";
import "@fontsource/quicksand/700.css";
import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { connection } from "next/server";
import { Providers } from "@/components/providers";
import "@/components/onboarding/styles/shared.css";
import "@/components/onboarding/styles/welcome.css";
import "@/components/onboarding/styles/wallet.css";
import "@/components/onboarding/styles/family.css";
import "@/components/home/home.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Star Wallet",
  description: "Family rewards that build real savings.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#ffffff",
};

export default async function RootLayout({
  children,
}: Readonly<{ children: ReactNode }>) {
  // A nonce belongs to one response, so never prerender/cache an HTML shell with an old nonce.
  await connection();
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
