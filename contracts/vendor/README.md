# Forked Aqua and SwapVM contracts — unmodified copies

These contract sources have been forked from the official 1inch repositories by
copying their complete `src/` trees verbatim. They are upstream code, not original
Star Wallet contracts. Attribution is recorded here and above the project
description so the Solidity files themselves remain byte-for-byte unchanged.

Powered by Aqua — © Degensoft Ltd 2025.
Powered by SwapVM — © Degensoft Ltd 2025.

| Local directory | Official source | Pinned upstream commit | Solidity files |
| --- | --- | --- | --- |
| [`1inch-aqua/`](1inch-aqua/) | [1inch/aqua](https://github.com/1inch/aqua) | [`9c5c42e5840e8741fba3597c48456c9510212b66`](https://github.com/1inch/aqua/tree/9c5c42e5840e8741fba3597c48456c9510212b66) | 5 |
| [`1inch-swap-vm/`](1inch-swap-vm/) | [1inch/swap-vm](https://github.com/1inch/swap-vm) | [`f09a41e689240adc645934f965c8061749397cd2`](https://github.com/1inch/swap-vm/tree/f09a41e689240adc645934f965c8061749397cd2) | 52 |

Copied on 2026-09-05 from the existing local repository downloads after verifying
every selected file against the official GitHub tree at the pinned commit.
Each directory contains the complete upstream `src/`, `LICENSE`, `LICENSES/`, and
`THIRD_PARTY_NOTICES`, including original line endings and end-of-file bytes.

Do not edit or format the copied files. This includes adding fork comments,
changing compiler pragmas or import paths, and modifying VM instructions.
Star Wallet integration and deployment configuration belong outside these
directories. Preserve all upstream license and attribution notices.

Foundry now builds these snapshots for the SDK-free connector integration tests
using Solidity 0.8.30 and external dependency remappings. The Star vault validates
the pinned order/trait/opcode format; the backend's single-file connector is
tested against the upstream Solidity builders and locally deployed Aqua/router.
All integration code is outside the two copied directories.

The Sepolia deployment scripts compile these copies without editing them,
deploy Aqua and AquaSwapVMRouter, and record their exact runtime hashes before
the core Star deployment uses them. A public deployment is still required. See
[`backend/README.md`](../../backend/README.md) for the connector lifecycle test.

To verify every copied file, run from the project root:

```sh
cd contracts/vendor
shasum -a 256 -c SHA256SUMS
```

The checksum list covers both complete source trees and all copied license and
third-party notice files. The original upstream repositories and their copied
contract files were not modified to add this documentation.
