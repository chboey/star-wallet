// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import { Math } from "@openzeppelin/contracts/utils/math/Math.sol";
import { MakerTraitsLib } from "../vendor/1inch-swap-vm/src/libs/MakerTraits.sol";
import { TakerTraitsLib } from "../vendor/1inch-swap-vm/src/libs/TakerTraits.sol";
import { Deadline, Salt } from "../vendor/1inch-swap-vm/src/instructions/Controls.sol";
import { FeeFlatIn } from "../vendor/1inch-swap-vm/src/instructions/FeeFlat.sol";
import { XYCConcentrateSwap } from "../vendor/1inch-swap-vm/src/instructions/XYCConcentrate.sol";

/// Independent encoding oracle: calls the unmodified upstream Solidity builders.
library ConnectorReference {
    function buildOrder(
        address maker,
        address tokenA,
        address tokenB,
        uint256 rawMin,
        uint256 rawMax,
        uint16 feeBps,
        uint64 salt,
        uint40 deadline
    ) internal pure returns (bytes memory) {
        bytes memory program = Deadline.build(deadline);
        if (feeBps > 0) program = bytes.concat(program, FeeFlatIn.build(uint24(feeBps) * 1_000));
        program = bytes.concat(
            program,
            XYCConcentrateSwap.build(
                Math.sqrt(rawMin * 1e18, Math.Rounding.Ceil), Math.sqrt(rawMax * 1e18)
            ),
            Salt.build(salt)
        );
        MakerTraitsLib.Args memory args;
        args.maker = maker;
        args.tokenA = tokenA;
        args.tokenB = tokenB;
        args.useAquaInsteadOfSignature = true;
        args.program = program;
        return abi.encode(MakerTraitsLib.build(args));
    }

    function buildTaker(bool isAToB, uint256 minimumOutput, uint40 deadline)
        internal
        pure
        returns (bytes memory)
    {
        TakerTraitsLib.Args memory args;
        args.isExactIn = true;
        args.useTransferFromAndAquaPush = true;
        args.isAToB = isAToB;
        args.threshold = minimumOutput == 0 ? bytes("") : abi.encodePacked(minimumOutput);
        args.deadline = deadline;
        return TakerTraitsLib.build(args);
    }
}

contract AquaConnectorHarness {
    function buildOrder(
        address maker,
        address tokenA,
        address tokenB,
        uint256 rawMin,
        uint256 rawMax,
        uint16 feeBps,
        uint64 salt,
        uint40 deadline
    ) external pure returns (bytes memory) {
        return ConnectorReference.buildOrder(
            maker, tokenA, tokenB, rawMin, rawMax, feeBps, salt, deadline
        );
    }

    function buildTaker(bool isAToB, uint256 minimumOutput, uint40 deadline)
        external
        pure
        returns (bytes memory)
    {
        return ConnectorReference.buildTaker(isAToB, minimumOutput, deadline);
    }
}
