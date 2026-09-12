export type Operation = {
  state: "idle" | "working" | "error" | "success";
  message?: string;
};
