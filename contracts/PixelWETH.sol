// SPDX-License-Identifier: MIT

pragma solidity ^0.8.26;

import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {FHE, externalEuint64, euint64} from "@fhevm/solidity/lib/FHE.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ConfidentialFungibleToken} from "@openzeppelin/contracts-confidential/token/ConfidentialFungibleToken.sol";

contract PixelWETH is ConfidentialFungibleToken, SepoliaConfig {
    uint8 private immutable DECIMALS;
    uint256 private immutable RATE;

    mapping(uint256 requestID => address receiver) private _receivers;

    constructor() ConfidentialFungibleToken("Confidential Zama Wrapped ETH", "zWETH", "https://zweth.com") {
        DECIMALS = 9;
        RATE = 10 ** 9;
    }

    function decimals() public view virtual override returns (uint8) {
        return DECIMALS;
    }

    function rate() public view returns (uint256) {
        return RATE;
    }

    function deposit(address to) public payable {
        uint256 amount = msg.value;
        require(amount > rate(), "Amount must be greater than rate");
        payable(msg.sender).transfer(amount % rate());
        uint64 mintAmount = SafeCast.toUint64(amount / rate());
        _mint(to, FHE.asEuint64(mintAmount));
    }

    function withdraw(address from, address to, euint64 amount) public {
        require(
            FHE.isAllowed(amount, msg.sender),
            ConfidentialFungibleTokenUnauthorizedUseOfEncryptedAmount(amount, msg.sender)
        );
        _withdraw(from, to, amount);
    }

    function withdraw(
        address from,
        address to,
        externalEuint64 encryptedAmount,
        bytes calldata inputProof
    ) public virtual {
        _withdraw(from, to, FHE.fromExternal(encryptedAmount, inputProof));
    }

    function finalizeWithdraw(uint256 requestID, uint64 amount, bytes[] memory signatures) public virtual {
        FHE.checkSignatures(requestID, signatures);
        address to = _receivers[requestID];
        require(to != address(0), ConfidentialFungibleTokenInvalidGatewayRequest(requestID));
        delete _receivers[requestID];

        payable(to).transfer(amount * rate());
    }

    function _withdraw(address from, address to, euint64 amount) internal virtual {
        require(to != address(0), ConfidentialFungibleTokenInvalidReceiver(to));
        require(
            from == msg.sender || isOperator(from, msg.sender),
            ConfidentialFungibleTokenUnauthorizedSpender(from, msg.sender)
        );

        euint64 burntAmount = _burn(from, amount);

        bytes32[] memory cts = new bytes32[](1);
        cts[0] = euint64.unwrap(burntAmount);
        uint256 requestID = FHE.requestDecryption(cts, this.finalizeWithdraw.selector);

        _receivers[requestID] = to;
    }
}
