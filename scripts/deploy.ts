// Control task, steps 1 and 2: issue two ERC-20 tokens (the token contract from lab 2) and
// deploy DefiIntegrator with the address of the Uniswap V2 router on Sepolia. The integrator
// part is the script from fig. 4.5 of the lab text, ported to Hardhat 3. Run it on the fork:
//   npx hardhat node --network sepoliaFork
//   npx hardhat run scripts/deploy.ts --network localhost
import { mkdir, writeFile } from "node:fs/promises";
import { network } from "hardhat";

// Hardhat 3 has no global `ethers` object: it comes from a connection to the network
// chosen with --network
const { ethers, networkName } = await network.create();

// The two Uniswap V2 router functions this script reads (human-readable ABI)
const ROUTER_ABI = [
  "function factory() external pure returns (address)",
  "function WETH() external pure returns (address)",
];

async function main() {
  const [deployer] = await ethers.getSigners();

  // Uniswap V2 Router address on Sepolia
  const UNISWAP_V2_ROUTER = "0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008";

  // 0. The router must exist on the chosen network. On the fork its code comes from Sepolia;
  //    on a node without forking there is nothing at this address.
  const routerCode = await ethers.provider.getCode(UNISWAP_V2_ROUTER);
  if (routerCode === "0x") {
    throw new Error(`No contract at ${UNISWAP_V2_ROUTER}: start the node with --network sepoliaFork`);
  }
  const router = new ethers.Contract(UNISWAP_V2_ROUTER, ROUTER_ABI, ethers.provider);
  const factoryAddress: string = await router.factory();
  const { chainId } = await ethers.provider.getNetwork();
  console.log(`[Network] ${networkName}, chain id ${chainId}, block ${await ethers.provider.getBlockNumber()}`);
  console.log(`[Router] ${UNISWAP_V2_ROUTER}: ${(routerCode.length - 2) / 2} bytes of code`);
  console.log(`         factory ${factoryAddress}, WETH ${await router.WETH()}`);
  console.log(`[Deployer] account #0 ${deployer.address}`);

  // 1. Two ERC-20 tokens, both issued by account #0
  const tokenA = await ethers.deployContract("AssetToken", ["KyivCoin", "KYIV", 1000000n], deployer);
  await tokenA.waitForDeployment();
  const tokenAAddress = await tokenA.getAddress();
  console.log(`[Token] KyivCoin (KYIV) deployed at ${tokenAAddress}`);

  const tokenB = await ethers.deployContract("AssetToken", ["MockFiat", "mFIAT", 1000000n], deployer);
  await tokenB.waitForDeployment();
  const tokenBAddress = await tokenB.getAddress();
  console.log(`[Token] MockFiat (mFIAT) deployed at ${tokenBAddress}`);

  // 2. Deployment of the integrator (fig. 4.5)
  const Integrator = await ethers.getContractFactory("DefiIntegrator");
  const integrator = await Integrator.deploy(UNISWAP_V2_ROUTER);
  await integrator.waitForDeployment();
  const integratorAddress = await integrator.getAddress();

  console.log(`[Integrator] DefiIntegrator deployed at ${integratorAddress}`);
  console.log(`             uniswapRouter() = ${await integrator.uniswapRouter()}`);

  // 3. Save the addresses for scripts/integrate.ts
  const deployment = {
    network: networkName,
    chainId: Number(chainId),
    router: UNISWAP_V2_ROUTER,
    factory: factoryAddress,
    tokenA: tokenAAddress,
    tokenB: tokenBAddress,
    integrator: integratorAddress,
  };
  const file = `deployments/${networkName}.json`;
  await mkdir("deployments", { recursive: true });
  await writeFile(file, JSON.stringify(deployment, null, 2) + "\n");
  console.log(`\nAddresses saved to ${file}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
