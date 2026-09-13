import { RewardApprovalScreen } from "@/components/home/screens/reward-approval-screen";

export default async function RewardApprovalPage({
  params,
}: {
  params: Promise<{ rewardId: string }>;
}) {
  const { rewardId } = await params;
  return <RewardApprovalScreen rewardId={rewardId} />;
}
