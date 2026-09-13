type MagicNameRevealProps = {
  name: string;
  className?: string;
};

export function MagicNameReveal({
  name,
  className = "",
}: MagicNameRevealProps) {
  const displayName = name.trim() || "Star";

  return (
    <div
      className={`magic-name-reveal ${className}`.trim()}
      aria-label={displayName}
    >
      <span className="magic-name-reveal-copy">
        <span className="magic-name-reveal-ink" aria-hidden="true">
          {displayName}
        </span>
        <span className="magic-name-reveal-glow" aria-hidden="true">
          {displayName}
        </span>

        <span className="magic-name-reveal-wand" aria-hidden="true">
          <svg viewBox="0 0 36 36">
            <path
              className="magic-name-reveal-wand-handle"
              d="m5 31 17-17"
            />
            <path
              className="magic-name-reveal-wand-tip"
              d="m24 2.8 2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5-4.7-4.6 6.5-.9L24 2.8Z"
            />
            <circle cx="31" cy="5" r="1.7" />
            <circle cx="13" cy="8" r="1.3" />
            <path
              className="magic-name-reveal-wand-spark"
              d="m8 14 1.2 3.1 3.1 1.2-3.1 1.2L8 22.6l-1.2-3.1-3.1-1.2 3.1-1.2L8 14Z"
            />
          </svg>
        </span>
      </span>
    </div>
  );
}
