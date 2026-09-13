import { LoaderCircle, Star } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

export const HOME_ASSET_ROOT = "/illustrations/home";

export function ScreenHeader({ title }: { title: string }) {
  return (
    <header className="wallet-screen-header">
      <h1>{title}</h1>
    </header>
  );
}

export function HomeIllustration({
  name,
  alt,
  size = 48,
  className = "",
  collection = "home",
}: {
  name: string;
  alt: string;
  size?: number;
  className?: string;
  collection?: "home" | "kid";
}) {
  return (
    <Image
      className={`home-illustration ${className}`}
      src={`${collection === "kid" ? "/illustrations/kid" : HOME_ASSET_ROOT}/${name}.png`}
      alt={alt}
      width={size}
      height={size}
    />
  );
}

export function StarValue({
  children,
  compact = false,
}: {
  children: ReactNode;
  compact?: boolean;
}) {
  return (
    <span className={`star-value ${compact ? "compact" : ""}`}>
      {children}
      <Star aria-hidden="true" size={compact ? 14 : 18} fill="currentColor" />
    </span>
  );
}

export function SectionTitle({
  children,
  action,
}: {
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="wallet-section-title">
      <h2>{children}</h2>
      {action}
    </div>
  );
}

export function FullScreenLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="wallet-fullscreen-loader" role="status" aria-label={label}>
      <LoaderCircle
        className="spin"
        size={42}
        strokeWidth={2.4}
        aria-hidden="true"
      />
    </div>
  );
}

export function WalletRefreshStatus({ requested }: { requested: boolean }) {
  // Background fetching is deliberately not an input: it must stay silent.
  return requested ? <FullScreenLoader /> : null;
}

export function SectionEmptyState({ className = "" }: { className?: string }) {
  return (
    <div className={`section-empty-state ${className}`} role="status">
      No data for this section
    </div>
  );
}
