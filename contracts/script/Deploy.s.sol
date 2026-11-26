// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Script, console} from "forge-std/Script.sol";
import {LaunchFactory} from "../src/LaunchFactory.sol";
import {CoinDeployer} from "../src/CoinDeployer.sol";
import {LaunchLens} from "../src/LaunchLens.sol";
import {MockWETH, MockV2Factory} from "../test/Mocks.sol";

/// Base Sepolia:  V2_FACTORY=0x7Ae58f10f7849cA6F5fB71b7f45CB416c9204b1e WETH=0x4200000000000000000000000000000000000006
/// Local anvil:   leave V2_FACTORY unset and mocks are deployed.
contract Deploy is Script {
    function run() external {
        require(block.chainid == 84532 || block.chainid == 31337, "testnet only: Base Sepolia or local anvil");
        uint256 veth0 = vm.envOr("VETH0", uint256(0.02 ether));
        address v2 = vm.envOr("V2_FACTORY", address(0));
        address weth = vm.envOr("WETH", address(0));
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();
        if (v2 == address(0)) {
            v2 = address(new MockV2Factory());
            weth = address(new MockWETH());
        }
        address me = pk != 0 ? vm.addr(pk) : msg.sender;
        uint64 n = vm.getNonce(me);
        address predicted = vm.computeCreateAddress(me, n + 1);
        CoinDeployer d = new CoinDeployer(predicted);
        LaunchFactory f = new LaunchFactory(v2, weth, veth0, d);
        require(address(f) == predicted, "factory address mismatch");
        LaunchLens lens = new LaunchLens();
        vm.stopBroadcast();
        string memory o = "d";
        vm.serializeUint(o, "chainId", block.chainid);
        vm.serializeUint(o, "block", block.number);
        vm.serializeAddress(o, "factory", address(f));
        vm.serializeAddress(o, "deployer", address(d));
        vm.serializeAddress(o, "lens", address(lens));
        vm.serializeAddress(o, "v2Factory", v2);
        string memory json = vm.serializeAddress(o, "weth", weth);
        vm.writeJson(json, string.concat("../deployments/", vm.toString(block.chainid), ".json"));
        console.log("factory", address(f));
        console.log("lens", address(lens));
    }
}
