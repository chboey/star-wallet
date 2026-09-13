"use client";

import { ArrowLeftRight, ListChecks, Target } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useRouter } from "next/navigation";
import { starApi } from "@/lib/star-api";
import { starReadOptions } from "@/lib/wallet-refresh";
import { useReadOnEntry } from "../use-read-on-entry";
import { goalIllustration } from "@/lib/star-format";
import { FloatingStarfield, type StarParticle } from "../floating-starfield";
import { FullScreenLoader, SectionEmptyState } from "../home-ui";
import { KidIllustration } from "../kid-ui";
import { MagicNameReveal } from "../magic-name-reveal";
import { useStarData } from "../star-data-provider";

export type KidPlaygroundSlot = 1 | 2 | 3 | 4;

export type KidPlaygroundItem = {
  slot: KidPlaygroundSlot;
  title: string;
  illustration: string;
};

const playgroundSlots = [
  1, 2, 3, 4,
] as const satisfies readonly KidPlaygroundSlot[];

const profileStarParticles = [
  ["yellow_glowing_star", 27, 7, 8, 3, -3, 8],
  ["purple_star", 41, 5, 7, -3, 3, 9],
  ["small_yellow_orb", 55, 7, 3, 2, 3, 7],
  ["purple_glowing_star", 70, 5, 8, 3, -3, 10],
  ["yellow_star", 8, 19, 9, -3, 4, 8],
  ["purple_star", 16, 34, 7, 3, -3, 9],
  ["small_purple_orb2", 6, 48, 3, -2, 3, 7],
  ["yellow_glowing_star", 15, 63, 8, 3, -4, 9],
  ["purple_star", 7, 78, 7, -3, 3, 8],
  ["yellow_star", 17, 91, 7, 2, -3, 9],
  ["purple_glowing_star", 91, 17, 8, 3, -4, 9],
  ["yellow_star", 83, 32, 7, -3, 3, 8],
  ["small_purple_orb", 95, 46, 3, 2, -3, 7],
  ["purple_star", 85, 60, 8, -3, 4, 10],
  ["yellow_glowing_star", 94, 76, 8, 3, -3, 9],
  ["purple_star", 83, 91, 7, -2, -3, 8],
] as const satisfies readonly StarParticle[];

export function KidPlayground({
  items,
  childName,
}: {
  items: readonly KidPlaygroundItem[];
  childName: string;
}) {
  const itemsBySlot = new Map(items.map((item) => [item.slot, item]));

  return (
    <section
      className="kid-profile-playground"
      aria-label={`${childName}'s playground`}
    >
      <div className="kid-playground-stage">
        <KidIllustration
          className="kid-playground-background"
          name="podium-new"
          alt=""
          size={520}
        />
        <MagicNameReveal
          className="kid-playground-name"
          name={`${childName}'s Toys`}
        />
        {playgroundSlots.map((slot) => {
          const item = itemsBySlot.get(slot);

          if (!item) {
            return null;
          }

          return (
            <div
              className={`kid-playground-prize kid-playground-prize-slot-${slot}`}
              title={item.title}
              key={slot}
            >
              <KidIllustration
                name={item.illustration}
                alt={item.title}
                size={104}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function KidProfileScreen() {
  const router = useRouter();
  const { child, childName, familyId } = useStarData();
  const completedQuests = useQuery({
    ...starReadOptions,
    queryKey: [
      "star",
      "family",
      familyId,
      "child",
      child?.id,
      "completed-quests",
    ],
    queryFn: ({ signal }) =>
      starApi.completedQuestCount(familyId!, child!.id, { signal }),
    enabled: Boolean(familyId && child),
  });
  useReadOnEntry(
    ["star", "family", familyId, "child", child?.id, "completed-quests"],
    Boolean(familyId && child),
  );
  if (!child) {
    return (
      <div className="wallet-screen kid-flow-screen kid-profile-screen">
        <section className="kid-profile-overview">
          <SectionEmptyState />
        </section>
        <section className="kid-profile-stats">
          <SectionEmptyState />
        </section>
        <KidPlayground items={[]} childName={childName} />
      </div>
    );
  }
  if (familyId && completedQuests.isPending) return <FullScreenLoader />;
  const completedGoals = (child.goals ?? []).filter(
    (goal) => goal.status === "COMPLETED",
  );
  const kidProfileStats = [
    {
      label: "Quests completed",
      value: completedQuests.error
        ? "—"
        : (completedQuests.data?.toString() ?? "—"),
      icon: ListChecks,
      className: "kid-profile-stat-quests",
    },
    {
      label: "Goals completed",
      value: completedGoals.length.toString(),
      icon: Target,
      className: "kid-profile-stat-goals",
    },
  ] as const;
  const playgroundItems: KidPlaygroundItem[] = [...completedGoals]
    .sort(
      (left, right) =>
        Number(right.completedAt ?? right.updatedAt) -
        Number(left.completedAt ?? left.updatedAt),
    )
    .slice(0, 4)
    .map((goal, index) => ({
      slot: (index + 1) as KidPlaygroundSlot,
      title: goal.title,
      illustration: goalIllustration(goal.title, goal.icon),
    }));

  return (
    <div className="wallet-screen kid-flow-screen kid-profile-screen">
      <section className="kid-profile-overview">
        <div className="kid-profile-avatar">
          <FloatingStarfield
            className="kid-profile-starfield"
            particles={profileStarParticles}
          />
          <KidIllustration
            name="kid"
            alt={`${childName}'s profile`}
            size={132}
          />
          <button
            type="button"
            aria-label="Switch profiles"
            onClick={() => router.push("/wallet/profiles")}
          >
            <ArrowLeftRight size={18} strokeWidth={2.2} aria-hidden="true" />
          </button>
        </div>

        <h1>{childName}</h1>
      </section>

      <section
        className="kid-profile-stats"
        aria-label={`${childName}'s achievements`}
      >
        {kidProfileStats.map(({ label, value, icon: Icon, className }) => (
          <div className={className} key={label}>
            <Icon size={31} strokeWidth={2.2} aria-hidden="true" />
            <small>{label}</small>
            <strong>{value}</strong>
          </div>
        ))}
      </section>

      {completedQuests.error && (
        <p className="intent-operation intent-operation-error" role="alert">
          Couldn&apos;t load completed quests.{" "}
          <button
            type="button"
            onClick={() => void completedQuests.refetch()}
            disabled={completedQuests.isFetching}
          >
            Try again
          </button>
        </p>
      )}

      <KidPlayground items={playgroundItems} childName={childName} />
    </div>
  );
}
