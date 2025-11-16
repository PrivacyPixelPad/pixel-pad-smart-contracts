import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy } = hre.deployments;

  console.log("Deployer address:", deployer);

  const deployedCWETH = await deploy("PixelWETH", {
    from: deployer,
    log: true,
  });

  console.log(`PixelWETH deployed at:`, deployedCWETH.address);
};

export default func;
func.id = "deploy_pixelWETH";
func.tags = ["PixelWETH"];
