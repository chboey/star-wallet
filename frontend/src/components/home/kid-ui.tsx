import { ChevronLeft } from "lucide-react";
import Image from "next/image";
import type { ReactNode } from "react";

const KID_ASSET_ROOT = "/illustrations/kid";

export function KidIllustration({
  name,
  alt,
  size,
  className = "",
}: {
  name: string;
  alt: string;
  size: number;
  className?: string;
}) {
  return (
    <Image
      className={`home-illustration kid-illustration ${className}`}
      src={`${KID_ASSET_ROOT}/${name}.png`}
      alt={alt}
      width={size}
      height={size}
    />
  );
}

export function KidScreenHeader({
  title,
  onBack,
  action,
  backDisabled = false,
}: {
  title: string;
  onBack?: () => void;
  action?: ReactNode;
  backDisabled?: boolean;
}) {
  return (
    <header className="kid-screen-header">
      {onBack ? (
        <button
          type="button"
          aria-label="Go back"
          disabled={backDisabled}
          onClick={onBack}
        >
          <ChevronLeft size={20} strokeWidth={2.3} />
        </button>
      ) : (
        <span aria-hidden="true" />
      )}
      <h1>{title}</h1>
      {action ?? <span aria-hidden="true" />}
    </header>
  );
}
