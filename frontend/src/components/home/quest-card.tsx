import { ChevronRight } from "lucide-react";
import { Children, useState, type ReactNode } from "react";
import { questIllustration } from "@/lib/quest-templates";
import { StarValue } from "./home-ui";
import { KidIllustration } from "./kid-ui";
import { ParentActionSheet } from "./parent-action-sheet";
import styles from "./quest-inbox.module.css";

export function QuestCard({
  title,
  stars,
  subtitle,
  children,
  expandable = Children.toArray(children).length > 0,
  onOpen,
  disabled = false,
  initiallyOpen = false,
  popupTitle = "Quest",
}: {
  title: string;
  stars: string;
  subtitle?: string;
  children?: ReactNode;
  expandable?: boolean;
  onOpen?: () => void;
  disabled?: boolean;
  initiallyOpen?: boolean;
  popupTitle?: string;
}) {
  const [expanded, setExpanded] = useState(initiallyOpen);
  const illustration =
    popupTitle === "Star request" ? "star_sparkle" : questIllustration(title);
  const heading = (
    <>
      <KidIllustration name={illustration} alt="" size={64} />
      <span className={styles.questCopy}>
        <strong>{title}</strong>
        <StarValue compact>+{stars}</StarValue>
        {subtitle && <small>{subtitle}</small>}
      </span>
      {(onOpen || expandable) && (
        <ChevronRight
          className={styles.questChevron}
          size={19}
          aria-hidden="true"
        />
      )}
    </>
  );
  if (onOpen)
    return (
      <button
        className={`${styles.questCard} ${styles.questSummary} ${styles.questLink}`}
        type="button"
        aria-label={`View quest: ${title}`}
        disabled={disabled}
        onClick={onOpen}
      >
        {heading}
      </button>
    );
  if (!expandable)
    return (
      <article className={styles.questCard}>
        <div className={styles.questSummary}>{heading}</div>
      </article>
    );
  return (
    <>
      <button
        className={`${styles.questCard} ${styles.questSummary} ${styles.questLink}`}
        type="button"
        aria-label={`View ${popupTitle.toLowerCase()}: ${title}`}
        disabled={disabled}
        onClick={() => setExpanded(true)}
      >
        {heading}
      </button>
      {expanded && (
        <ParentActionSheet
          title={popupTitle}
          onClose={() => {
            if (!disabled) setExpanded(false);
          }}
        >
          <div className="request-review-content quest-popup-content">
            <KidIllustration name={illustration} alt="" size={180} />
            <h3>{title}</h3>
            {subtitle && <p>{subtitle}</p>}
            <StarValue>+{stars}</StarValue>
            {children}
          </div>
        </ParentActionSheet>
      )}
    </>
  );
}
