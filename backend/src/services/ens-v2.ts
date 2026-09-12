import {
  concatHex,
  encodeAbiParameters,
  getCreate2Address,
  keccak256,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';

// ABI subset and role encoding from the pinned official ENSv2 deployment.
// https://github.com/ensdomains/contracts-v2/tree/97a57293f3b4279d94b571e678edb53ce62638f4/contracts
export const ensRegistryAbi = parseAbi([
  'function getSubregistry(string label) view returns (address)',
  'function findTokenId(string label) view returns (uint256)',
  'function getState(uint256 id) view returns ((uint8 status,uint64 expiry,address latestOwner,uint256 tokenId,uint256 resource))',
  'function hasRoles(uint256 id,uint256 roles,address account) view returns (bool)',
  'function hasRootRoles(uint256 roles,address account) view returns (bool)',
  'function grantRootRoles(uint256 roles,address account) returns (bool)',
  'function getParent() view returns (address parent,string label)',
  'function getResolver(string label) view returns (address)',
  'function initialize(address rootAccount,uint256 roleBitmap)',
  'function setParent(address parent,string label)',
  'function setSubregistry(uint256 id,address registry)',
  'function register(string label,address owner,address registry,address resolver,uint256 roleBitmap,uint64 expiry) returns (uint256)',
]);
export const ensFactoryAbi = parseAbi([
  'function proxyLogic() view returns (address)',
  'function deployProxy(address implementation,uint256 salt,bytes data) returns (address)',
  'function verifyContract(address proxy) view returns (address)',
]);
export const ensResolverAbi = parseAbi([
  'function initialize(address admin,uint256 roleBitmap,bytes[] setters)',
  'function addr(bytes32 node) view returns (address)',
  'function setAddr(bytes32 node,address address_)',
  'function hasRootRoles(uint256 roles,address account) view returns (bool)',
]);
// EnhancedAccessControl uses one role bit per nybble, not contiguous permission bits.
// Full management stays with the named owner, never with the API or factory.
export const ENS_OWNER_ROLES = BigInt('0x' + '1'.repeat(64));
export const ENS_REGISTRAR_ROLE = 1n;
export const ENS_SET_SUBREGISTRY_ROLE = 1n << 20n;

/** Exact CloneProxyBytecode CREATE2 derivation used by the deployed factory.
 * Appending outerSalt is required; a standard EIP-1167 clone has a different address. */
export function ensProxyAddress(
  factory: Address,
  logic: Address,
  signer: Address,
  salt: bigint,
): Address {
  const outerSalt = keccak256(
    encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }], [signer, salt]),
  );
  const bytecode = concatHex([
    '0x3d604d80600a3d3981f3363d3d373d3d3d363d73',
    logic,
    '0x5af43d82803e903d91602b57fd5bf3',
    outerSalt,
  ]);
  return getCreate2Address({ from: factory, salt: outerSalt, bytecodeHash: keccak256(bytecode) });
}

export type EnsTransaction = {
  chainId: 11155111;
  from: Address;
  to: Address;
  data: Hex;
  value: '0';
};
export type EnsPlan = {
  status: 'READY' | 'TRANSACTION_REQUIRED';
  step:
    | 'DEPLOY_REGISTRY'
    | 'SET_REGISTRY_PARENT'
    | 'ATTACH_REGISTRY'
    | 'DEPLOY_RESOLVER'
    | 'REGISTER_SUBDOMAIN'
    | 'AUTHORIZE_FAMILY_REGISTRAR'
    | 'COMMIT_FAMILY_NAME'
    | 'REGISTER_FAMILY_NAME'
    | null;
  name: string;
  checkedAtBlock: string;
  transaction: EnsTransaction | null;
  // Send only this transaction, wait for its receipt, then repeat the same request.
  requiresConfirmation: boolean;
};
export type RegisterSubdomainInput = {
  parentName?: string;
  label: string;
  signer: Address;
  owner: Address;
  address: Address;
  expiresAt?: bigint;
};

export type EnsFamilyPlan =
  | EnsPlan
  | {
      status: 'WAITING';
      name: string;
      checkedAtBlock: string;
      readyAt: string;
      step: null;
      transaction: null;
      requiresConfirmation: false;
    };
