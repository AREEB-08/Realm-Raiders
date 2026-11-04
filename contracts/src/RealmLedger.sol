// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title RealmLedger — base seals, seed-locked battles, Night Captain orders and Renown (§15.2).
/// @notice Gameplay stays off-chain. This contract holds only commitments, so anyone can re-run a
///         replay and check it: the base hash is sealed before the raid, the seed is fixed by a
///         commit-reveal before tick 0, and the result commits the replay hash.
contract RealmLedger is AccessControl, EIP712 {
    bytes32 public constant RELAYER_ROLE = keccak256("RELAYER_ROLE");
    bytes32 private constant SEAL_TYPEHASH =
        keccak256("SealBase(address player,bytes32 baseHash,uint32 version,uint256 nonce,uint256 deadline)");
    bytes32 private constant POLICY_TYPEHASH = keccak256(
        "CommitPolicy(address player,uint32 nightId,bytes32 policyHash,uint64 expiresAt,uint256 nonce,uint256 deadline)"
    );

    struct Seal {
        bytes32 baseHash;
        uint32 version;
        uint64 sealedAt;
    }

    /// status: 0 none, 1 committed, 2 seeded, 3 resolved
    struct Battle {
        address attacker;
        address defender;
        bytes32 defenderBaseHash;
        bytes32 secretHash;
        bytes32 attackerNonce;
        uint64 commitBlock;
        bytes32 seed;
        bytes32 replayHash;
        uint8 stars;
        uint16 destructionBp;
        int32 renown;
        uint8 status;
    }

    struct Policy {
        bytes32 policyHash;
        uint64 expiresAt;
    }

    mapping(address => Seal) public sealOf;
    mapping(bytes32 => Battle) public battles; // battleId = keccak256(serverBattleUuid)
    mapping(address => mapping(uint32 => Policy)) public policyOf; // player => nightId (yyyymmdd) => policy
    mapping(address => int64) public renownOf;
    mapping(address => uint256) public nonces; // EIP-712 replay protection

    error EmptyHash();
    error Expired();
    error BadSignature();
    error BaseNotSealed();
    error BattleExists();
    error NotCommitted();
    error SameBlock();
    error BadSecret();
    error NotSeeded();
    error BadResult();
    error PolicyActive();
    error PolicyMismatch();

    event BaseSealed(address indexed player, bytes32 baseHash, uint32 version);
    event BattleCommitted(bytes32 indexed battleId, address indexed attacker, address indexed defender, bytes32 defenderBaseHash);
    event SeedLocked(bytes32 indexed battleId, bytes32 seed);
    event BattleResolved(
        bytes32 indexed battleId,
        address indexed attacker,
        address indexed defender,
        bytes32 replayHash,
        uint8 stars,
        uint16 destructionBp,
        int32 renown
    );
    event DefenseRecorded(
        bytes32 indexed battleId,
        address indexed attacker,
        address indexed defender,
        bytes32 replayHash,
        uint8 stars,
        uint16 destructionBp,
        int32 defenderRenown
    );
    event PolicyCommitted(address indexed player, uint32 indexed nightId, bytes32 policyHash, uint64 expiresAt);
    event AutopilotAction(address indexed player, uint32 indexed nightId, bytes32 policyHash, uint8 actionKind, bytes32 actionHash);

    constructor(address admin, address relayer) EIP712("RealmLedger", "1") {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (relayer != address(0)) _grantRole(RELAYER_ROLE, relayer);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // ------------------------------------------------------------- base seal (04)

    /// @notice The player seals their own layout (Privy-sponsored tx, msg.sender = player).
    function sealBase(bytes32 baseHash, uint32 version) external {
        _seal(msg.sender, baseHash, version);
    }

    /// @notice Relayer fallback with the player's EIP-712 signature.
    function sealBaseFor(address player, bytes32 baseHash, uint32 version, uint256 deadline, bytes calldata sig)
        external
        onlyRole(RELAYER_ROLE)
    {
        if (block.timestamp > deadline) revert Expired();
        bytes32 digest =
            _hashTypedDataV4(keccak256(abi.encode(SEAL_TYPEHASH, player, baseHash, version, nonces[player]++, deadline)));
        if (ECDSA.recover(digest, sig) != player) revert BadSignature();
        _seal(player, baseHash, version);
    }

    function _seal(address player, bytes32 baseHash, uint32 version) internal {
        if (baseHash == bytes32(0)) revert EmptyHash();
        sealOf[player] = Seal(baseHash, version, uint64(block.timestamp));
        emit BaseSealed(player, baseHash, version);
    }

    // ---------------------------------------------------------- battles (06–08)

    function commitBattle(
        bytes32 battleId,
        address attacker,
        address defender,
        bytes32 defenderBaseHash,
        bytes32 secretHash,
        bytes32 attackerNonce
    ) external onlyRole(RELAYER_ROLE) {
        if (defenderBaseHash == bytes32(0) || sealOf[defender].baseHash != defenderBaseHash) revert BaseNotSealed();
        Battle storage b = battles[battleId];
        if (b.status != 0) revert BattleExists();
        b.attacker = attacker;
        b.defender = defender;
        b.defenderBaseHash = defenderBaseHash;
        b.secretHash = secretHash;
        b.attackerNonce = attackerNonce;
        b.commitBlock = uint64(block.number);
        b.status = 1;
        emit BattleCommitted(battleId, attacker, defender, defenderBaseHash);
    }

    /// @notice Reveal in a later block: seed = keccak(secret, nonce, blockhash(commitBlock), prevrandao, id).
    ///         Neither the server (secret) nor the player (nonce) can pick the seed alone.
    function revealSeed(bytes32 battleId, bytes32 secret) external onlyRole(RELAYER_ROLE) {
        Battle storage b = battles[battleId];
        if (b.status != 1) revert NotCommitted();
        if (block.number <= b.commitBlock) revert SameBlock();
        if (keccak256(abi.encode(secret)) != b.secretHash) revert BadSecret();
        b.seed = keccak256(abi.encode(secret, b.attackerNonce, blockhash(b.commitBlock), block.prevrandao, battleId));
        b.status = 2;
        emit SeedLocked(battleId, b.seed);
    }

    function recordResult(bytes32 battleId, bytes32 replayHash, uint8 stars, uint16 destructionBp, int32 renown)
        external
        onlyRole(RELAYER_ROLE)
    {
        Battle storage b = _resolve(battleId, replayHash, stars, destructionBp, renown);
        renownOf[b.attacker] += renown;
        emit BattleResolved(battleId, b.attacker, b.defender, replayHash, stars, destructionBp, renown);
    }

    /// @notice A night defence (Night Captain): the Renown change goes to the defender.
    function recordDefence(bytes32 battleId, bytes32 replayHash, uint8 stars, uint16 destructionBp, int32 defenderRenown)
        external
        onlyRole(RELAYER_ROLE)
    {
        Battle storage b = _resolve(battleId, replayHash, stars, destructionBp, defenderRenown);
        renownOf[b.defender] += defenderRenown;
        emit DefenseRecorded(battleId, b.attacker, b.defender, replayHash, stars, destructionBp, defenderRenown);
    }

    function _resolve(bytes32 battleId, bytes32 replayHash, uint8 stars, uint16 destructionBp, int32 renown)
        internal
        returns (Battle storage b)
    {
        b = battles[battleId];
        if (b.status != 2) revert NotSeeded();
        if (stars > 3 || destructionBp > 10_000) revert BadResult();
        b.replayHash = replayHash;
        b.stars = stars;
        b.destructionBp = destructionBp;
        b.renown = renown;
        b.status = 3;
    }

    /// @notice The on-chain result commitment, identical to the off-chain `resultHash`.
    function resultHashOf(bytes32 battleId) external view returns (bytes32) {
        Battle storage b = battles[battleId];
        return keccak256(abi.encodePacked(b.replayHash, b.stars, b.destructionBp, uint32(b.renown)));
    }

    // ------------------------------------------------------ Night Captain (09/10)

    function commitPolicy(uint32 nightId, bytes32 policyHash, uint64 expiresAt) external {
        _commitPolicy(msg.sender, nightId, policyHash, expiresAt);
    }

    function commitPolicyFor(
        address player,
        uint32 nightId,
        bytes32 policyHash,
        uint64 expiresAt,
        uint256 deadline,
        bytes calldata sig
    ) external onlyRole(RELAYER_ROLE) {
        if (block.timestamp > deadline) revert Expired();
        if (ECDSA.recover(_policyDigest(player, nightId, policyHash, expiresAt, deadline), sig) != player) {
            revert BadSignature();
        }
        _commitPolicy(player, nightId, policyHash, expiresAt);
    }

    function _policyDigest(address player, uint32 nightId, bytes32 policyHash, uint64 expiresAt, uint256 deadline)
        internal
        returns (bytes32)
    {
        uint256 nonce = nonces[player]++;
        return _hashTypedDataV4(keccak256(abi.encode(POLICY_TYPEHASH, player, nightId, policyHash, expiresAt, nonce, deadline)));
    }

    function _commitPolicy(address player, uint32 nightId, bytes32 policyHash, uint64 expiresAt) internal {
        if (policyHash == bytes32(0)) revert EmptyHash();
        if (expiresAt <= block.timestamp) revert Expired();
        if (policyOf[player][nightId].expiresAt > block.timestamp) revert PolicyActive();
        policyOf[player][nightId] = Policy(policyHash, expiresAt);
        emit PolicyCommitted(player, nightId, policyHash, expiresAt);
    }

    /// @notice Every autopilot action carries the sealed policy hash; anything else reverts.
    function logAutopilot(address player, uint32 nightId, bytes32 policyHash, uint8 actionKind, bytes32 actionHash)
        external
        onlyRole(RELAYER_ROLE)
    {
        Policy memory p = policyOf[player][nightId];
        if (policyHash == bytes32(0) || p.policyHash != policyHash || block.timestamp > p.expiresAt) {
            revert PolicyMismatch();
        }
        emit AutopilotAction(player, nightId, policyHash, actionKind, actionHash);
    }
}
