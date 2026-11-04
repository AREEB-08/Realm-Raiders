// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Script, console} from "forge-std/Script.sol";
import {RealmLedger} from "../src/RealmLedger.sol";
import {ClanSiege} from "../src/ClanSiege.sol";
import {RealmBadges} from "../src/RealmBadges.sol";

/// forge script script/Deploy.s.sol --account monad-deployer --rpc-url https://testnet-rpc.monad.xyz --broadcast --slow
/// Deploys the three contracts, grants the relayer its roles and writes deployments/<chainId>.json.
contract Deploy is Script {
    function run() external {
        address relayer = vm.envAddress("RELAYER_ADDRESS");
        string memory badgeUri = vm.envOr("BADGE_URI", string("https://realmraiders.pages.dev/badges/{id}.json"));
        vm.startBroadcast();
        address admin = msg.sender;
        RealmLedger ledger = new RealmLedger(admin, relayer);
        ClanSiege siege = new ClanSiege(admin, relayer);
        RealmBadges badges = new RealmBadges(admin, relayer, badgeUri);
        vm.stopBroadcast();

        string memory key = "deployment";
        vm.serializeUint(key, "chainId", block.chainid);
        vm.serializeAddress(key, "RealmLedger", address(ledger));
        vm.serializeAddress(key, "ClanSiege", address(siege));
        vm.serializeAddress(key, "RealmBadges", address(badges));
        string memory json = vm.serializeAddress(key, "relayer", relayer);
        vm.writeJson(json, string.concat("deployments/", vm.toString(block.chainid), ".json"));
        console.log("RealmLedger", address(ledger));
        console.log("ClanSiege  ", address(siege));
        console.log("RealmBadges", address(badges));
    }
}
