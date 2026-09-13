import { redirect } from "next/navigation";
import { kidGoalsHref } from "@/lib/kid-goals";

export default function KidRewardsPage() {
  redirect(kidGoalsHref({ tab: "ready" }));
}
