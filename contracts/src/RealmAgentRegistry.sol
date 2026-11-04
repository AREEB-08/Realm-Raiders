// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title RealmAgentRegistry — fallback identity registry (§15.1).
/// @notice Deployed ONLY if the canonical ERC-8004 IdentityRegistry is unusable on the day.
///         Same `register(string)` surface: mints an agent card NFT to msg.sender.
contract RealmAgentRegistry is ERC721 {
    uint256 public nextId = 1;
    mapping(uint256 => string) private _uris;

    error NotOwner();

    event Registered(uint256 indexed agentId, string agentURI, address indexed owner);

    constructor() ERC721("Realm Raiders Agent", "RRAGENT") {}

    function register(string calldata agentURI) external returns (uint256 agentId) {
        agentId = nextId++;
        _uris[agentId] = agentURI;
        _safeMint(msg.sender, agentId);
        emit Registered(agentId, agentURI, msg.sender);
    }

    function setAgentURI(uint256 agentId, string calldata agentURI) external {
        if (ownerOf(agentId) != msg.sender) revert NotOwner();
        _uris[agentId] = agentURI;
    }

    function tokenURI(uint256 agentId) public view override returns (string memory) {
        _requireOwned(agentId);
        return _uris[agentId];
    }
}
