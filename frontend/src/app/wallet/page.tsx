import { HomeDashboard } from "@/components/home/screens/home-dashboard";
import type { Hash } from "viem";

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{
    rewardApproval?: string;
    tx?: string | string[];
  }>;
}) {
  const { rewardApproval, tx } = await searchParams;
  const values = tx === undefined ? [] : Array.isArray(tx) ? tx : [tx];
  const transactionHashes = values.filter((value): value is Hash =>
    /^0x[0-9a-fA-F]{64}$/.test(value),
  );

  return (
    <HomeDashboard
      initialRewardApprovalHashes={
        rewardApproval === "approved" ? transactionHashes : undefined
      }
    />
  );
}
