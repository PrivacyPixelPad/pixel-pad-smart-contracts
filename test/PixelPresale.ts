import { FhevmType } from "@fhevm/hardhat-plugin";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { time } from "@nomicfoundation/hardhat-network-helpers";
import { expect } from "chai";
import { Log } from "ethers";
import { ethers, fhevm, network } from "hardhat";

import {
  IERC20,
  IERC20__factory,
  PixelPresale,
  PixelPresaleFactory,
  PixelPresaleFactory__factory,
  PixelPresale__factory,
  PixelTokenWrapper,
  PixelTokenWrapper__factory,
  PixelWETH,
  PixelWETH__factory,
} from "../types";

// Constants for better maintainability
const TIME_INCREASE = 7200; // 2 hours
const PRESALE_DURATION = 3600; // 1 hour
const PRESALE_START_OFFSET = 60; // 1 minute ago
const OPERATOR_EXPIRY_OFFSET = 1000; // 1000 seconds from now

// Purchase amounts as constants for better maintainability
const PURCHASE_AMOUNTS = {
  alice: ethers.parseUnits("1", 9), // 1 ETH
  bob: ethers.parseUnits("10", 9), // 10 ETH
  charlie: ethers.parseUnits("6", 9), // 6 ETH
  // For min/max contribution tests
  alice1: ethers.parseUnits("0.1", 9),
  alice2: ethers.parseUnits("0.5", 9),
  alice3: ethers.parseUnits("0.1", 9),
  alice4: ethers.parseUnits("3", 9),
  alice5: ethers.parseUnits("1.4", 9),
} as const;

// Presale configuration constants
const PRESALE_CONFIG = {
  hardCap: ethers.parseUnits("10", 9), // 10 ETH
  softCap: ethers.parseUnits("6", 9), // 6 ETH
  maxContribution: ethers.parseUnits("10", 9), // max 10
  minContribution: ethers.parseUnits("0.1", 9), // min 0.1
  tokenPresale: ethers.parseUnits("1000000000", 18), // 1_000_000_000
  tokenAddLiquidity: ethers.parseUnits("1000000000", 18), // 1_000_000_000
  liquidityPercentage: BigInt(5000), // 50%
} as const;

type Signers = {
  deployer: HardhatEthersSigner;
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  charlie: HardhatEthersSigner;
};

// Helper functions to reduce code duplication and improve performance
class TestHelpers {
  /**
   * Wraps ETH to zWETH for a user
   */
  static async wrapETH(user: HardhatEthersSigner, amount: bigint, zweth: PixelWETH) {
    // Only wrap if amount is greater than 0
    if (amount > 0n) {
      const wrapAmount = amount * 10n ** 9n;
      await zweth.connect(user).deposit(user.address, { value: wrapAmount });
    }

    const balance = await zweth.balanceOf(user.address);
    const clearBalance = await fhevm.userDecryptEuint(FhevmType.euint64, balance.toString(), zweth.target, user);
    return { balance, clearBalance };
  }

  /**
   * Ensures we're in the purchase period
   */
  static async ensurePurchasePeriod(presale: PixelPresale) {
    const currentTime = await time.latest();
    const pool = await presale.pool();
    if (currentTime < pool.options.start) {
      await time.increaseTo(Number(pool.options.start) + 1);
    }
  }

  /**
   * Approves zWETH spending for presale contract
   */
  static async approveCWETH(user: HardhatEthersSigner, presaleAddress: string, zweth: PixelWETH) {
    await zweth.connect(user).setOperator(presaleAddress, BigInt((await time.latest()) + OPERATOR_EXPIRY_OFFSET));
  }

  /**
   * Creates encrypted input for purchase
   */
  static async createEncryptedPurchase(presaleAddress: string, user: HardhatEthersSigner, amount: bigint) {
    return await fhevm.createEncryptedInput(presaleAddress, user.address).add64(amount).encrypt();
  }

  /**
   * Performs a purchase and returns contribution and claimable tokens
   */
  static async performPurchase(
    presale: PixelPresale,
    user: HardhatEthersSigner,
    amount: bigint,
    presaleAddress: string,
  ) {
    const encrypted = await this.createEncryptedPurchase(presaleAddress, user, amount);

    await presale.connect(user).purchase(user.address, encrypted.handles[0], encrypted.inputProof);

    // Wait for FHEVM to process the transaction
    await fhevm.awaitDecryptionOracle();

    // Get contribution and claimable tokens in parallel for better performance
    const [contribution, claimableTokens] = await Promise.all([
      presale.contributions(user.address),
      presale.claimableTokens(user.address),
    ]);

    const [clearContribution, clearClaimableTokens] = await Promise.all([
      fhevm.userDecryptEuint(FhevmType.euint64, contribution.toString(), presaleAddress, user),
      fhevm.userDecryptEuint(FhevmType.euint64, claimableTokens.toString(), presaleAddress, user),
    ]);

    return { clearContribution, clearClaimableTokens };
  }

