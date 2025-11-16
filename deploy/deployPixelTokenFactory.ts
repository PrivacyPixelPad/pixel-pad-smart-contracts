import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("Deployer address:", deployer);

  const tokenFactory = await deploy("PixelTokenFactory", {
    from: deployer,
    log: true,
  });
  console.log(`PixelTokenFactory deployed at:`, tokenFactory.address);

  if (tokenFactory.address) {
    console.log("✅ PixelTokenFactory deployment successful!");
    console.log("📋 Contract Address:", tokenFactory.address);
    console.log("🔗 Transaction Hash:", tokenFactory.transactionHash);
  } else {
    console.log("❌ PixelTokenFactory deployment failed!");
  }
};

export default func;
func.id = "deploy_pixelTokenFactory";
func.tags = ["PixelTokenFactory"];
