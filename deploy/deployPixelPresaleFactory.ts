import { DeployFunction } from "hardhat-deploy/types";
import { HardhatRuntimeEnvironment } from "hardhat/types";

const func: DeployFunction = async function (hre: HardhatRuntimeEnvironment) {
  const { deployer } = await hre.getNamedAccounts();
  const { deploy, get } = hre.deployments;

  console.log("Deployer address:", deployer);

  const zwethDeployment = await get("PixelWETH");
  const zwethAddress = zwethDeployment.address;
  console.log("Using PixelWETH address:", zwethAddress);

  const factory = await deploy("PixelPresaleFactory", {
    from: deployer,
    log: true,
    args: [zwethAddress],
  });

  console.log(`PixelPresaleFactory deployed at:`, factory.address);
};
export default func;
func.id = "deploy_pixelPresaleFactory"; // id required to prevent reexecution
func.tags = ["PixelPresaleFactory"];
