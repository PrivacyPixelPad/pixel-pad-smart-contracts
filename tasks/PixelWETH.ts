import { FhevmType } from "@fhevm/hardhat-plugin";
import { task } from "hardhat/config";
import { HardhatRuntimeEnvironment, TaskArguments } from "hardhat/types";

/**
 * Helper function to get a signer by index
 */
async function getSigner(hre: HardhatRuntimeEnvironment, index: number) {
  const signers = await hre.ethers.getSigners();
  if (index >= signers.length) {
    throw new Error(`User index ${index} not found. Available users: 0-${signers.length - 1}`);
  }
  return signers[index];
}

/**
 * Helper function to format amounts for display
 */
function formatAmount(amount: bigint, decimals: number): string {
  const divisor = 10n ** BigInt(decimals);
  const whole = amount / divisor;
  const fraction = amount % divisor;
  const fractionStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fractionStr ? `${whole}.${fractionStr}` : whole.toString();
}

/**
 * Helper function to parse amounts from user input
 */
function parseAmount(amountStr: string, decimals: number): bigint {
  const parts = amountStr.split(".");
  if (parts.length > 2) {
    throw new Error("Invalid amount format. Use format like '1.5' or '100'");
  }

  const whole = parts[0] || "0";
  const fraction = parts[1] || "";

  if (fraction.length > decimals) {
    throw new Error(`Amount has too many decimal places. Maximum: ${decimals}`);
  }

  const wholeBigInt = BigInt(whole) * 10n ** BigInt(decimals);
  const fractionBigInt = BigInt(fraction.padEnd(decimals, "0"));

  return wholeBigInt + fractionBigInt;
}

/**
 * Deposit ETH to PixelWETH
 * Example: npx hardhat --network sepolia task:zweth-deposit --amount 5 --user 1 --zweth 0x...
 */
task("task:zweth-deposit", "Deposit ETH to PixelWETH")
  .addParam("amount", "Amount of ETH to deposit")
  .addParam("user", "User index (0, 1, 2, etc.)")
  .addParam("zweth", "PixelWETH contract address")
  .addOptionalParam("to", "Recipient address (defaults to user)")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Depositing ETH to PixelWETH...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const to = taskArguments.to || user.address;
    const amount = parseAmount(taskArguments.amount, 18);

    const zweth = await hre.ethers.getContractAt("PixelWETH", taskArguments.zweth);

    console.log(`Depositing ${formatAmount(amount, 18)} ETH...`);
    console.log("From:", user.address);
    console.log("To:", to);

    // Deposit ETH to zWETH
    const tx = await zweth.connect(user).deposit(to, { value: amount });
    await tx.wait();

    // Get balance after deposit
    const balanceAfter = await zweth.balanceOf(to);
    const clearBalanceAfter = await fhevm.userDecryptEuint(
      FhevmType.euint64,
      balanceAfter.toString(),
      taskArguments.zweth,
      user,
    );

    console.log("✅ Deposit completed successfully!");
    console.log("Deposited amount:", formatAmount(amount, 18));
    console.log("Balance after:", formatAmount(clearBalanceAfter, 9));

    return {
      from: user.address,
      to: to,
      depositedAmount: amount,
      newBalance: clearBalanceAfter,
    };
  });

/**
 * Withdraw ETH from PixelWETH
 * Example: npx hardhat --network sepolia task:zweth-withdraw --amount 2 --user 1 --zweth 0x... --to 0x...
 */
