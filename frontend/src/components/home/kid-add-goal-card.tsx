"use client";

import { Plus } from "lucide-react";

export function KidAddGoalCard({ onOpen }: { onOpen: () => void }) {
  return (
    <button
      className="kid-new-goal-card"
      type="button"
      aria-haspopup="dialog"
      onClick={onOpen}
    >
      <span className="kid-new-goal-copy">
        <strong>Add a new goal</strong>
        <small>Choose your next dream</small>
      </span>
      <Plus className="kid-new-goal-plus" size={22} aria-hidden="true" />
    </button>
  );
}
