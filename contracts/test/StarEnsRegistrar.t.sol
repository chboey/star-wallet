// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarEnsRegistrar, IStarEnsRegistry, IStarEnsFactory } from "../src/StarEnsRegistrar.sol";

interface EnsVm {
    function prank(address) external;
    function warp(uint256) external;
    function expectRevert() external;
}

contract TestEnsRegistry {
    mapping(uint256 => IStarEnsRegistry.State) public states;
    mapping(uint256 => address) public subregistries;
    mapping(uint256 => address) public resolvers;
    mapping(address => uint256) public roles;
    address public parent;
    string public parentLabel;
    bool private initialized;

    function initialize(address owner, uint256 bitmap) external {
        require(!initialized);
        initialized = true;
        roles[owner] = bitmap;
    }

    function findTokenId(string memory label) public pure returns (uint256) {
        return uint256(keccak256(bytes(label)));
    }

    function getState(uint256 id) external view returns (IStarEnsRegistry.State memory) {
        return states[id];
    }

    function getSubregistry(string memory label) external view returns (address) {
        return subregistries[findTokenId(label)];
    }

    function getParent() external view returns (address, string memory) {
        return (parent, parentLabel);
    }

    function hasRootRoles(uint256 bitmap, address account) external view returns (bool) {
        return roles[account] & bitmap == bitmap;
    }

    function setParent(address registry, string calldata label) external {
        require(roles[msg.sender] != 0);
        parent = registry;
        parentLabel = label;
    }

    function grantRootRoles(uint256 bitmap, address account) external returns (bool) {
        require(roles[msg.sender] != 0);
        roles[account] |= bitmap;
        return true;
    }

    function revokeRootRoles(uint256 bitmap, address account) external returns (bool) {
        require(roles[msg.sender] != 0);
        roles[account] &= ~bitmap;
        return true;
    }

    function register(
        string calldata label,
        address owner,
        address registry,
        address resolver,
        uint256,
        uint64 expiry
    ) external returns (uint256 id) {
        require(roles[msg.sender] & 1 == 1);
        id = findTokenId(label);
        require(states[id].status == 0);
        states[id] = IStarEnsRegistry.State(2, expiry, owner, id, id);
        subregistries[id] = registry;
        resolvers[id] = resolver;
    }
}

contract TestEnsResolver {
    address public owner;
    mapping(bytes32 => address) public addr;

    function initialize(address owner_, uint256, bytes[] calldata setters) external {
        require(owner == address(0));
        owner = owner_;
        for (uint256 i; i < setters.length; ++i) {
            (bool ok,) = address(this).call(setters[i]);
            require(ok);
        }
    }

    function setAddr(bytes32 node, address target) external {
        require(msg.sender == address(this) || msg.sender == owner);
        addr[node] = target;
    }
}

contract TestEnsFactory {
    address public immutable registryImpl;
    mapping(address => address) public implementations;

    constructor(address registryImpl_) {
        registryImpl = registryImpl_;
    }

    function trust(address proxy, address implementation) external {
        implementations[proxy] = implementation;
    }

    function verifyContract(address proxy) external view returns (address) {
        return implementations[proxy];
    }

    function deployProxy(address implementation, uint256, bytes calldata data)
        external
        returns (address proxy)
    {
        proxy = implementation == registryImpl
            ? address(new TestEnsRegistry())
            : address(new TestEnsResolver());
        implementations[proxy] = implementation;
        (bool ok,) = proxy.call(data);
        require(ok);
    }
}

