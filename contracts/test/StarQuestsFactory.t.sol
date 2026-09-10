// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { StarQuests } from "../src/StarQuests.sol";
import { StarQuestsFactory } from "../src/StarQuestsFactory.sol";
import { StarRegistry } from "../src/StarRegistry.sol";

contract QuestVaultHarness {
    function createLedger(StarQuestsFactory factory, StarRegistry registry, uint256 familyId)
        external
        returns (StarQuests)
    {
        return factory.create(registry, familyId);
    }
}

contract StarQuestsFactoryTest {
    StarRegistry private registry;
    StarQuestsFactory private factory;
    uint256 private familyId;

    function setUp() public {
        registry = new StarRegistry();
        factory = new StarQuestsFactory();
        familyId = registry.createFamily("family.starwallet.eth");
    }

    function testCreatesFamilyLedgerBoundToCallingVault() public {
        StarQuests quests = factory.create(registry, familyId);

        require(address(quests.registry()) == address(registry), "registry");
        require(quests.familyId() == familyId, "family");
        require(quests.vault() == address(this), "calling vault");
        require(quests.nextQuestId() == 1 && quests.nextRequestId() == 1, "fresh ledger");
    }

    function testEachVaultReceivesAnIndependentLedger() public {
        QuestVaultHarness firstVault = new QuestVaultHarness();
        QuestVaultHarness secondVault = new QuestVaultHarness();
        StarQuests first = firstVault.createLedger(factory, registry, familyId);
        StarQuests second = secondVault.createLedger(factory, registry, familyId);

        require(address(first) != address(second), "unique ledgers");
        require(first.vault() == address(firstVault), "first vault");
        require(second.vault() == address(secondVault), "second vault");
        require(address(factory).code.length <= 24_576, "EIP-170 factory size");
    }
}
