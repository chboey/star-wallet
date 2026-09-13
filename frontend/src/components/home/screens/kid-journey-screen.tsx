"use client";

import {
  type TouchEvent,
  type WheelEvent,
  useEffect,
  useRef,
  useState,
} from "react";
import { KidGoalsScreen } from "./kid-goals-screen";
import { KidQuestsScreen } from "./kid-quests-screen";
import type { KidGoalTab } from "@/lib/kid-goals";

export type KidJourneySection = "quests" | "goals";
type JourneyDirection = "next" | "previous";

const journeySections = [
  { id: "quests", label: "Quests" },
  { id: "goals", label: "Goals" },
] as const;

export function KidJourneyScreen({
  initialSection,
  initialGoalTab,
  initialGoalId,
}: {
  initialSection: KidJourneySection;
  initialGoalTab?: KidGoalTab;
  initialGoalId?: string;
}) {
  const pageRef = useRef<HTMLDivElement>(null);
  const [section, setSection] = useState(initialSection);
  const [direction, setDirection] = useState<JourneyDirection | null>(null);
  const wheelDistanceRef = useRef(0);
  const wheelResetRef = useRef<number | null>(null);
  const pagingUnlockRef = useRef<number | null>(null);
  const overlaySequenceRef = useRef(0);
  const pagingLockedRef = useRef(false);
  const [switchOverlay, setSwitchOverlay] = useState<{
    id: KidJourneySection;
    sequence: number;
  } | null>(() => ({ id: initialSection, sequence: 0 }));
  const touchRef = useRef<{
    y: number;
    atTop: boolean;
    atBottom: boolean;
  } | null>(null);

  useEffect(() => {
    if (!switchOverlay) return;
    const timer = window.setTimeout(() => setSwitchOverlay(null), 2_000);
    return () => window.clearTimeout(timer);
  }, [switchOverlay]);

  useEffect(
    () => () => {
      if (wheelResetRef.current !== null) {
        window.clearTimeout(wheelResetRef.current);
      }
      if (pagingUnlockRef.current !== null) {
        window.clearTimeout(pagingUnlockRef.current);
      }
    },
    [],
  );

  const selectSection = (id: KidJourneySection) => {
    if (id === section) return;

    const currentIndex = journeySections.findIndex(
      ({ id: sectionId }) => sectionId === section,
    );
    const nextIndex = journeySections.findIndex(
      ({ id: sectionId }) => sectionId === id,
    );

    setDirection(nextIndex > currentIndex ? "next" : "previous");
    setSection(id);
    overlaySequenceRef.current += 1;
    setSwitchOverlay({ id, sequence: overlaySequenceRef.current });
    pagingLockedRef.current = true;
    if (pagingUnlockRef.current !== null) {
      window.clearTimeout(pagingUnlockRef.current);
    }
    pagingUnlockRef.current = window.setTimeout(() => {
      pagingLockedRef.current = false;
    }, 360);

    const url = new URL(window.location.href);
    url.searchParams.set("section", id);
    window.history.replaceState(
      window.history.state,
      "",
      `${url.pathname}${url.search}${url.hash}`,
    );

    pageRef.current
      ?.closest<HTMLElement>(".wallet-app-scroll")
      ?.scrollTo({ top: 0, behavior: "auto" });
  };

  const moveSection = (step: -1 | 1) => {
    const currentIndex = journeySections.findIndex(({ id }) => id === section);
    const nextSection = journeySections[currentIndex + step];
    if (nextSection) selectSection(nextSection.id);
  };

  const handleWheel = (event: WheelEvent<HTMLDivElement>) => {
    if (
      pagingLockedRef.current ||
      pageRef.current?.querySelector(
        ".kid-journey-panel:not([hidden]) .kid-screen-header",
      ) ||
      (event.target as HTMLElement).closest('[role="dialog"]')
    ) {
      return;
    }

    const scrollRoot =
      pageRef.current?.closest<HTMLElement>(".wallet-app-scroll");
    if (!scrollRoot) return;

    const atTop = scrollRoot.scrollTop <= 2;
    const atBottom =
      scrollRoot.scrollTop + scrollRoot.clientHeight >=
      scrollRoot.scrollHeight - 2;
    const movingNext = event.deltaY > 0 && atBottom;
    const movingPrevious = event.deltaY < 0 && atTop;

    if (!movingNext && !movingPrevious) {
      wheelDistanceRef.current = 0;
      return;
    }

    wheelDistanceRef.current += event.deltaY;
    if (wheelResetRef.current !== null) {
      window.clearTimeout(wheelResetRef.current);
    }
    wheelResetRef.current = window.setTimeout(() => {
      wheelDistanceRef.current = 0;
    }, 180);

    if (Math.abs(wheelDistanceRef.current) < 64) return;

    const step = wheelDistanceRef.current > 0 ? 1 : -1;
    wheelDistanceRef.current = 0;
    moveSection(step);
  };

  const handleTouchStart = (event: TouchEvent<HTMLDivElement>) => {
    if (
      pageRef.current?.querySelector(
        ".kid-journey-panel:not([hidden]) .kid-screen-header",
      ) ||
      (event.target as HTMLElement).closest('[role="dialog"]')
    ) {
      touchRef.current = null;
      return;
    }

    const scrollRoot =
      pageRef.current?.closest<HTMLElement>(".wallet-app-scroll");
    const touch = event.touches[0];
    if (!scrollRoot || !touch) return;

    touchRef.current = {
      y: touch.clientY,
      atTop: scrollRoot.scrollTop <= 2,
      atBottom:
        scrollRoot.scrollTop + scrollRoot.clientHeight >=
        scrollRoot.scrollHeight - 2,
    };
  };

  const handleTouchEnd = (event: TouchEvent<HTMLDivElement>) => {
    const start = touchRef.current;
    const touch = event.changedTouches[0];
    touchRef.current = null;
    if (!start || !touch || pagingLockedRef.current) return;

    const distance = start.y - touch.clientY;
    if (distance > 48 && start.atBottom) moveSection(1);
    if (distance < -48 && start.atTop) moveSection(-1);
  };

  return (
    <div
      className="wallet-screen kid-journey-page"
      ref={pageRef}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
    >
      <nav
        className={`kid-journey-pager ${
          switchOverlay ? "overlay-visible" : ""
        }`}
        aria-label="Dream sections"
      >
        {journeySections.map(({ id, label }) => (
          <button
            className={section === id ? "active" : ""}
            type="button"
            aria-label={`Show ${label}`}
            aria-current={section === id ? "page" : undefined}
            onClick={() => selectSection(id)}
            title={label}
            key={id}
          >
            <span className="kid-journey-pager-line" aria-hidden="true" />
          </button>
        ))}
      </nav>

      {switchOverlay && (
        <div
          className="kid-journey-switch-overlay"
          style={{
            top: `calc(50% + ${
              (journeySections.findIndex(({ id }) => id === switchOverlay.id) -
                (journeySections.length - 1) / 2) *
              36
            }px)`,
          }}
          role="status"
          aria-live="polite"
          key={switchOverlay.sequence}
        >
          <span>
            {journeySections.find(({ id }) => id === switchOverlay.id)?.label}
          </span>
        </div>
      )}

      <section
        className={`kid-journey-panel ${
          section === "quests" && direction
            ? `kid-journey-panel-${direction}`
            : ""
        }`}
        id="kid-journey-panel-quests"
        aria-label="Quests"
        hidden={section !== "quests"}
      >
        <KidQuestsScreen embedded enabled={section === "quests"} />
      </section>
      <section
        className={`kid-journey-panel ${
          section === "goals" && direction
            ? `kid-journey-panel-${direction}`
            : ""
        }`}
        id="kid-journey-panel-goals"
        aria-label="Goals"
        hidden={section !== "goals"}
      >
        <KidGoalsScreen
          initialView="list"
          initialTab={initialGoalTab}
          initialGoalId={initialGoalId}
          embedded
        />
      </section>
    </div>
  );
}
