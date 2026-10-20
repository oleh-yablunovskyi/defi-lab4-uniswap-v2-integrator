// Control task, step 3: the backend script. It talks to the node over JSON-RPC, takes the
// addresses written by scripts/deploy.ts and
//   a) approves DefiIntegrator to spend token A (liquidity + swap) and token B (liquidity);
//   b) calls provideLiquidity, which creates a new KYIV / mFIAT pair in Uniswap V2 with the
//      initial liquidity 1000 KYIV : 2000 mFIAT (1 KYIV = 2 mFIAT);
//   c) calls swapTokens, which swaps 50 KYIV for mFIAT through the new pair.
//   npx hardhat run scripts/integrate.ts --network localhost
import { readFile } from "node:fs/promises";
import { network } from "hardhat";
import type { ContractTransactionResponse, TransactionReceipt } from "ethers";

const { ethers, networkName } = await network.create();
const { formatEther, parseEther } = ethers;

// Human-readable ABI of the Uniswap V2 functions and events the script uses
const ROUTER_ABI = [
  "function getAmountsOut(uint amountIn, address[] path) external view returns (uint[] amounts)",
];
const FACTORY_ABI = [
  "function getPair(address tokenA, address tokenB) external view returns (address pair)",
  "function allPairsLength() external view returns (uint)",
  "event PairCreated(address indexed token0, address indexed token1, address pair, uint)",
];
const PAIR_ABI = [
  "function token0() external view returns (address)",
  "function getReserves() external view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)",
  "function totalSupply() external view returns (uint)",
  "function balanceOf(address owner) external view returns (uint)",
  "event Mint(address indexed sender, uint amount0, uint amount1)",
  "event Swap(address indexed sender, uint amount0In, uint amount1In, uint amount0Out, uint amount1Out, address indexed to)",
];

const LIQUIDITY_A = parseEther("1000"); // KYIV
const LIQUIDITY_B = parseEther("2000"); // mFIAT
const SWAP_AMOUNT = parseEther("50"); // KYIV
const SLIPPAGE_BPS = 100n; // amountOutMin = quote minus 1%

const deployment = JSON.parse(await readFile(`deployments/${networkName}.json`, "utf8"));
if ((await ethers.provider.getCode(deployment.integrator)) === "0x") {
  throw new Error(`No integrator at ${deployment.integrator}, run scripts/deploy.ts first`);
}
const [user] = await ethers.getSigners();
const tokenA = await ethers.getContractAt("AssetToken", deployment.tokenA);
const tokenB = await ethers.getContractAt("AssetToken", deployment.tokenB);
const integrator = await ethers.getContractAt("DefiIntegrator", deployment.integrator);
const router = new ethers.Contract(deployment.router, ROUTER_ABI, ethers.provider);
const factory = new ethers.Contract(deployment.factory, FACTORY_ABI, ethers.provider);
const A = deployment.tokenA as string;
const B = deployment.tokenB as string;

// Names for the addresses the output mentions
const names: Record<string, string> = {
  [A.toLowerCase()]: "KYIV",
  [B.toLowerCase()]: "mFIAT",
  [user.address.toLowerCase()]: "user",
  [deployment.integrator.toLowerCase()]: "DefiIntegrator",
  [deployment.router.toLowerCase()]: "router",
};
const named = (address: string) => `${address} (${names[address.toLowerCase()] ?? "?"})`;

async function send(label: string, response: Promise<ContractTransactionResponse>) {
  const receipt = (await (await response).wait()) as TransactionReceipt;
  console.log(`[Tx] ${label}: block ${receipt.blockNumber}, status ${receipt.status}, gas used ${receipt.gasUsed}`);
  console.log(`     hash ${receipt.hash}`);
  return receipt;
}

async function balances(label: string) {
  const a = formatEther(await tokenA.balanceOf(user.address));
  const b = formatEther(await tokenB.balanceOf(user.address));
  console.log(`[Balance] ${label}: ${a} KYIV, ${b} mFIAT`);
}

console.log(`[User] account #0 ${user.address}`);
await balances("start");

// a) The user allows the integrator to take token A (liquidity + swap) and token B (liquidity)
console.log(`\na) approve: DefiIntegrator may spend ${formatEther(LIQUIDITY_A + SWAP_AMOUNT)} KYIV and ${formatEther(LIQUIDITY_B)} mFIAT`);
await send("KYIV.approve", tokenA.approve(deployment.integrator, LIQUIDITY_A + SWAP_AMOUNT));
await send("mFIAT.approve", tokenB.approve(deployment.integrator, LIQUIDITY_B));
const allowanceA = formatEther(await tokenA.allowance(user.address, deployment.integrator));
const allowanceB = formatEther(await tokenB.allowance(user.address, deployment.integrator));
console.log(`[Allowance] user -> DefiIntegrator: ${allowanceA} KYIV, ${allowanceB} mFIAT`);

