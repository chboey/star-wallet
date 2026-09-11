import { getAddress, keccak256 } from "viem";

export function isDryRun(value) {
  if (value === undefined || value.trim() === "") return false;
  if (value.trim() === "true") return true;
  if (value.trim() === "false") return false;
  throw new Error(
    "DRY_RUN must be true or false; refusing to broadcast with an ambiguous value",
  );
}

/** Check actual executable code against the pinned build, masking only solc's
 * declared immutable slots. Callers also verify the immutable dependency getters. */
export function assertCompiledRuntime(artifact, code) {
  if (
    !code ||
    code === "0x" ||
    code.length !== artifact.deployedBytecode.length
  )
    throw new Error(
      `${artifact.contractName} runtime length does not match the pinned build`,
    );
  const normalize = (hex) => {
    const bytes = Buffer.from(hex.slice(2), "hex");
    for (const slots of Object.values(artifact.immutableReferences ?? {}))
      for (const { start, length } of slots)
        bytes.fill(0, start, start + length);
    return `0x${bytes.toString("hex")}`;
  };
  if (normalize(code) !== normalize(artifact.deployedBytecode))
    throw new Error(
      `${artifact.contractName} runtime does not match the pinned build`,
    );
  return keccak256(code);
}

export function assertAddress(name, actual, expected) {
  if (getAddress(actual) !== getAddress(expected))
    throw new Error(`${name} is ${actual}; expected ${expected}`);
}
