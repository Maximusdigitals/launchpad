// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IERC20Min {
    function balanceOf(address) external view returns (uint256);
}

contract MockWETH {
    mapping(address => uint256) public balanceOf;

    function deposit() external payable {
        balanceOf[msg.sender] += msg.value;
    }

    function transfer(address to, uint256 amt) external returns (bool) {
        balanceOf[msg.sender] -= amt;
        balanceOf[to] += amt;
        return true;
    }
}

/// minimal Uniswap-V2-like pair: mint() uses balance - reserve, like the real one
contract MockPair {
    address public token0;
    address public token1;
    uint256 public reserve0;
    uint256 public reserve1;
    uint256 public totalSupply;
    mapping(address => uint256) public lp;

    constructor(address a, address b) {
        (token0, token1) = (a, b);
    }

    function mint(address to) external returns (uint256 liq) {
        uint256 b0 = IERC20Min(token0).balanceOf(address(this));
        uint256 b1 = IERC20Min(token1).balanceOf(address(this));
        uint256 a0 = b0 - reserve0;
        uint256 a1 = b1 - reserve1;
        require(totalSupply == 0, "mock: first mint only");
        liq = Math.sqrt(a0 * a1) - 1000;
        require(liq > 0, "INSUFFICIENT_LIQUIDITY_MINTED");
        totalSupply = liq + 1000;
        lp[to] += liq;
        (reserve0, reserve1) = (b0, b1);
    }

    function sync() external {
        reserve0 = IERC20Min(token0).balanceOf(address(this));
        reserve1 = IERC20Min(token1).balanceOf(address(this));
    }
}

contract MockV2Factory {
    mapping(address => mapping(address => address)) public getPair;

    function createPair(address a, address b) external returns (address p) {
        require(getPair[a][b] == address(0), "exists");
        p = address(new MockPair(a, b));
        getPair[a][b] = p;
        getPair[b][a] = p;
    }
}