// b) provideLiquidity: the router creates the pair in the factory and adds the liquidity
console.log(`\nb) provideLiquidity: ${formatEther(LIQUIDITY_A)} KYIV + ${formatEther(LIQUIDITY_B)} mFIAT`);
console.log(`[Factory] ${deployment.factory}: ${await factory.allPairsLength()} pairs`);
console.log(`          getPair(KYIV, mFIAT) = ${await factory.getPair(A, B)}`);
const liquidityReceipt = await send(
  "DefiIntegrator.provideLiquidity",
  integrator.provideLiquidity(A, B, LIQUIDITY_A, LIQUIDITY_B),
);
const pairAddress: string = await factory.getPair(A, B);
const pair = new ethers.Contract(pairAddress, PAIR_ABI, ethers.provider);
// The pair sorts its two tokens by address: token0 is the smaller one
const aIsToken0 = (await pair.token0()).toLowerCase() === A.toLowerCase();
const [symbol0, symbol1] = aIsToken0 ? ["KYIV", "mFIAT"] : ["mFIAT", "KYIV"];

async function reserves() {
  const [reserve0, reserve1]: bigint[] = await pair.getReserves();
  const [reserveA, reserveB] = aIsToken0 ? [reserve0, reserve1] : [reserve1, reserve0];
  const price = formatEther((reserveB * 10n ** 18n) / reserveA);
  console.log(`[Pair] reserves: ${formatEther(reserveA)} KYIV / ${formatEther(reserveB)} mFIAT, 1 KYIV = ${price} mFIAT`);
}

for (const log of liquidityReceipt.logs) {
  if (log.address.toLowerCase() === deployment.factory.toLowerCase()) {
    const event = factory.interface.parseLog(log)!;
    const [token0, token1, created, count] = event.args;
    console.log(`[Event] PairCreated: pair ${created}, pairs ${count}`);
    console.log(`        token0 ${named(token0)}`);
    console.log(`        token1 ${named(token1)}`);
  }
  if (log.address.toLowerCase() === pairAddress.toLowerCase()) {
    const event = pair.interface.parseLog(log);
    if (event?.name === "Mint") {
      const [sender, amount0, amount1] = event.args;
      console.log(`[Event] Mint: sender ${named(sender)}`);
      console.log(`        amount0 ${formatEther(amount0)} ${symbol0}, amount1 ${formatEther(amount1)} ${symbol1}`);
    }
  }
}
console.log(`[Factory] ${await factory.allPairsLength()} pairs, getPair(KYIV, mFIAT) = ${pairAddress}`);
await reserves();
const lpUser: bigint = await pair.balanceOf(user.address);
const lpTotal: bigint = await pair.totalSupply();
const lpLocked: bigint = await pair.balanceOf(ethers.ZeroAddress);
console.log(`[LP] user: ${formatEther(lpUser)} of ${formatEther(lpTotal)} LP tokens (${lpLocked} wei at address 0)`);
await balances("after provideLiquidity");

// c) swapTokens: the minimum output is the router's quote minus the slippage tolerance
console.log(`\nc) swapTokens: ${formatEther(SWAP_AMOUNT)} KYIV -> mFIAT`);
const [, quote]: bigint[] = await router.getAmountsOut(SWAP_AMOUNT, [A, B]);
const amountOutMin = (quote * (10000n - SLIPPAGE_BPS)) / 10000n;
console.log(`[Quote] router.getAmountsOut: ${formatEther(quote)} mFIAT`);
console.log(`        amountOutMin (quote - 1%): ${formatEther(amountOutMin)} mFIAT`);
const balanceBBefore = await tokenB.balanceOf(user.address);
const swapReceipt = await send(
  "DefiIntegrator.swapTokens",
  integrator.swapTokens(A, B, SWAP_AMOUNT, amountOutMin),
);
for (const log of swapReceipt.logs) {
  if (log.address.toLowerCase() !== pairAddress.toLowerCase()) continue;
  const event = pair.interface.parseLog(log);
  if (event?.name === "Swap") {
    const [sender, amount0In, amount1In, amount0Out, amount1Out, to] = event.args;
    console.log(`[Event] Swap: sender ${named(sender)}`);
    console.log(`        to ${named(to)}`);
    console.log(`        amount0In ${formatEther(amount0In)} ${symbol0}, amount1In ${formatEther(amount1In)} ${symbol1}`);
    console.log(`        amount0Out ${formatEther(amount0Out)} ${symbol0}, amount1Out ${formatEther(amount1Out)} ${symbol1}`);
  }
}
const received = (await tokenB.balanceOf(user.address)) - balanceBBefore;
console.log(`[Result] received ${formatEther(received)} mFIAT`);
await reserves();
await balances("end");
const leftA = formatEther(await tokenA.balanceOf(deployment.integrator));
const leftB = formatEther(await tokenB.balanceOf(deployment.integrator));
console.log(`[Integrator] tokens left on DefiIntegrator: ${leftA} KYIV, ${leftB} mFIAT`);
