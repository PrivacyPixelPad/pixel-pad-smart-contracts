// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract PixelPresaleToken is ERC20 {
    constructor(
        string memory name_,
        string memory symbol_,
        uint256 totalSupply_,
        uint256 presaleSupply_,
        address owner_
    ) ERC20(name_, symbol_) {
        require(totalSupply_ >= presaleSupply_, "Invalid supply");
        _mint(owner_, totalSupply_);
    }
}
