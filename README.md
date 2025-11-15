# PrivacyMegaPad - Privacy-Preserving Launchpad Protocol

<p align="center">
    <a target="blank"><img src="./logo.jpg" alt="Zama Logo" width="200" /></a>
</p>

<p align="center">
A decentralized launchpad protocol focused on financial privacy, powered by Fully Homomorphic Encryption (FHE).
</p>

## Description

**PrivacyMegaPad** is a decentralized launchpad protocol focused on financial privacy. It leverages Fully Homomorphic
Encryption (FHE) powered by the Zama protocol to enable private participation in token launches—users can invest without
revealing their token purchase amounts.

## Features

1. **Private Token Purchases**: All user contributions are encrypted. Only the final aggregated result is decrypted
   after the sale ends.

2. **Confidential Token Wrapping**: Wrap standard ERC-20 tokens into confidential equivalents using OpenZeppelin's
   ConfidentialFungibleTokenERC20Wrapper.

3. **zETH**: Wrap ETH into zETH to invest privately in presales.

4. **Decryption On Demand**: Final contribution aggregated result is only revealed at the end for distribution and
   liquidity operations.

5. **Private Auction Mode**: Support auction mechanism similar to MegaETH, where users can bid privately with zETH. All bids remain encrypted until the auction ends, ensuring complete privacy during the bidding process.

## How It Works

PrivacyMegaPad supports two main sale modes:

### Presale Mode

#### 1. Token Seller Setup

The seller creates a token or deposits their standard ERC-20 token into the PrivacyMegaPad contract.

#### 2. User Contributions

Users invest with zETH, allowing fully private investment. Their contribution amounts are encrypted
and hidden on-chain.

#### 3. Decryption After Deadline

Once the presale ends, the protocol triggers a controlled decryption process to reveal contribution amounts for
settlement.

#### 4. Sale Settlement

**If the presale is successful:**

- ERC-20 tokens are wrapped into their confidential form (zTokens)
- zETH is unwrapped into ETH and used to add liquidity with normal token on DEXes (Currently support UniswapV3)
- Users can privately claim their zTokens

**If the presale fails:**

- Users reclaim their zETH
- Unsold tokens are returned to the token seller

### Auction Mode

Similar to MegaETH's auction mechanism, PrivacyMegaPad offers a private auction mode:

#### 1. Auction Setup

The seller creates an auction with:
- Starting price
- Minimum bid increment
- Auction duration
- Total tokens to be auctioned

#### 2. Private Bidding

Users place encrypted bids using zETH. All bid amounts remain private and encrypted on-chain, ensuring no one can see competing bids during the auction period.

#### 3. Auction Conclusion

Once the auction ends:
- All bids are decrypted
- Winners are determined based on highest bids
- Tokens are distributed to winning bidders
- Non-winning bidders can reclaim their zETH

#### 4. Settlement

- Winning bidders receive their tokens in confidential form (cTokens)
- zETH from winning bids is used for liquidity provision
- Remaining zETH is returned to non-winning participants

## Contract Architecture

## Tech Stack

- **Zama FHE VM**: Privacy-preserving computation layer
- **OpenZeppelin Confidential Token Wrappers**: ERC-20 confidentiality layer
- **Hardhat**: Development and testing framework
- **Solidity**: Smart contract development

## Future Development

- **Expand Token Support**: Integrate additional investment tokens such as cUSDT, cDAI, and others to enhance platform
  versatility.
- **Support more types of investment**:
  - Fair Launch
  - Overflow Mechanism
  - Private Sale
  - Bonding Curve
  - Auction Mode (similar to MegaETH) - Currently in development
- **Integrate Privacy-Enabled DEXs**: As decentralized exchanges evolve to support cTokens, we aim to leverage these
  platforms to enable fully private investment and trading experiences

## How to deploy

```bash
# Deploy PrivacyPresaleFactory to Sepolia
npx hardhat deploy --network sepolia --tags PrivacyPresaleFactory
```

## How to test

```bash
npx hardhat test
```

## Documentation

- [FHEVM Documentation](https://docs.zama.ai/fhevm)
- [FHEVM Hardhat Quick Start Tutorial](https://docs.zama.ai/protocol/solidity-guides/getting-started/quick-start-tutorial)
- [How to set up a FHEVM Hardhat development environment](https://docs.zama.ai/protocol/solidity-guides/getting-started/setup)
- [Run the FHEVM Hardhat Template Tests](https://docs.zama.ai/protocol/solidity-guides/development-guide/hardhat/run_test)
- [Write FHEVM Tests using Hardhat](https://docs.zama.ai/protocol/solidity-guides/development-guide/hardhat/write_test)
- [FHEVM Hardhat Plugin](https://docs.zama.ai/protocol/solidity-guides/development-guide/hardhat)

## License

[Apache-2.0](LICENSE)
