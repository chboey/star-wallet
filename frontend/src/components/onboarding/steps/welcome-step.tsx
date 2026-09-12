import Image from "next/image";
import type { CSSProperties } from "react";

type ParticleAsset =
  | "purple_glowing_star"
  | "purple_star"
  | "small_purple_orb"
  | "small_purple_orb2"
  | "small_yellow_orb"
  | "yellow_glowing_star"
  | "yellow_star";

type Particle = readonly [
  asset: ParticleAsset,
  x: number,
  y: number,
  size: number,
  driftX: number,
  driftY: number,
  duration: number,
];

const particles: Particle[] = [
  ["purple_star", 8, 3, 10, 4, 5, 8],
  ["small_yellow_orb", 23, 4, 5, -3, 4, 7],
  ["yellow_glowing_star", 31, 7, 15, 4, -5, 10],
  ["small_purple_orb2", 53, 3, 4, -3, 5, 9],
  ["small_purple_orb", 72, 5, 5, 3, 4, 8],
  ["yellow_star", 91, 6, 12, -4, 5, 11],
  ["purple_glowing_star", 88, 13, 11, 4, -4, 9],
  ["purple_star", 14, 10, 12, -4, 5, 10],
  ["yellow_glowing_star", 65, 9, 10, 4, -4, 9],
  ["yellow_star", 26, 15, 9, 4, -3, 9],
  ["purple_glowing_star", 50, 13, 9, -3, 4, 10],
  ["yellow_glowing_star", 76, 16, 11, 3, -4, 11],
  ["small_purple_orb", 3, 20, 5, 3, 5, 8],
  ["purple_glowing_star", 15, 25, 10, 4, -5, 11],
  ["yellow_star", 92, 21, 10, -4, 4, 10],
  ["yellow_star", 84, 27, 9, -3, 5, 8],
  ["yellow_glowing_star", 3, 30, 14, 4, -5, 9],
  ["purple_star", 92, 31, 15, -5, 4, 11],
  ["yellow_star", 5, 40, 8, 4, 4, 8],
  ["small_yellow_orb", 94, 41, 5, -3, -4, 7],
  ["purple_star", 8, 50, 14, 5, -4, 10],
  ["yellow_star", 20, 44, 8, -4, 5, 8],
  ["yellow_star", 86, 49, 11, 4, 5, 9],
  ["purple_glowing_star", 93, 59, 10, -4, -5, 11],
  ["purple_star", 17, 59, 12, 5, 4, 10],
  ["yellow_glowing_star", 80, 62, 11, -4, -5, 9],
  ["small_purple_orb2", 4, 64, 4, 3, -4, 8],
  ["yellow_glowing_star", 12, 70, 9, 4, 5, 10],
  ["purple_star", 31, 73, 14, -5, -4, 9],
  ["small_yellow_orb", 53, 69, 5, 3, 4, 7],
  ["yellow_star", 72, 76, 9, -4, 5, 10],
  ["small_purple_orb", 91, 72, 5, 3, -4, 8],
  ["purple_star", 6, 83, 9, 4, -4, 9],
  ["yellow_star", 23, 80, 10, -4, 5, 9],
  ["purple_glowing_star", 59, 79, 11, 4, -4, 10],
  ["yellow_star", 42, 84, 16, -5, 4, 11],
  ["purple_glowing_star", 68, 84, 12, 4, -5, 10],
  ["yellow_glowing_star", 91, 84, 15, -5, 4, 12],
];

const titleSafeParticles = particles.filter(
  ([, x, y]) => y < 18 || y > 41 || x < 10 || x > 90,
);

export function WelcomeStarfield() {
  return (
    <div className="welcome-starfield" aria-hidden="true">
      {titleSafeParticles.map(
        ([asset, x, y, size, driftX, driftY, duration], index) => (
          <span
            className={`welcome-particle welcome-particle-${asset}`}
            key={`${asset}-${index}`}
            style={
              {
                "--particle-x": `${x}%`,
                "--particle-y": `${y}%`,
                "--particle-size": `${size}px`,
                "--particle-drift-x": `${driftX}px`,
                "--particle-drift-y": `${driftY}px`,
                "--particle-duration": `${duration * 0.78}s`,
                "--particle-delay": `${-((index * 1.37) % duration)}s`,
                "--particle-turn": `${index % 2 === 0 ? 10 : -10}deg`,
              } as CSSProperties
            }
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

export function WelcomeStep({ onContinue }: { onContinue: () => void }) {
  return (
    <div className="step-screen welcome-step">
      <div className="step-body">
        <div className="step-details">
          <div className="center-copy">
            <h1 aria-label="Welcome to Star Wallet">
              Welcome to
              <br />
              <span className="welcome-title-swap" aria-hidden="true">
                <span className="welcome-title-measure">Star Wallet</span>
                <span className="welcome-title-swap-inner">
                  <span className="welcome-title-face welcome-title-word">
                    Star Wallet
                  </span>
                  <span className="welcome-title-face welcome-title-star">
                    <Image
                      src="/illustrations/onboarding/yellow_star.png"
                      alt=""
                      width={64}
                      height={64}
                    />
                  </span>
                </span>
              </span>
            </h1>
            <p>Help your kids build good habits.</p>
          </div>
        </div>
        <div className="welcome-artwork">
          <Image
            src="/illustrations/onboarding/shooting_star.png"
            alt="A smiling shooting star"
            fill
            sizes="(max-width: 520px) 84vw, 360px"
            priority
          />
        </div>
      </div>
      <div className="step-actions">
        <button className="primary-button" type="button" onClick={onContinue}>
          Get started
        </button>
      </div>
    </div>
  );
}