contract StarEnsRegistrarTest {
    EnsVm constant vm = EnsVm(address(uint160(uint256(keccak256("hevm cheat code")))));
    address constant APP = address(0xAAA);
    address constant PARENT = address(0xBBB);
    address constant OTHER = address(0xCCC);
    bytes32 constant SECRET = bytes32(uint256(123));
    uint256 constant OWNER_ROLES =
        0x1111111111111111111111111111111111111111111111111111111111111111;
    TestEnsRegistry eth;
    TestEnsRegistry namespace;
    StarEnsRegistrar registrar;

    function setUp() public {
        vm.warp(1000000);
        eth = new TestEnsRegistry();
        eth.initialize(address(this), OWNER_ROLES);
        namespace = new TestEnsRegistry();
        namespace.initialize(APP, OWNER_ROLES);
        vm.prank(APP);
        namespace.setParent(address(eth), "starwallet");
        eth.register(
            "starwallet",
            APP,
            address(namespace),
            address(0),
            OWNER_ROLES,
            uint64(block.timestamp + 2 days)
        );
        TestEnsRegistry registryImpl = new TestEnsRegistry();
        TestEnsFactory factory = new TestEnsFactory(address(registryImpl));
        factory.trust(address(namespace), address(registryImpl));
        registrar = new StarEnsRegistrar(
            address(eth),
            "starwallet",
            address(factory),
            address(registryImpl),
            address(new TestEnsResolver())
        );
        vm.prank(APP);
        namespace.grantRootRoles(1, address(registrar));
    }

    function commit(string memory label, address parent, bytes32 secret)
        private
        returns (bytes32 hash)
    {
        hash = registrar.makeCommitment(label, parent, secret);
        vm.prank(parent);
        registrar.commit(hash);
    }

    function testParentClaimsWithoutRootRolesAndReceivesLinkedRegistry() public {
        commit("tan", PARENT, SECRET);
        vm.warp(block.timestamp + 10);
        vm.prank(PARENT);
        uint256 id = registrar.registerFamily("tan", SECRET);
        require(namespace.getState(id).latestOwner == PARENT);
        require(namespace.roles(PARENT) == 0 && namespace.roles(address(registrar)) == 1);
        TestEnsRegistry child = TestEnsRegistry(namespace.subregistries(id));
        require(child.roles(PARENT) == OWNER_ROLES && child.roles(address(registrar)) == 0);
        (address ancestor, string memory label) = child.getParent();
        require(ancestor == address(namespace) && keccak256(bytes(label)) == keccak256("tan"));
        bytes32 node = keccak256(abi.encodePacked(registrar.parentNode(), keccak256("tan")));
        require(TestEnsResolver(namespace.resolvers(id)).addr(node) == PARENT);
        require(eth.getState(eth.findTokenId("starwallet")).latestOwner == APP);
        vm.prank(PARENT);
        child.register(
            "jasmine", PARENT, address(0), address(0), OWNER_ROLES, uint64(block.timestamp + 1 days)
        );
        vm.expectRevert();
        vm.prank(OTHER);
        child.register(
            "sibling", OTHER, address(0), address(0), OWNER_ROLES, uint64(block.timestamp + 1 days)
        );
    }

    function testCopiedCommitmentAndSecretCannotClaimForAnotherWallet() public {
        bytes32 hash = commit("tan", PARENT, SECRET);
        vm.prank(OTHER);
        registrar.commit(hash);
        vm.warp(block.timestamp + 10);
        vm.expectRevert();
        vm.prank(OTHER);
        registrar.registerFamily("tan", SECRET);
        vm.prank(PARENT);
        registrar.registerFamily("tan", SECRET);
    }

    function testCommitmentDelayExpiryAndNoReset() public {
        bytes32 hash = commit("tan", PARENT, SECRET);
        vm.expectRevert();
        vm.prank(PARENT);
        registrar.commit(hash);
        vm.expectRevert();
        vm.prank(PARENT);
        registrar.registerFamily("tan", SECRET);
        vm.warp(block.timestamp + 1 days + 1);
        vm.expectRevert();
        vm.prank(PARENT);
        registrar.registerFamily("tan", SECRET);
        vm.prank(PARENT);
        registrar.commit(hash);
        vm.warp(block.timestamp + 10);
        vm.prank(PARENT);
        registrar.registerFamily("tan", SECRET);
        vm.expectRevert();
        vm.prank(PARENT);
        registrar.registerFamily("tan", SECRET);
    }

    function testNoOverwriteAndFailedClaimKeepsCommitment() public {
        commit("tan", PARENT, SECRET);
        bytes32 otherHash = commit("tan", OTHER, SECRET);
        vm.warp(block.timestamp + 10);
        vm.prank(PARENT);
        registrar.registerFamily("tan", SECRET);
        vm.expectRevert();
        vm.prank(OTHER);
        registrar.registerFamily("tan", SECRET);
        require(registrar.commitments(OTHER, otherHash) != 0);
        require(namespace.getState(namespace.findTokenId("tan")).latestOwner == PARENT);
    }

    function testOwnerCanRevokeRegistrationAndExpiryFailsClosed() public {
        commit("tan", PARENT, SECRET);
        vm.warp(block.timestamp + 10);
        vm.prank(APP);
        namespace.revokeRootRoles(1, address(registrar));
        vm.expectRevert();
        vm.prank(PARENT);
        registrar.registerFamily("tan", SECRET);
        vm.prank(APP);
        namespace.grantRootRoles(1, address(registrar));
        vm.warp(block.timestamp + 3 days);
        commit("tan", PARENT, SECRET);
        vm.warp(block.timestamp + 10);
        vm.expectRevert();
        vm.prank(PARENT);
        registrar.registerFamily("tan", SECRET);
    }

    function testRejectsDotsUnicodeUppercaseAndEmptySecret() public {
        string[7] memory labels = ["a", "Tan", "a.b", "-tan", "tan-", "ab--cd", unicode"tán"];
        for (uint256 i; i < labels.length; ++i) {
            vm.expectRevert();
            registrar.makeCommitment(labels[i], PARENT, SECRET);
        }
        vm.expectRevert();
        registrar.makeCommitment("tan", PARENT, bytes32(0));
        vm.expectRevert();
        registrar.makeCommitment("tan", address(0), SECRET);
    }
}
