import Image from "next/image";
import type { CSSProperties } from "react";

export type StarParticleAsset =
  | "purple_glowing_star"
  | "purple_star"
  | "small_purple_orb"
  | "small_purple_orb2"
  | "small_yellow_orb"
  | "yellow_glowing_star"
  | "yellow_star";

export type StarParticle = readonly [
  asset: StarParticleAsset,
  x: number,
  y: number,
  size: number,
  driftX: number,
  driftY: number,
  duration: number,
];

export function FloatingStarfield({
  particles,
  className,
  yUnit = "%",
  sizeScale = 1,
}: {
  particles: readonly StarParticle[];
  className: string;
  yUnit?: "%" | "px";
  sizeScale?: number;
}) {
  return (
    <div className={className} aria-hidden="true">
      {particles.map(
        ([asset, x, y, size, driftX, driftY, duration], index) => (
          <span
            className={`welcome-particle welcome-particle-${asset}`}
            style={
              {
                "--particle-x": `${x}%`,
                "--particle-y": `${y}${yUnit}`,
                "--particle-size": `${size * sizeScale}px`,
                "--particle-drift-x": `${driftX}px`,
                "--particle-drift-y": `${driftY}px`,
                "--particle-duration": `${duration}s`,
                "--particle-delay": `${-((index * 0.71) % duration)}s`,
                "--particle-turn": `${index % 2 === 0 ? 9 : -9}deg`,
              } as CSSProperties
            }
            key={`${asset}-${x}-${y}-${index}`}
          >
            <Image
              src={`/illustrations/onboarding/${asset}.png`}
              alt=""
              width={96}
              height={96}
            />
          </span>
        ),
      )}
    </div>
  );
}
