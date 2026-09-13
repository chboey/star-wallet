"use client";

import { Plus } from "lucide-react";

export function CreateAquaPositionCard({
  onCreate,
  disabled = false,
  checking = false,
  note,
}: {
  onCreate: () => void;
  disabled?: boolean;
  checking?: boolean;
  note?: string;
}) {
  return (
    <button
      className="create-aqua-position-card"
      type="button"
      aria-label="Create Aqua position"
      aria-busy={checking}
      disabled={disabled || checking}
      onClick={onCreate}
    >
      <span className="create-aqua-position-icon" aria-hidden="true">
        <Plus size={20} />
      </span>
      <span>
        {checking ? "Checking savings position…" : "Create Aqua position"}
      </span>
      {note && <small>{note}</small>}
    </button>
  );
}
