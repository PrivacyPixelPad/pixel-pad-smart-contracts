// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {
    ConfidentialFungibleTokenERC20Wrapper
} from "@openzeppelin/contracts-confidential/token/extensions/ConfidentialFungibleTokenERC20Wrapper.sol";
import {ConfidentialFungibleToken} from "@openzeppelin/contracts-confidential/token/ConfidentialFungibleToken.sol";

contract PixelTokenWrapper is SepoliaConfig, ConfidentialFungibleTokenERC20Wrapper {
    constructor(
        string memory name_,
        string memory symbol_,
        string memory tokenURI_,
        IERC20 underlying_
    ) ConfidentialFungibleTokenERC20Wrapper(underlying_) ConfidentialFungibleToken(name_, symbol_, tokenURI_) {}
}
