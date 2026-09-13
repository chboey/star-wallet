"use client";

import { useRef } from "react";
import { ParentActionSheet } from "./parent-action-sheet";
import { WethFundingForm } from "./weth-funding-form";

export function WethFundingSheet({ onClose }: { onClose: () => void }) {
  const busy = useRef(false);

  return (
    <ParentActionSheet
      title="Add WETH"
      className="weth-funding-sheet"
      onClose={() => {
        if (!busy.current) onClose();
      }}
    >
      <WethFundingForm
        onBusyChange={(pending) => {
          busy.current = pending;
        }}
        onDone={onClose}
      />
    </ParentActionSheet>
  );
}
