import {
  CheckCircle2,
  CircleAlert,
  Info,
  LoaderCircle,
  RefreshCw,
} from "lucide-react";
import type { IntentOperation } from "./use-star-intents";

export function ActionStatus({
  message,
  state = "info",
  onRefresh,
  refreshing = false,
  refreshLabel = "Refresh",
}: {
  message?: string;
  state?: "working" | "success" | "error" | "info";
  onRefresh?: () => void;
  refreshing?: boolean;
  refreshLabel?: string;
}) {
  if (!message) return null;
  const Icon =
    state === "working"
      ? LoaderCircle
      : state === "success"
        ? CheckCircle2
        : state === "error"
          ? CircleAlert
          : Info;
  return (
    <div
      className={`action-status action-status-${state}`}
      role={state === "error" ? "alert" : "status"}
    >
      <Icon
        className={state === "working" ? "spin" : undefined}
        size={18}
        aria-hidden="true"
      />
      <span>{message}</span>
      {state === "error" && onRefresh && (
        <button
          className="action-status-refresh"
          type="button"
          aria-label={refreshLabel}
          title={refreshLabel}
          disabled={refreshing}
          aria-busy={refreshing}
          onClick={() => {
            if (!refreshing) onRefresh();
          }}
        >
          <RefreshCw
            className={refreshing ? "spin" : undefined}
            size={17}
            aria-hidden="true"
          />
        </button>
      )}
    </div>
  );
}

export function IntentStatus({
  operation,
  busy = false,
  error,
}: {
  operation: IntentOperation;
  busy?: boolean;
  error?: string;
}) {
  if (error) return <ActionStatus state="error" message={error} />;
  if (operation.state === "error")
    return <ActionStatus state="error" message={operation.message} />;
  // Action buttons own visible progress. Announce transaction progress and
  // confirmations without rendering a separate status line, including sync lag.
  const message =
    operation.state === "idle"
      ? busy
        ? "Preparing your request…"
        : undefined
      : operation.message;
  if (!message) return null;
  return (
    <span className="sr-only" role="status">
      {message}
    </span>
  );
}
