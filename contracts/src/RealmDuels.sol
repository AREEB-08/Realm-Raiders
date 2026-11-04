// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";

/// @title RealmDuels — Live Duel results between two commanders on the same Wi-Fi (spec F9).
/// @notice Both commanders attack each other's sealed base with ONE shared seed (locked by
///         commit-reveal in RealmLedger). The server re-simulates both replays and the relayer
///         records the result here once. The winner is decided by stars, then destruction; a full
///         tie is stored as a draw (winner = address(0)) — the replays, whose hashes are stored,
///         settle it by time off-chain.
contract RealmDuels is AccessControl {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");

    struct Duel {
        address playerA;
        address playerB;
        uint8 starsA;
        uint8 starsB;
        uint16 pctA;
        uint16 pctB;
        bytes32 replayHashA;
        bytes32 replayHashB;
        address winner;
        uint64 recordedAt;
    }

    mapping(bytes32 => Duel) private _duels;
    mapping(address => uint32) public winsOf;

    error DuelExists();
    error BadResult();
    error SamePlayer();

    event DuelRecorded(
        bytes32 indexed duelId,
        address indexed playerA,
        address indexed playerB,
        address winner,
        uint8 starsA,
        uint8 starsB,
        uint16 pctA,
        uint16 pctB,
        bytes32 replayHashA,
        bytes32 replayHashB
    );

    constructor(address admin, address relayer) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (relayer != address(0)) _grantRole(RELAYER_ROLE, relayer);
    }

    /// @param pctA destruction in basis points (0..10000), like RealmLedger results.
    function recordDuel(
        bytes32 duelId,
        address playerA,
        address playerB,
        uint8 starsA,
        uint8 starsB,
        uint16 pctA,
        uint16 pctB,
        bytes32 replayHashA,
        bytes32 replayHashB
    ) external onlyRole(RELAYER_ROLE) {
        if (_duels[duelId].recordedAt != 0) revert DuelExists();
        if (playerA == playerB || playerA == address(0) || playerB == address(0)) revert SamePlayer();
        if (starsA > 3 || starsB > 3 || pctA > 10000 || pctB > 10000) revert BadResult();
        address winner;
        if (starsA != starsB) winner = starsA > starsB ? playerA : playerB;
        else if (pctA != pctB) winner = pctA > pctB ? playerA : playerB;
        _duels[duelId] = Duel(playerA, playerB, starsA, starsB, pctA, pctB, replayHashA, replayHashB, winner, uint64(block.timestamp));
        if (winner != address(0)) winsOf[winner] += 1;
        emit DuelRecorded(duelId, playerA, playerB, winner, starsA, starsB, pctA, pctB, replayHashA, replayHashB);
    }

    function duelOf(bytes32 duelId) external view returns (Duel memory) {
        return _duels[duelId];
    }
}
