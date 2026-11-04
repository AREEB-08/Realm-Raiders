// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";

/// @title RealmBadges — soulbound ERC-1155 badges (§15.4).
/// @notice 1 First Seal · 2 First Raid · 3 Three-Star · 4 Night Watch · 5 Siege Breaker · 6 Architect's Pupil.
contract RealmBadges is ERC1155, AccessControl {
    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");

    error Soulbound();
    error AlreadyAwarded();
    error UnknownBadge();

    constructor(address admin, address minter, string memory uri_) ERC1155(uri_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        if (minter != address(0)) _grantRole(MINTER_ROLE, minter);
    }

    function award(address to, uint256 badgeId) external onlyRole(MINTER_ROLE) {
        if (badgeId == 0 || badgeId > 6) revert UnknownBadge();
        if (balanceOf(to, badgeId) > 0) revert AlreadyAwarded();
        _mint(to, badgeId, 1, "");
    }

    function setURI(string calldata uri_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setURI(uri_);
    }

    /// @dev Soulbound: only mints (from == 0) may move a badge.
    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0)) revert Soulbound();
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
