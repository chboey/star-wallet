"use client";

import { QuestInbox } from "../quest-inbox";

export function KidQuestsScreen({
  embedded = false,
  enabled = true,
}: { embedded?: boolean; enabled?: boolean } = {}) {
  return (
    <div
      className={
        embedded ? "kid-journey-module" : "wallet-screen kid-flow-screen"
      }
    >
      <QuestInbox childOnly enabled={enabled} />
    </div>
  );
}
