// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Test} from "forge-std/Test.sol";
import {RealmLedger} from "../src/RealmLedger.sol";
import {ClanSiege} from "../src/ClanSiege.sol";
import {RealmBadges} from "../src/RealmBadges.sol";

/// Minimum suite from §15.9.
contract RealmLedgerTest is Test {
    RealmLedger ledger;
    ClanSiege siege;
    RealmBadges badges;
    address relayer = makeAddr("relayer");
    uint256 playerKey = 0xA11CE;
    address player;
    address npc = makeAddr("npc");
    bytes32 constant BASE = keccak256("base");
    bytes32 constant SEAL_TYPEHASH =
        keccak256("SealBase(address player,bytes32 baseHash,uint32 version,uint256 nonce,uint256 deadline)");
    bytes32 constant POLICY_TYPEHASH = keccak256(
        "CommitPolicy(address player,uint32 nightId,bytes32 policyHash,uint64 expiresAt,uint256 nonce,uint256 deadline)"
    );

    function setUp() public {
        player = vm.addr(playerKey);
        ledger = new RealmLedger(address(this), relayer);
        siege = new ClanSiege(address(this), relayer);
        badges = new RealmBadges(address(this), relayer, "https://api/badges/{id}.json");
        vm.warp(1_800_000_000);
    }

    function _sign(bytes32 structHash) internal view returns (bytes memory) {
        bytes32 digest = keccak256(abi.encodePacked("\x19\x01", ledger.domainSeparator(), structHash));
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(playerKey, digest);
        return abi.encodePacked(r, s, v);
    }

    // ---------------------------------------------------------------- seals

    function test_sealBase_storesAndEmits() public {
        vm.expectEmit(true, false, false, true);
        emit RealmLedger.BaseSealed(player, BASE, 1);
        vm.prank(player);
        ledger.sealBase(BASE, 1);
        (bytes32 h, uint32 v, uint64 at) = ledger.sealOf(player);
        assertEq(h, BASE);
        assertEq(v, 1);
        assertEq(at, block.timestamp);
    }

    function test_sealBaseFor_acceptsSignature() public {
        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _sign(keccak256(abi.encode(SEAL_TYPEHASH, player, BASE, uint32(2), uint256(0), deadline)));
        vm.prank(relayer);
        ledger.sealBaseFor(player, BASE, 2, deadline, sig);
        (bytes32 h,,) = ledger.sealOf(player);
        assertEq(h, BASE);
    }

    function test_sealBaseFor_rejectsBadSigExpiredAndReplay() public {
        uint256 deadline = block.timestamp + 60;
        bytes memory sig = _sign(keccak256(abi.encode(SEAL_TYPEHASH, player, BASE, uint32(2), uint256(0), deadline)));
        vm.startPrank(relayer);
        vm.expectRevert(RealmLedger.BadSignature.selector);
        ledger.sealBaseFor(npc, BASE, 2, deadline, sig);
        ledger.sealBaseFor(player, BASE, 2, deadline, sig);
        vm.expectRevert(RealmLedger.BadSignature.selector); // nonce moved on: replay fails
        ledger.sealBaseFor(player, BASE, 2, deadline, sig);
        vm.warp(deadline + 1);
        vm.expectRevert(RealmLedger.Expired.selector);
        ledger.sealBaseFor(player, BASE, 2, deadline, sig);
        vm.stopPrank();
    }

    function test_onlyRelayer() public {
        vm.expectRevert();
        ledger.commitBattle(bytes32(uint256(1)), player, npc, BASE, bytes32(0), bytes32(0));
    }

    // -------------------------------------------------------- commit / reveal

    function _commit(bytes32 id, bytes32 secret) internal {
        vm.prank(npc);
        ledger.sealBase(BASE, 1);
        vm.prank(relayer);
        ledger.commitBattle(id, player, npc, BASE, keccak256(abi.encode(secret)), keccak256("nonce"));
    }

    function test_commit_revertsWhenUnsealedOrMismatched() public {
        vm.startPrank(relayer);
        vm.expectRevert(RealmLedger.BaseNotSealed.selector);
        ledger.commitBattle(bytes32(uint256(1)), player, npc, BASE, bytes32(0), bytes32(0));
        vm.stopPrank();
        vm.prank(npc);
        ledger.sealBase(BASE, 1);
        vm.prank(relayer);
        vm.expectRevert(RealmLedger.BaseNotSealed.selector);
        ledger.commitBattle(bytes32(uint256(1)), player, npc, keccak256("other"), bytes32(0), bytes32(0));
    }

    function test_reveal_needsLaterBlockAndRightSecret() public {
        bytes32 id = keccak256("battle");
        bytes32 secret = keccak256("secret");
        _commit(id, secret);
        vm.startPrank(relayer);
        vm.expectRevert(RealmLedger.SameBlock.selector);
        ledger.revealSeed(id, secret);
        vm.roll(block.number + 1);
        vm.expectRevert(RealmLedger.BadSecret.selector);
        ledger.revealSeed(id, keccak256("wrong"));
        ledger.revealSeed(id, secret);
        vm.stopPrank();
        (,,,,,, bytes32 seed,,,,, uint8 status) = ledger.battles(id);
        assertTrue(seed != bytes32(0));
        assertEq(status, 2);
    }

    function test_recordResult_requiresSeedAndBounds_andAccumulatesRenown() public {
        bytes32 id = keccak256("b2");
        bytes32 secret = keccak256("s2");
        _commit(id, secret);
        vm.startPrank(relayer);
        vm.expectRevert(RealmLedger.NotSeeded.selector);
        ledger.recordResult(id, keccak256("r"), 3, 10_000, 40);
        vm.roll(block.number + 1);
        ledger.revealSeed(id, secret);
        vm.expectRevert(RealmLedger.BadResult.selector);
        ledger.recordResult(id, keccak256("r"), 4, 10_000, 40);
        ledger.recordResult(id, keccak256("r"), 3, 10_000, 40);
        vm.stopPrank();
        assertEq(ledger.renownOf(player), 40);
        assertEq(
            ledger.resultHashOf(id), keccak256(abi.encodePacked(keccak256("r"), uint8(3), uint16(10_000), uint32(40)))
        );
    }

    function testFuzz_recordResult_bounds(uint8 stars, uint16 bp) public {
        bytes32 id = keccak256(abi.encode(stars, bp));
        bytes32 secret = keccak256("fz");
        _commit(id, secret);
        vm.roll(block.number + 1);
        vm.startPrank(relayer);
        ledger.revealSeed(id, secret);
        if (stars > 3 || bp > 10_000) vm.expectRevert(RealmLedger.BadResult.selector);
        ledger.recordResult(id, bytes32(0), stars, bp, 1);
        vm.stopPrank();
    }

    // ---------------------------------------------------------- Night Captain

    function test_policy_cannotOverwriteActive_andAutopilotChecksHash() public {
        bytes32 ph = keccak256("orders");
        uint64 exp = uint64(block.timestamp + 8 hours);
        vm.prank(player);
        ledger.commitPolicy(20261103, ph, exp);
        vm.prank(player);
        vm.expectRevert(RealmLedger.PolicyActive.selector);
        ledger.commitPolicy(20261103, keccak256("new orders"), exp);
        vm.startPrank(relayer);
        ledger.logAutopilot(player, 20261103, ph, 1, keccak256("repair"));
        vm.expectRevert(RealmLedger.PolicyMismatch.selector);
        ledger.logAutopilot(player, 20261103, keccak256("forged"), 3, keccak256("retaliate"));
        vm.warp(exp + 1);
        vm.expectRevert(RealmLedger.PolicyMismatch.selector);
        ledger.logAutopilot(player, 20261103, ph, 1, keccak256("late"));
        vm.stopPrank();
    }

    function test_commitPolicyFor_signature() public {
        bytes32 ph = keccak256("orders");
        uint64 exp = uint64(block.timestamp + 8 hours);
        uint256 deadline = block.timestamp + 60;
        bytes memory sig =
            _sign(keccak256(abi.encode(POLICY_TYPEHASH, player, uint32(20261103), ph, exp, uint256(0), deadline)));
        vm.prank(relayer);
        ledger.commitPolicyFor(player, 20261103, ph, exp, deadline, sig);
        (bytes32 stored,) = ledger.policyOf(player, 20261103);
        assertEq(stored, ph);
    }

    // ---------------------------------------------------------------- siege

    function test_siege_hpNeverUnderflows_defeatedOnce() public {
        vm.prank(relayer);
        siege.startSiege(1, 25, uint64(block.timestamp + 30 minutes));
        address[] memory ps = new address[](1);
        uint32[] memory taps = new uint32[](1);
        uint32[] memory dmg = new uint32[](1);
        ps[0] = player;
        taps[0] = 2;
        dmg[0] = 20;
        vm.prank(player);
        siege.hit(1);
        vm.recordLogs();
        vm.startPrank(relayer);
        siege.hitBatch(1, ps, taps, dmg, keccak256("root"));
        siege.hitBatch(1, ps, taps, dmg, keccak256("root2"));
        vm.stopPrank();
        (, uint64 hpLeft,, uint32 total, bool defeated) = siege.sieges(1);
        assertEq(hpLeft, 0);
        assertTrue(defeated);
        assertEq(total, 5);
        uint256 defeatedEvents;
        bytes32 topic = keccak256("BossDefeated(uint256,address)");
        for (uint256 i = 0; i < vm.getRecordedLogs().length; i++) {
            if (vm.getRecordedLogs()[i].topics[0] == topic) defeatedEvents++;
        }
        assertEq(defeatedEvents, 1);
        vm.prank(player);
        vm.expectRevert(ClanSiege.SiegeOver.selector);
        siege.hit(1);
    }

    // --------------------------------------------------------------- badges

    function test_badges_soulbound_andOnce() public {
        vm.startPrank(relayer);
        badges.award(player, 1);
        vm.expectRevert(RealmBadges.AlreadyAwarded.selector);
        badges.award(player, 1);
        vm.stopPrank();
        assertEq(badges.balanceOf(player, 1), 1);
        vm.prank(player);
        vm.expectRevert(RealmBadges.Soulbound.selector);
        badges.safeTransferFrom(player, npc, 1, 1, "");
    }
}