  /**
   * Claims tokens and returns the balance
   */
  static async claimTokens(presale: PixelPresale, user: HardhatEthersSigner, ctoken: PixelTokenWrapper) {
    await presale.connect(user).claimTokens(user.address);

    const balance = await ctoken.balanceOf(user.address);
    const clearBalance = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      balance.toString(),
      await ctoken.getAddress(),
      user,
    );
    return clearBalance;
  }

  /**
   * Calculates expected contribution based on hard cap
   */
  static calculateExpectedContribution(
    purchaseAmount: bigint,
    beforePurchased: bigint,
    hardCap: bigint,
  ): { contribution: bigint; actualPurchased: bigint } {
    const totalAfterPurchase = beforePurchased + purchaseAmount;

    if (totalAfterPurchase > hardCap) {
      const contribution = hardCap - beforePurchased;
      return { contribution, actualPurchased: contribution };
    } else {
      return { contribution: purchaseAmount, actualPurchased: purchaseAmount };
    }
  }

  /**
   * Advances time and requests finalization
   */
  static async finalizePresale(presale: PixelPresale, user: HardhatEthersSigner) {
    await network.provider.send("evm_increaseTime", [TIME_INCREASE]);
    await presale.connect(user).requestFinalizePresaleState();
  }

  /**
   * Waits for decryption and validates final state
   */
  static async validateFinalization(
    presale: PixelPresale,
    expectedState: number,
    expectedWeiRaised: bigint,
    expectedTokensSold: bigint,
  ) {
    await fhevm.awaitDecryptionOracle();

    const pool = await presale.pool();
    expect(pool.state).to.eq(expectedState);
    expect(pool.weiRaised).to.eq(expectedWeiRaised);
    expect(pool.tokensSold).to.eq(expectedTokensSold);

    return pool;
  }
}

