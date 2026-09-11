// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { ReentrancyGuard } from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @dev ABI subsets of ENSv2 at ensdomains/contracts-v2@97a57293f3b4279d94b571e678edb53ce62638f4.
interface IStarEnsRegistry {
    struct State {
        uint8 status;
        uint64 expiry;
        address latestOwner;
        uint256 tokenId;
        uint256 resource;
    }

    function findTokenId(string calldata label) external view returns (uint256);
    function getState(uint256 id) external view returns (State memory);
    function getSubregistry(string calldata label) external view returns (address);
    function getParent() external view returns (address, string memory);
    function hasRootRoles(uint256 roles, address account) external view returns (bool);
    function initialize(address rootAccount, uint256 roles) external;
    function setParent(address registry, string calldata label) external;
    function grantRootRoles(uint256 roles, address account) external returns (bool);
    function revokeRootRoles(uint256 roles, address account) external returns (bool);
    function register(
        string calldata label,
        address owner,
        address registry,
        address resolver,
        uint256 roles,
        uint64 expiry
    ) external returns (uint256);
}

interface IStarEnsFactory {
    function deployProxy(address implementation, uint256 salt, bytes calldata data)
        external
        returns (address);
    function verifyContract(address proxy) external view returns (address);
}

interface IStarEnsResolver {
    function initialize(address admin, uint256 roles, bytes[] calldata setters) external;
    function setAddr(bytes32 node, address target) external;
}

