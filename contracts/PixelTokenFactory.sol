// SPDX-License-Identifier: MIT
pragma solidity ^0.8.26;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

contract PixelTokenFactory {
    event TokenCreated(
        address indexed tokenAddress,
        string name,
        string symbol,
        uint8 decimals,
        uint256 totalSupply,
        string url,
        address indexed creator
    );

    address[] public createdTokens;
    mapping(address token => address creator) public tokenCreators;

    function createToken(
        string memory name,
        string memory symbol,
        uint8 decimals,
        uint256 totalSupply,
        string memory url
    ) external returns (address tokenAddress) {
        PixelToken newToken = new PixelToken(name, symbol, decimals, totalSupply, url, msg.sender);

        tokenAddress = address(newToken);
        createdTokens.push(tokenAddress);
        tokenCreators[tokenAddress] = msg.sender;
        emit TokenCreated(tokenAddress, name, symbol, decimals, totalSupply, url, msg.sender);

        return tokenAddress;
    }

    function getTokensByCreator(address creator) external view returns (address[] memory) {
        uint256 count = 0;

        for (uint256 i = 0; i < createdTokens.length; i++) {
            if (tokenCreators[createdTokens[i]] == creator) {
                count++;
            }
        }

        address[] memory tokens = new address[](count);
        uint256 index = 0;

        for (uint256 i = 0; i < createdTokens.length; i++) {
            if (tokenCreators[createdTokens[i]] == creator) {
                tokens[index] = createdTokens[i];
                index++;
            }
        }

        return tokens;
    }
}

contract PixelToken is ERC20, Ownable {
    string public tokenUrl;
    uint8 private _decimals;

    constructor(
        string memory name_,
        string memory symbol_,
        uint8 decimals_,
        uint256 totalSupply_,
        string memory url_,
        address creator_
    ) ERC20(name_, symbol_) Ownable(creator_) {
        _decimals = decimals_;
        tokenUrl = url_;
        _mint(creator_, totalSupply_);
    }

    function decimals() public view virtual override returns (uint8) {
        return _decimals;
    }
}
