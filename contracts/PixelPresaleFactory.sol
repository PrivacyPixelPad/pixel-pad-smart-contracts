// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {PixelPresale} from "./PixelPresale.sol";
import {IERC20} from "@openzeppelin/contracts/interfaces/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

contract PixelPresaleFactory {
    using SafeERC20 for IERC20;

    address private zweth;
    address[] public allPresales;
    mapping(address creator => address[] presales) private presalesByCreator;

    event PixelPresaleCreated(address indexed creator, address presale, address token, address ctoken, address zweth);

    constructor(address _zweth) {
        require(_zweth != address(0), "Invalid zweth address");
        zweth = _zweth;
    }

    function createPixelPresale(
        address _token,
        address _ctoken,
        PixelPresale.PresaleOptions memory _options
    ) external returns (address presale) {
        PixelPresale newPresale = new PixelPresale(msg.sender, zweth, _token, _ctoken, _options);

        IERC20(_token).safeTransferFrom(msg.sender, address(newPresale), _options.tokenPresale);

        allPresales.push(address(newPresale));
        presalesByCreator[msg.sender].push(address(newPresale));

        emit PixelPresaleCreated(msg.sender, address(newPresale), _token, _ctoken, zweth);

        return address(newPresale);
    }

    function getPresalesByCreator(address creator) external view returns (address[] memory) {
        return presalesByCreator[creator];
    }
}