/// @notice Parent-signed family names under one app-owned ENSv2 namespace.
/// @dev The namespace owner grants ONLY ROLE_REGISTRAR to this contract once.
/// No arbitrary calls, recipient overrides, token transfers or parent-wide ENS permissions.
contract StarEnsRegistrar is ReentrancyGuard {
    uint256 public constant OWNER_ROLES =
        0x1111111111111111111111111111111111111111111111111111111111111111;
    uint256 public constant REGISTRAR_ROLE = 1;
    uint64 public constant MIN_COMMITMENT_AGE = 10;
    uint64 public constant MAX_COMMITMENT_AGE = 1 days;

    IStarEnsRegistry public immutable ethRegistry;
    IStarEnsFactory public immutable factory;
    address public immutable registryImplementation;
    address public immutable resolverImplementation;
    bytes32 public immutable parentNode;
    string public parentLabel;
    mapping(address => mapping(bytes32 => uint64)) public commitments;

    error InvalidConfiguration();
    error InvalidLabel();
    error InvalidCommitment();
    error CommitmentPending();
    error CommitmentTooEarly();
    error CommitmentExpired();
    error NamespaceUnavailable();
    error RegistrarNotAuthorized();
    error NameUnavailable();

    event CommitmentMade(address indexed parent, bytes32 indexed commitment, uint64 timestamp);
    event FamilyNameRegistered(
        bytes32 indexed node,
        address indexed parent,
        string label,
        address registry,
        address resolver,
        uint64 expiry
    );

    constructor(
        address ethRegistry_,
        string memory parentLabel_,
        address factory_,
        address registryImplementation_,
        address resolverImplementation_
    ) {
        if (
            ethRegistry_.code.length == 0 || factory_.code.length == 0
                || registryImplementation_.code.length == 0
                || resolverImplementation_.code.length == 0
        ) revert InvalidConfiguration();
        _validateLabel(parentLabel_);
        ethRegistry = IStarEnsRegistry(ethRegistry_);
        parentLabel = parentLabel_;
        factory = IStarEnsFactory(factory_);
        registryImplementation = registryImplementation_;
        resolverImplementation = resolverImplementation_;
        bytes32 ethNode = keccak256(abi.encodePacked(bytes32(0), keccak256("eth")));
        parentNode = keccak256(abi.encodePacked(ethNode, keccak256(bytes(parentLabel_))));
    }

    function makeCommitment(string memory label, address parent, bytes32 secret)
        public
        view
        returns (bytes32)
    {
        _validateLabel(label);
        if (parent == address(0) || secret == bytes32(0)) revert InvalidCommitment();
        return
            keccak256(abi.encode(block.chainid, address(this), parentNode, label, parent, secret));
    }

    function commit(bytes32 commitment) external {
        if (commitment == bytes32(0)) revert InvalidCommitment();
        uint64 previous = commitments[msg.sender][commitment];
        if (previous != 0 && block.timestamp <= uint256(previous) + MAX_COMMITMENT_AGE) {
            revert CommitmentPending();
        }
        commitments[msg.sender][commitment] = uint64(block.timestamp);
        emit CommitmentMade(msg.sender, commitment, uint64(block.timestamp));
    }

    /// @notice Both name ownership and address resolution are bound to msg.sender.
    /// @dev The family registry is linked and handed to the parent atomically.
    function registerFamily(string calldata label, bytes32 secret)
        external
        nonReentrant
        returns (uint256 tokenId)
    {
        bytes32 commitment = makeCommitment(label, msg.sender, secret);
        uint64 committedAt = commitments[msg.sender][commitment];
        if (committedAt == 0) revert InvalidCommitment();
        if (block.timestamp < uint256(committedAt) + MIN_COMMITMENT_AGE) {
            revert CommitmentTooEarly();
        }
        if (block.timestamp > uint256(committedAt) + MAX_COMMITMENT_AGE) {
            revert CommitmentExpired();
        }
        (IStarEnsRegistry namespace, uint64 expiry) = _namespace();
        tokenId = namespace.findTokenId(label);
        if (namespace.getState(tokenId).status != 0) revert NameUnavailable();
        delete commitments[msg.sender][commitment];

        bytes32 node = keccak256(abi.encodePacked(parentNode, keccak256(bytes(label))));
        uint256 salt = uint256(keccak256(abi.encode(commitment, tokenId, address(namespace))));
        IStarEnsRegistry childRegistry = IStarEnsRegistry(
            factory.deployProxy(
                registryImplementation,
                salt,
                abi.encodeCall(IStarEnsRegistry.initialize, (address(this), OWNER_ROLES))
            )
        );
        childRegistry.setParent(address(namespace), label);
        childRegistry.grantRootRoles(OWNER_ROLES, msg.sender);
        childRegistry.revokeRootRoles(OWNER_ROLES, address(this));
        bytes[] memory setters = new bytes[](1);
        setters[0] = abi.encodeCall(IStarEnsResolver.setAddr, (node, msg.sender));
        address resolver = factory.deployProxy(
            resolverImplementation,
            uint256(keccak256(abi.encode(salt, "resolver"))),
            abi.encodeCall(IStarEnsResolver.initialize, (msg.sender, OWNER_ROLES, setters))
        );
        tokenId = namespace.register(
            label, msg.sender, address(childRegistry), resolver, OWNER_ROLES, expiry
        );
        emit FamilyNameRegistered(node, msg.sender, label, address(childRegistry), resolver, expiry);
    }

    function namespaceRegistry() external view returns (address registry, uint64 expiry) {
        (IStarEnsRegistry namespace, uint64 end) = _namespace();
        return (address(namespace), end);
    }

    function _namespace() private view returns (IStarEnsRegistry namespace, uint64 expiry) {
        IStarEnsRegistry.State memory parent =
            ethRegistry.getState(ethRegistry.findTokenId(parentLabel));
        if (parent.status != 2 || parent.expiry <= block.timestamp + 60) {
            revert NamespaceUnavailable();
        }
        address registry = ethRegistry.getSubregistry(parentLabel);
        if (registry == address(0) || factory.verifyContract(registry) != registryImplementation) {
            revert NamespaceUnavailable();
        }
        namespace = IStarEnsRegistry(registry);
        (address ancestor, string memory label) = namespace.getParent();
        if (
            ancestor != address(ethRegistry)
                || keccak256(bytes(label)) != keccak256(bytes(parentLabel))
        ) revert NamespaceUnavailable();
        if (!namespace.hasRootRoles(REGISTRAR_ROLE, address(this))) {
            revert RegistrarNotAuthorized();
        }
        return (namespace, parent.expiry);
    }

    /// @dev Canonical ASCII family labels. No dots, Unicode lookalikes or encoded labels.
    function _validateLabel(string memory label) private pure {
        bytes memory value = bytes(label);
        if (
            value.length < 2 || value.length > 63 || value[0] == "-"
                || value[value.length - 1] == "-"
        ) revert InvalidLabel();
        if (value.length >= 4 && value[2] == "-" && value[3] == "-") revert InvalidLabel();
        for (uint256 i; i < value.length; ++i) {
            bytes1 c = value[i];
            if (!((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c == "-")) {
                revert InvalidLabel();
            }
        }
    }
}
