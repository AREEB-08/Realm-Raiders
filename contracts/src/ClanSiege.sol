// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title ClanSiege — every tap is a hit (§15.3, §15.5).
/// @notice Per-tap mode: the player calls `hit` (sponsored). Batched mode: the relayer submits one
///         `hitBatch` per second with the Merkle root of the tap log, so any tap is provable.
contract ClanSiege is AccessControl {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    uint32 public constant TAP_DMG = 10;

    struct Siege {
        uint64 bossHp;
        uint64 hpLeft;
        uint64 endsAt;
        uint32 totalHits;
        bool defeated;
    }

    mapping(uint256 => Siege) public sieges;
    mapping(uint256 => mapping(address => uint32)) public hitsOf;

    error NoSiege();
    error SiegeExists();
    error SiegeOver();
    error LengthMismatch();

    event SiegeStarted(uint256 indexed siegeId, uint64 bossHp, uint64 endsAt);
    event Hit(uint256 indexed siegeId, address indexed player, uint32 dmg, uint64 hpLeft);
    event HitBatch(uint256 indexed siegeId, uint32 taps, uint64 dmg, bytes32 tapLogRoot, uint64 hpLeft);
    event BossDefeated(uint256 indexed siegeId, address finalBlow);

    constructor(address admin, address relayer) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (relayer != address(0)) _grantRole(RELAYER_ROLE, relayer);
    }

    function startSiege(uint256 siegeId, uint64 bossHp, uint64 endsAt) external onlyRole(RELAYER_ROLE) {
        if (sieges[siegeId].bossHp != 0) revert SiegeExists();
        sieges[siegeId] = Siege(bossHp, bossHp, endsAt, 0, false);
        emit SiegeStarted(siegeId, bossHp, endsAt);
    }

    function hit(uint256 siegeId) external {
        Siege storage s = sieges[siegeId];
        if (s.bossHp == 0) revert NoSiege();
        if (s.defeated || block.timestamp > s.endsAt) revert SiegeOver();
        s.hpLeft = s.hpLeft > TAP_DMG ? s.hpLeft - TAP_DMG : 0;
        s.totalHits += 1;
        hitsOf[siegeId][msg.sender] += 1;
        emit Hit(siegeId, msg.sender, TAP_DMG, s.hpLeft);
        if (s.hpLeft == 0) {
            s.defeated = true;
            emit BossDefeated(siegeId, msg.sender);
        }
    }

    /// @notice Batches may land after the boss falls or the window closes (offline backfill);
    ///         HP never underflows and BossDefeated is emitted exactly once.
    function hitBatch(
        uint256 siegeId,
        address[] calldata players,
        uint32[] calldata taps,
        uint32[] calldata dmg,
        bytes32 tapLogRoot
    ) external onlyRole(RELAYER_ROLE) {
        Siege storage s = sieges[siegeId];
        if (s.bossHp == 0) revert NoSiege();
        if (players.length != taps.length || taps.length != dmg.length) revert LengthMismatch();
        uint64 total;
        uint32 count;
        for (uint256 i = 0; i < players.length; i++) {
            hitsOf[siegeId][players[i]] += taps[i];
            total += dmg[i];
            count += taps[i];
        }
        s.totalHits += count;
        s.hpLeft = s.hpLeft > total ? s.hpLeft - total : 0;
        emit HitBatch(siegeId, count, total, tapLogRoot, s.hpLeft);
        if (s.hpLeft == 0 && !s.defeated) {
            s.defeated = true;
            emit BossDefeated(siegeId, players.length > 0 ? players[players.length - 1] : address(0));
        }
    }
}
