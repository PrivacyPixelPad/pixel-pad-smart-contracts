// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {FHE, externalEuint64, euint64, ebool} from "@fhevm/solidity/lib/FHE.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {PixelTokenWrapper} from "./PixelTokenWrapper.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SepoliaConfig} from "@fhevm/solidity/config/ZamaConfig.sol";
import {PixelWETH} from "./PixelWETH.sol";

interface IPixelPresale {
    error InvalidState(uint8 currentState);
    error NotInPurchasePeriod();
    error NotRefundable();
    error InvalidCapValue();
    error InvalidTimestampValue();
    event PoolInitialized(
        address indexed creator,
        uint256 amount,
        uint256 liquidityTokens,
        uint256 presaleTokens,
        uint256 timestamp
    );
}

contract PixelPresale is SepoliaConfig, IPixelPresale, Ownable {
    using SafeERC20 for IERC20;
    using Address for address payable;

    struct PresaleOptions {
        uint256 tokenPresale;
        uint64 hardCap;
        uint64 softCap;
        uint64 maxContribution;
        uint64 minContribution;
        uint128 start;
        uint128 end;
    }

    struct Pool {
        IERC20 token;
        PixelTokenWrapper ctoken;
        uint256 tokenBalance;
        euint64 tokensSoldEncrypted;
        uint256 tokensSold;
        uint256 weiRaised;
        euint64 ethRaisedEncrypted;
        uint64 tokenPerEthWithDecimals;
        address zweth;
        uint8 state;
        PresaleOptions options;
    }

    mapping(address user => euint64 contribution) public contributions;
    mapping(address user => euint64 claimableTokens) public claimableTokens;
    mapping(address user => bool claimed) public claimed;
    mapping(address user => bool refunded) public refunded;

    Pool public pool;

    constructor(
        address _owner,
        address _zweth,
        address _token,
        address _ctoken,
        PresaleOptions memory _options
    ) Ownable(_owner) {
        _prevalidatePool(_options);

        pool.token = IERC20(_token);
        pool.ctoken = PixelTokenWrapper(_ctoken);
        pool.zweth = _zweth;
        pool.options = _options;

        uint256 rate = PixelTokenWrapper(_ctoken).rate();

        pool.state = 1;

        pool.tokenBalance = _options.tokenPresale;
        require(_options.hardCap > 0, "Hard cap zero");

        uint256 presaleUnits = _options.tokenPresale / rate;
        require(presaleUnits >= _options.hardCap, "Rate too low");

        uint256 tpe = presaleUnits / _options.hardCap;
        require(tpe <= type(uint64).max, "Rate overflow");
        pool.tokenPerEthWithDecimals = SafeCast.toUint64(tpe);
        emit PoolInitialized(_owner, _options.tokenPresale, 0, _options.tokenPresale, block.timestamp);
    }

    receive() external payable {}

    function purchase(address beneficiary, externalEuint64 encryptedAmount, bytes calldata inputProof) external {
        require(pool.state == 1, "Invalid state");
        require(block.timestamp >= pool.options.start && block.timestamp <= pool.options.end, "Not in purchase period");

        _handlePurchase(beneficiary, encryptedAmount, inputProof);
    }

    function claimTokens(address beneficiary) external {
        require(pool.state == 4, "Invalid state");
        require(!claimed[beneficiary], "Already claimed");
        claimed[beneficiary] = true;

        euint64 claimableToken = claimableTokens[beneficiary];

        FHE.allowTransient(claimableToken, address(pool.ctoken));
        pool.ctoken.confidentialTransfer(beneficiary, claimableToken);
    }

    function refund() external {
        address beneficiary = msg.sender;

        require(pool.state == 3, "Invalid state");
        require(!refunded[beneficiary], "Already refunded");

        euint64 amount = contributions[beneficiary];

        FHE.allowTransient(amount, address(pool.zweth));
        PixelWETH(pool.zweth).confidentialTransfer(beneficiary, amount);

        refunded[beneficiary] = true;
    }

    function _prevalidatePurchase() internal view returns (bool) {
        if (pool.state != 1) revert InvalidState(pool.state);
        if (block.timestamp < pool.options.start || block.timestamp > pool.options.end) revert NotInPurchasePeriod();
        return true;
    }

    function _prevalidatePool(PresaleOptions memory _options) internal pure returns (bool) {
        if (_options.softCap == 0) revert InvalidCapValue();
        if (_options.softCap > _options.hardCap) revert InvalidCapValue();
        if (_options.end < _options.start) revert InvalidTimestampValue();
        return true;
    }

    function requestFinalizePresaleState() external {
        uint8 currentState = pool.state;
        uint128 endTime = pool.options.end;

        require(currentState == 1 || currentState == 2, "Presale is not active");
        require(block.timestamp >= endTime, "Presale is not ended");

        pool.state = 2;

        euint64 ethRaisedEncrypted = pool.ethRaisedEncrypted;
        euint64 tokensSoldEncrypted = pool.tokensSoldEncrypted;
        bytes32[] memory cts = new bytes32[](2);
        cts[0] = euint64.unwrap(ethRaisedEncrypted);
        cts[1] = euint64.unwrap(tokensSoldEncrypted);

        FHE.requestDecryption(cts, this.finalizePreSale.selector);
    }

    function finalizePreSale(
        uint256 requestID,
        uint64 ethRaised,
        uint64 tokensSold,
        bytes[] memory signatures
    ) external virtual {
        FHE.checkSignatures(requestID, signatures);

        _handleFinalizePreSale(ethRaised, tokensSold);
    }

    function onERC721Received(address, address, uint256, bytes calldata) external pure returns (bytes4) {
        return this.onERC721Received.selector;
    }

    function _handleContribution(
        euint64 contributed,
        euint64 purchaseAmount,
        uint64 minContribution,
        uint64 maxContribution
    ) internal returns (euint64 finalPurchase) {
        euint64 ableToContribute = FHE.sub(maxContribution, contributed);
        ebool isOverMaxContribute = FHE.ge(purchaseAmount, ableToContribute);
        finalPurchase = FHE.select(isOverMaxContribute, ableToContribute, purchaseAmount);

        ebool isPassMinContribution = FHE.ge(FHE.add(finalPurchase, contributed), minContribution);
        finalPurchase = FHE.select(isPassMinContribution, finalPurchase, FHE.asEuint64(0));
    }

    function _handlePurchase(address beneficiary, externalEuint64 encryptedAmount, bytes calldata inputProof) internal {
        address zweth = pool.zweth;
        uint64 tokenPerEthWithDecimals = pool.tokenPerEthWithDecimals;
        uint64 hardCap = pool.options.hardCap;

        euint64 userContribution = contributions[beneficiary];
        euint64 userClaimableTokens = claimableTokens[beneficiary];
        euint64 purchaseAmount = FHE.fromExternal(encryptedAmount, inputProof);
        euint64 finalPurchase = _handleContribution(
            userContribution,
            purchaseAmount,
            pool.options.minContribution,
            pool.options.maxContribution
        );

        FHE.allowTransient(finalPurchase, zweth);
        euint64 transferred = PixelWETH(zweth).confidentialTransferFrom(beneficiary, address(this), finalPurchase);

        euint64 currentEthRaised = pool.ethRaisedEncrypted;
        euint64 newEthRaised = FHE.add(currentEthRaised, transferred);
        ebool isAbove = FHE.gt(newEthRaised, hardCap);
        euint64 refundAmount = FHE.select(isAbove, FHE.sub(newEthRaised, hardCap), FHE.asEuint64(0));
        euint64 finalEthRaised = FHE.sub(newEthRaised, refundAmount);
        euint64 contributeAmount = FHE.sub(transferred, refundAmount);

        pool.ethRaisedEncrypted = finalEthRaised;
        FHE.allowThis(pool.ethRaisedEncrypted);

        FHE.allowTransient(refundAmount, zweth);
        PixelWETH(zweth).confidentialTransfer(beneficiary, refundAmount);

        euint64 newUserContribution = FHE.add(userContribution, contributeAmount);
        euint64 tokensSoldEncrypted = FHE.mul(contributeAmount, tokenPerEthWithDecimals);
        euint64 newUserClaimableTokens = FHE.add(userClaimableTokens, tokensSoldEncrypted);
        euint64 currentTokensSold = pool.tokensSoldEncrypted;
        euint64 newTokensSold = FHE.add(currentTokensSold, tokensSoldEncrypted);

        contributions[beneficiary] = newUserContribution;
        claimableTokens[beneficiary] = newUserClaimableTokens;
        pool.tokensSoldEncrypted = newTokensSold;

        FHE.allowThis(newUserContribution);
        FHE.allow(newUserContribution, beneficiary);
        FHE.allowThis(newTokensSold);
        FHE.allowThis(newUserClaimableTokens);
        FHE.allow(newUserClaimableTokens, beneficiary);
    }

    function _handleFinalizePreSale(uint64 zwethRaised, uint64 tokensSold) internal {
        uint256 rate = pool.ctoken.rate();
        uint256 tokenPresale = pool.options.tokenPresale;
        uint64 softCap = pool.options.softCap;
        euint64 ethRaisedEncrypted = pool.ethRaisedEncrypted;

        uint256 weiRaised = zwethRaised * 1e9;
        uint256 tokensSoldValue = tokensSold * rate;

        pool.weiRaised = weiRaised;
        pool.tokensSold = tokensSoldValue;

        require(pool.state == 2, "Invalid pool state");

        if (zwethRaised < softCap) {
            pool.state = 3;
            pool.token.safeTransfer(owner(), tokenPresale);
        } else {
            pool.state = 4;

            if (tokenPresale > tokensSoldValue) {
                uint256 unsoldToken = tokenPresale - tokensSoldValue;
                pool.token.safeTransfer(owner(), unsoldToken);
            }

            IERC20 token = pool.token;
            token.forceApprove(address(pool.ctoken), tokensSoldValue);
            pool.ctoken.wrap(address(this), tokensSoldValue);

            FHE.allowTransient(ethRaisedEncrypted, address(pool.zweth));
            PixelWETH(pool.zweth).withdraw(address(this), owner(), ethRaisedEncrypted);
        }
    }
}
