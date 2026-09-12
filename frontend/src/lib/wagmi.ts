import { createConfig, http } from "wagmi";
import { metaMask } from "wagmi/connectors";
import { sepolia } from "wagmi/chains";

export const sepoliaTransport = http(
  process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL || undefined,
);
export const wagmiConfig = createConfig({
  chains: [sepolia],
  connectors: [metaMask({ analytics: { enabled: false } })],
  transports: {
    [sepolia.id]: sepoliaTransport,
  },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
