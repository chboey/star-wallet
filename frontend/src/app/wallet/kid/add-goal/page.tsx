import { KidGoalRequestScreen } from "@/components/home/screens/kid-goal-request-screen";
import type { GoalIconId } from "@/lib/goal-requests";

export default async function AddGoalPage({
  searchParams,
}: {
  searchParams: Promise<{ icon?: string }>;
}) {
  const { icon } = await searchParams;
  const initialIcon =
    icon && /^[0-6]$/.test(icon) ? (Number(icon) as GoalIconId) : undefined;
  return (
    <KidGoalRequestScreen
      key={initialIcon ?? "choose"}
      initialIcon={initialIcon}
    />
  );
}