describe("PixelPresale integration flow", function () {
  // Cached variables for better performance
  let signers: Signers;
  let zweth: PixelWETH;
  let factory: PixelPresaleFactory;
  let presale: PixelPresale;
  let presaleAddress: string;
  let purchased: bigint;
  let tokenPerEth: bigint;
  let token: IERC20;
  let ctoken: PixelTokenWrapper;
  let now: number;
  let aliceActualPurchased: bigint;
  let bobActualPurchased: bigint;
  let charlieActualPurchased: bigint;

  // Cached contract addresses for better performance
  let zwethAddress: string;
  let ctokenAddress: string;
  let tokenAddress: string;

  /**
   * Optimized setup function with better error handling and performance
   * @param customConfig Optional custom config, uses PRESALE_CONFIG if not provided
   */
  async function setupPresale(customConfig?: typeof PRESALE_CONFIG) {
    const config = customConfig || PRESALE_CONFIG;
    // Validate FHEVM environment
    if (!fhevm.isMock) {
      throw new Error("This hardhat test suite cannot run on Sepolia Testnet");
    }

    purchased = 0n;

    // Deploy PixelWETH with better error handling
    zweth = (await (await new PixelWETH__factory(signers.deployer).deploy()).waitForDeployment()) as PixelWETH;
    zwethAddress = await zweth.getAddress();

    // Deploy PixelPresaleFactory
    factory = (await (
      await new PixelPresaleFactory__factory(signers.deployer).deploy(zwethAddress)
    ).waitForDeployment()) as PixelPresaleFactory;

    // Cache current time for better performance
    now = await time.latest();

    // Create presale options with cached constants
    const presaleOptions = {
      tokenAddLiquidity: config.tokenAddLiquidity,
      tokenPresale: config.tokenPresale,
      liquidityPercentage: config.liquidityPercentage,
      hardCap: config.hardCap,
      softCap: config.softCap,
      maxContribution: config.maxContribution,
      minContribution: config.minContribution,
      start: BigInt(now - PRESALE_START_OFFSET),
      end: BigInt(now + PRESALE_DURATION),
    };

    // Create presale with better error handling
    const tx = await factory.createPixelPresaleWithNewToken(
      "TestToken",
      "TTK",
      config.tokenAddLiquidity + config.tokenPresale,
      presaleOptions,
    );

    const receipt = await tx.wait();

    // Extract presale address from event with better error handling
    type PixelPresaleCreatedEvent = {
      name: string;
      args: { presale: string };
    };

    const event = receipt?.logs
      .map((log: unknown) => {
        try {
          return factory.interface.parseLog(log as Log) as unknown as PixelPresaleCreatedEvent;
        } catch {
          return null;
        }
      })
      .find(
        (e: PixelPresaleCreatedEvent | null): e is PixelPresaleCreatedEvent =>
          e !== null && e.name === "PixelPresaleCreated",
      ) as PixelPresaleCreatedEvent | null;

    presaleAddress = event?.args?.presale ?? "";
    if (!presaleAddress) {
      throw new Error("Failed to extract presale address from deployment event");
    }

    // Connect to contracts with cached addresses
    presale = PixelPresale__factory.connect(presaleAddress, signers.deployer) as PixelPresale;
    const pool = await presale.pool();

    ctoken = PixelTokenWrapper__factory.connect(pool.ctoken, signers.deployer) as PixelTokenWrapper;
    token = IERC20__factory.connect(pool.token, signers.deployer) as IERC20;

    // Cache addresses for better performance
    ctokenAddress = await ctoken.getAddress();
    tokenAddress = await token.getAddress();

    // Calculate token per ETH ratio using the actual rate from ctoken
    // This matches the contract calculation: tokenPresale / rate / hardCap
    const rate = await ctoken.rate();
    tokenPerEth = config.tokenPresale / rate / config.hardCap;

    // Log setup information
    console.table({
      "token address": tokenAddress,
      "zweth address": zwethAddress,
      "presale address": presaleAddress,
      "ctoken address": ctokenAddress,
    });
  }

  before(async function () {
    const ethSigners: HardhatEthersSigner[] = await ethers.getSigners();
    signers = {
      deployer: ethSigners[0],
      alice: ethSigners[1],
      bob: ethSigners[2],
      charlie: ethSigners[3],
    };

    console.table({
      deployer: signers.deployer.address,
      alice: signers.alice.address,
      bob: signers.bob.address,
      charlie: signers.charlie.address,
    });
  });

  describe("Test happy case: can be finalized", function () {
    before(async function () {
      await setupPresale();
    });

    it("Test wrap ETH for Alice", async function () {
      const { clearBalance } = await TestHelpers.wrapETH(signers.alice, PURCHASE_AMOUNTS.alice, zweth);
      expect(clearBalance).to.eq(PURCHASE_AMOUNTS.alice);
    });

    it("Test Alice's purchase", async function () {
      await TestHelpers.ensurePurchasePeriod(presale);
      await TestHelpers.approveCWETH(signers.alice, presaleAddress, zweth);

      aliceActualPurchased = PURCHASE_AMOUNTS.alice;
      purchased += aliceActualPurchased;

      const { clearContribution, clearClaimableTokens } = await TestHelpers.performPurchase(
        presale,
        signers.alice,
        PURCHASE_AMOUNTS.alice,
        presaleAddress,
      );

      console.log("alice contribution: ", clearContribution);
      console.log("alice claimable tokens: ", clearClaimableTokens);

      expect(clearContribution).to.eq(PURCHASE_AMOUNTS.alice);
      expect(clearClaimableTokens).to.eq(PURCHASE_AMOUNTS.alice * tokenPerEth);
    });

    it("Test Bob's purchase exceeding hard cap", async function () {
      await TestHelpers.ensurePurchasePeriod(presale);
      await TestHelpers.wrapETH(signers.bob, ethers.parseUnits("100", 9), zweth);
      await TestHelpers.approveCWETH(signers.bob, presaleAddress, zweth);

      const beforePurchased = purchased;
      purchased += PURCHASE_AMOUNTS.bob;

      const { contribution: contributionShouldBe, actualPurchased } = TestHelpers.calculateExpectedContribution(
        PURCHASE_AMOUNTS.bob,
        beforePurchased,
        PRESALE_CONFIG.hardCap,
      );

      bobActualPurchased = actualPurchased;
      if (purchased > PRESALE_CONFIG.hardCap) {
        purchased = PRESALE_CONFIG.hardCap;
      }

      const { clearContribution, clearClaimableTokens } = await TestHelpers.performPurchase(
        presale,
        signers.bob,
        PURCHASE_AMOUNTS.bob,
        presaleAddress,
      );

      console.log("bob contribution: ", clearContribution);
      console.log("bob claimable tokens: ", clearClaimableTokens);

      expect(clearContribution).to.eq(contributionShouldBe);
      expect(clearClaimableTokens).to.eq(contributionShouldBe * tokenPerEth);
    });

    it("Test Charlie's purchase with hard cap reached", async function () {
      await TestHelpers.ensurePurchasePeriod(presale);
      await TestHelpers.wrapETH(signers.charlie, ethers.parseUnits("100", 9), zweth);
      await TestHelpers.approveCWETH(signers.charlie, presaleAddress, zweth);

      const beforePurchased = purchased;
      purchased += PURCHASE_AMOUNTS.charlie;

      const { contribution: contributionShouldBe, actualPurchased } = TestHelpers.calculateExpectedContribution(
        PURCHASE_AMOUNTS.charlie,
        beforePurchased,
        PRESALE_CONFIG.hardCap,
      );

      charlieActualPurchased = actualPurchased;

      const { clearContribution, clearClaimableTokens } = await TestHelpers.performPurchase(
        presale,
        signers.charlie,
        PURCHASE_AMOUNTS.charlie,
        presaleAddress,
      );

      console.log("charlie contribution: ", clearContribution);
      console.log("charlie claimable tokens: ", clearClaimableTokens);

      expect(clearContribution).to.eq(contributionShouldBe);
      expect(clearClaimableTokens).to.eq(contributionShouldBe * tokenPerEth);
    });

    it("Test request finalize presale", async function () {
      await TestHelpers.finalizePresale(presale, signers.alice);
    });

    it("Test finalize presale", async function () {
      await TestHelpers.validateFinalization(
        presale,
        4, // Expected state
        PRESALE_CONFIG.hardCap * 10n ** 9n, // Expected wei raised
        BigInt(PRESALE_CONFIG.tokenPresale), // Expected tokens sold
      );
    });

    it("Test Alice claims tokens", async function () {
      const aliceClaimableTokens = aliceActualPurchased * tokenPerEth;
      const clearBalance = await TestHelpers.claimTokens(presale, signers.alice, ctoken);
      expect(clearBalance).to.eq(aliceClaimableTokens);
    });

    it("Test Alice cannot claim tokens twice", async function () {
      await expect(presale.connect(signers.alice).claimTokens(signers.alice.address)).to.be.revertedWith(
        "Already claimed",
      );
    });

    it("Test Charlie claims tokens (should be 0)", async function () {
      const clearBalance = await TestHelpers.claimTokens(presale, signers.charlie, ctoken);
      expect(clearBalance).to.eq(0n);
    });

    it("Test Bob claims tokens", async function () {
      const bobClaimableTokens = bobActualPurchased * tokenPerEth;
      const clearBalance = await TestHelpers.claimTokens(presale, signers.bob, ctoken);
      expect(clearBalance).to.eq(bobClaimableTokens);
    });
  });

  describe("Test sad case: only Alice buys -> pool is cancelled", function () {
    before(async function () {
      await setupPresale();
    });

    it("Test wrap ETH for Alice", async function () {
      const { clearBalance } = await TestHelpers.wrapETH(signers.alice, PURCHASE_AMOUNTS.alice, zweth);
      expect(clearBalance).to.eq(PURCHASE_AMOUNTS.alice);
    });

    it("Test Alice's purchase", async function () {
      await TestHelpers.ensurePurchasePeriod(presale);
      await TestHelpers.approveCWETH(signers.alice, presaleAddress, zweth);

      purchased += PURCHASE_AMOUNTS.alice;

      const { clearContribution, clearClaimableTokens } = await TestHelpers.performPurchase(
        presale,
        signers.alice,
        PURCHASE_AMOUNTS.alice,
        presaleAddress,
      );

      console.log("alice contribution: ", clearContribution);
      console.log("alice claimable tokens: ", clearClaimableTokens);

      expect(clearContribution).to.eq(PURCHASE_AMOUNTS.alice);
      expect(clearClaimableTokens).to.eq(PURCHASE_AMOUNTS.alice * tokenPerEth);
    });

    it("Test request finalize presale", async function () {
      await TestHelpers.finalizePresale(presale, signers.alice);
    });

    it("Test finalize presale (should be cancelled)", async function () {
      await TestHelpers.validateFinalization(
        presale,
        3, // Expected state (cancelled)
        PURCHASE_AMOUNTS.alice * 10n ** 9n, // Expected wei raised
        PURCHASE_AMOUNTS.alice * tokenPerEth * 10n ** 9n, // Expected tokens sold
      );
    });

    it("Test Alice cannot claim tokens (pool cancelled)", async function () {
      await expect(presale.connect(signers.alice).claimTokens(signers.alice.address)).to.be.revertedWith(
        "Invalid state",
      );
    });

    it("Test Alice gets refund", async function () {
      await presale.connect(signers.alice).refund(signers.alice.address);

      const { clearBalance } = await TestHelpers.wrapETH(signers.alice, 0n, zweth);
      expect(clearBalance).to.eq(PURCHASE_AMOUNTS.alice);
    });

    it("Test Alice cannot refund twice", async function () {
      await expect(presale.connect(signers.alice).refund(signers.alice.address)).to.be.revertedWith("Already refunded");
    });
  });

  describe("Test mid case: Alice and Charlie buy -> pool reaches soft cap", function () {
    before(async function () {
      await setupPresale();
    });

    it("Test wrap ETH for Alice", async function () {
      const { clearBalance } = await TestHelpers.wrapETH(signers.alice, PURCHASE_AMOUNTS.alice, zweth);
      expect(clearBalance).to.eq(PURCHASE_AMOUNTS.alice);
    });

    it("Test Alice's purchase", async function () {
      await TestHelpers.ensurePurchasePeriod(presale);
      await TestHelpers.approveCWETH(signers.alice, presaleAddress, zweth);

      purchased += PURCHASE_AMOUNTS.alice;

      const { clearContribution, clearClaimableTokens } = await TestHelpers.performPurchase(
        presale,
        signers.alice,
        PURCHASE_AMOUNTS.alice,
        presaleAddress,
      );

      console.log("alice contribution: ", clearContribution);
      console.log("alice claimable tokens: ", clearClaimableTokens);

      expect(clearContribution).to.eq(PURCHASE_AMOUNTS.alice);
      expect(clearClaimableTokens).to.eq(PURCHASE_AMOUNTS.alice * tokenPerEth);
    });

    it("Test Charlie's purchase", async function () {
      await TestHelpers.ensurePurchasePeriod(presale);
      await TestHelpers.wrapETH(signers.charlie, PURCHASE_AMOUNTS.charlie, zweth);
      await TestHelpers.approveCWETH(signers.charlie, presaleAddress, zweth);

      const beforePurchased = purchased;
      purchased += PURCHASE_AMOUNTS.charlie;

      const { contribution: contributionShouldBe, actualPurchased } = TestHelpers.calculateExpectedContribution(
        PURCHASE_AMOUNTS.charlie,
        beforePurchased,
        PRESALE_CONFIG.hardCap,
      );

      charlieActualPurchased = actualPurchased;

      const { clearContribution, clearClaimableTokens } = await TestHelpers.performPurchase(
        presale,
        signers.charlie,
        PURCHASE_AMOUNTS.charlie,
        presaleAddress,
      );

      console.log("charlie contribution: ", clearContribution);
      console.log("charlie claimable tokens: ", clearClaimableTokens);

      expect(clearContribution).to.eq(contributionShouldBe);
      expect(clearClaimableTokens).to.eq(contributionShouldBe * tokenPerEth);
    });

    it("Test request finalize presale", async function () {
      await TestHelpers.finalizePresale(presale, signers.alice);
    });

    it("Test finalize presale and validate token refunds", async function () {
      // Get owner token balance before finalization
      const ownerTokenBalanceBefore = await token.balanceOf(await presale.owner());

      await fhevm.awaitDecryptionOracle();

      // Get owner token balance after finalization
      const ownerTokenBalanceAfter = await token.balanceOf(await presale.owner());

      const tokensSold = (PURCHASE_AMOUNTS.alice + charlieActualPurchased) * tokenPerEth * BigInt(10 ** 9);

      // Validate final state
      const pool = await TestHelpers.validateFinalization(
        presale,
        4, // Expected state (finalized)
        (PURCHASE_AMOUNTS.alice + charlieActualPurchased) * 10n ** 9n, // Expected wei raised
        tokensSold, // Expected tokens sold
      );

      // Calculate expected token refund
      const leftOverLiquidityToken =
        PRESALE_CONFIG.tokenAddLiquidity -
        (PRESALE_CONFIG.tokenAddLiquidity * tokensSold) / PRESALE_CONFIG.tokenPresale;
      const expectedRefund = pool.options.tokenPresale - pool.tokensSold + leftOverLiquidityToken;

      // Validate owner token refund
      expect(ownerTokenBalanceAfter - ownerTokenBalanceBefore).to.eq(expectedRefund);
    });

    it("Test Alice claims tokens", async function () {
      const aliceClaimableTokens = PURCHASE_AMOUNTS.alice * tokenPerEth;
      const clearBalance = await TestHelpers.claimTokens(presale, signers.alice, ctoken);
      expect(clearBalance).to.eq(aliceClaimableTokens);
    });

    it("Test Charlie claims tokens", async function () {
      const charlieClaimableTokens = charlieActualPurchased * tokenPerEth;
      const clearBalance = await TestHelpers.claimTokens(presale, signers.charlie, ctoken);
      expect(clearBalance).to.eq(charlieClaimableTokens);
    });
  });

  describe("Test min/max contribution limits", function () {
    // Use different config for min/max tests
    const MIN_MAX_CONFIG = {
      hardCap: ethers.parseUnits("10", 9), // 10 ETH
      softCap: ethers.parseUnits("6", 9), // 6 ETH
      maxContribution: ethers.parseUnits("2", 9), // max 2 ETH (smaller for testing)
      minContribution: ethers.parseUnits("0.5", 9), // min 0.5 ETH (larger for testing)
      tokenPresale: ethers.parseUnits("1000000000", 18), // 1_000_000_000
      tokenAddLiquidity: ethers.parseUnits("1000000000", 18), // 1_000_000_000
      liquidityPercentage: BigInt(5000), // 50%
    } as const;

    before(async function () {
      await setupPresale(MIN_MAX_CONFIG);
    });

    it("Test wrap ETH for Alice", async function () {
      const { clearBalance } = await TestHelpers.wrapETH(signers.alice, ethers.parseUnits("100", 9), zweth);
      expect(clearBalance).to.eq(ethers.parseUnits("100", 9));
    });

    it("Test Alice's purchase with lower than min contribution", async function () {
      await TestHelpers.ensurePurchasePeriod(presale);
      await TestHelpers.approveCWETH(signers.alice, presaleAddress, zweth);

      const { clearContribution } = await TestHelpers.performPurchase(
        presale,
        signers.alice,
        PURCHASE_AMOUNTS.alice1, // 0.1 ETH < 0.5 ETH min
        presaleAddress,
      );

      console.log("alice contribution: ", clearContribution);

      expect(clearContribution).to.eq(0);
    });

    it("Test Alice's purchase with equal min contribution", async function () {
      await TestHelpers.ensurePurchasePeriod(presale);
      await TestHelpers.approveCWETH(signers.alice, presaleAddress, zweth);

      purchased += PURCHASE_AMOUNTS.alice2; // 0.5 ETH = min

      const { clearContribution } = await TestHelpers.performPurchase(
        presale,
        signers.alice,
        PURCHASE_AMOUNTS.alice2,
        presaleAddress,
      );

      console.log("alice contribution: ", clearContribution);

      expect(clearContribution).to.eq(purchased);
    });

    it("Test Alice's purchase with lower than min contribution again: should be able", async function () {
      await TestHelpers.ensurePurchasePeriod(presale);
      await TestHelpers.approveCWETH(signers.alice, presaleAddress, zweth);

      purchased += PURCHASE_AMOUNTS.alice3; // 0.1 ETH, but total already >= min

      const { clearContribution } = await TestHelpers.performPurchase(
        presale,
        signers.alice,
        PURCHASE_AMOUNTS.alice3,
        presaleAddress,
      );

      console.log("alice contribution: ", clearContribution);

      expect(clearContribution).to.eq(purchased);
    });

    it("Test Alice's purchase with greater than max contribution", async function () {
      await TestHelpers.ensurePurchasePeriod(presale);
      await TestHelpers.approveCWETH(signers.alice, presaleAddress, zweth);

      const { clearContribution } = await TestHelpers.performPurchase(
        presale,
        signers.alice,
        PURCHASE_AMOUNTS.alice4, // 3 ETH > 2 ETH max
        presaleAddress,
      );

      console.log("alice contribution: ", clearContribution);

      expect(clearContribution).to.eq(MIN_MAX_CONFIG.maxContribution);
    });

    it("Test request finalize presale", async function () {
      await TestHelpers.finalizePresale(presale, signers.alice);
    });
  });
});