task("task:zweth-withdraw", "Withdraw ETH from PixelWETH")
  .addParam("amount", "Amount of zWETH to withdraw")
  .addParam("user", "User index (0, 1, 2, etc.)")
  .addParam("zweth", "PixelWETH contract address")
  .addOptionalParam("to", "Recipient address for ETH")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Withdrawing ETH from PixelWETH...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const amount = parseAmount(taskArguments.amount, 9);

    const zweth = await hre.ethers.getContractAt("PixelWETH", taskArguments.zweth);
    const to = taskArguments.to || user.address;

    console.log(`Withdrawing ${formatAmount(amount, 9)} zWETH...`);
    console.log("From:", user.address);
    console.log("To:", to);

    // Check if user has enough zWETH
    const balance = await zweth.balanceOf(user.address);
    const clearBalance = await fhevm.userDecryptEuint(FhevmType.euint64, balance.toString(), taskArguments.zweth, user);

    if (clearBalance < amount) {
      throw new Error(`Insufficient zWETH balance. Have: ${clearBalance}, Need: ${amount}`);
    }

    // Get ETH balance before withdrawal
    const ethBalanceBefore = await hre.ethers.provider.getBalance(to);

    // Create encrypted withdrawal input
    console.log("Creating encrypted withdrawal input...");
    const encrypted = await fhevm.createEncryptedInput(taskArguments.zweth, user.address).add64(amount).encrypt();

    // Withdraw ETH
    console.log("Executing withdrawal...");
    const tx = await zweth
      .connect(user)
      ["withdraw(address,address,bytes32,bytes)"](user.address, to, encrypted.handles[0], encrypted.inputProof);
    await tx.wait();

    // Get ETH balance after withdrawal
    const ethBalanceAfter = await hre.ethers.provider.getBalance(to);

    console.log("✅ Withdrawal completed successfully!");
    console.log("ETH received:", formatAmount(ethBalanceAfter - ethBalanceBefore, 9));

    return {
      from: user.address,
      to: to,
      withdrawnAmount: ethBalanceAfter - ethBalanceBefore,
    };
  });

/**
 * Get PixelWETH balance
 * Example: npx hardhat --network sepolia task:zweth-balance --user 1 --zweth 0x...
 */
task("task:zweth-balance", "Get PixelWETH balance")
  .addParam("user", "User index (0, 1, 2, etc.)")
  .addParam("zweth", "PixelWETH contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    const { fhevm } = hre;

    console.log("Getting PixelWETH balance...");

    // Initialize FHEVM
    await fhevm.initializeCLIApi();

    console.log("Initializing FHEVM successfully");

    const user = await getSigner(hre, parseInt(taskArguments.user));
    const zweth = await hre.ethers.getContractAt("PixelWETH", taskArguments.zweth);

    // Get balance
    console.log("Getting PixelWETH balance of user...");
    const balance = await zweth.balanceOf(user.address);
    const clearBalance = await fhevm.userDecryptEuint(FhevmType.euint64, balance.toString(), taskArguments.zweth, user);
    console.log("Cleared balance:", formatAmount(clearBalance, 9));

    console.log("👤 PixelWETH Balance:");
    console.log("User address:", user.address);
    console.log("Balance:", formatAmount(clearBalance, 9));

    return {
      address: user.address,
      balance: clearBalance,
    };
  });

/**
 * Get PixelWETH contract information
 * Example: npx hardhat --network sepolia task:zweth-info --zweth 0x...
 */
task("task:zweth-info", "Get PixelWETH contract information")
  .addParam("zweth", "PixelWETH contract address")
  .setAction(async function (taskArguments: TaskArguments, hre) {
    console.log("Getting PixelWETH contract information...");

    const zweth = await hre.ethers.getContractAt("PixelWETH", taskArguments.zweth);

    // Get contract info
    const [name, symbol, decimals, rate] = await Promise.all([
      zweth.name(),
      zweth.symbol(),
      zweth.decimals(),
      zweth.rate(),
    ]);

    console.log("📊 PixelWETH Contract Information:");
    console.log("Address:", taskArguments.zweth);
    console.log("Name:", name);
    console.log("Symbol:", symbol);
    console.log("Decimals:", decimals);
    console.log("Rate:", rate.toString());
    console.log("Rate explanation: 1 zWETH =", formatAmount(rate, 9), "ETH");

    return {
      address: taskArguments.zweth,
      name,
      symbol,
      decimals,
      rate,
    };
  });
