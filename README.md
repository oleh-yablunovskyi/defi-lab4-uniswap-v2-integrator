# DeFi lab 4 — Uniswap V2 integration on a Sepolia fork

Lab work #4 for the course "Decentralized Finance (DeFi) and Cryptocurrency Technologies" (SUICT):
a smart contract that uses an existing DEX through its public interface (composability).

1. Two ERC-20 tokens from lab 2 are issued: KyivCoin (KYIV) and MockFiat (mFIAT).
2. `DefiIntegrator` is deployed with the address of a Uniswap V2 router.
3. A backend script approves the integrator, calls `provideLiquidity`, which creates a new
   KYIV / mFIAT pair in Uniswap V2, and then `swapTokens`, which swaps KYIV for mFIAT through that pair.

Everything runs on a local Hardhat node that forks Sepolia (chain id 31337 locally, forked chain
11155111). The Uniswap V2 contracts are the ones from the lab text, deployed on Sepolia:

| Contract | Address on Sepolia |
| --- | --- |
| UniswapV2Router02 | `0xC532a74256D3Db42D0Bf7a0400fEFDbad7694008` |
| UniswapV2Factory (`router.factory()`) | `0x7E0987E5b3a30e3f2828572Bb659A548460a3003` |
| WETH (`router.WETH()`) | `0x7b79995e5f793A07Bc00c21412e50Ecae098E7f9` |

The fork reads their code and storage from Sepolia over JSON-RPC, but every transaction is executed
only by the local node and never reaches Sepolia. No accounts, API keys or testnet ETH are needed.

The router and factory above are a separate deployment of the Uniswap V2 code (pair init code hash
`0x4156ccc0...3fe7`, protocol fee switched on), not the one the Uniswap docs list for Sepolia
(router `0xeE567Fe1712Faf6149d80dA1E6934E354124CfE3`).

## Layout

| Path | What it is |
| --- | --- |
| `contracts/AssetToken.sol` | ERC-20 token from lab 2 (OpenZeppelin), the whole supply goes to the deployer. |
| `contracts/DefiIntegrator.sol` | The integrator from the lab text: `provideLiquidity` and `swapTokens` call the router through `IUniswapV2Router02` from `@uniswap/v2-periphery`. |
| `scripts/deploy.ts` | Checks that the router exists, deploys KYIV, mFIAT and `DefiIntegrator`, writes `deployments/localhost.json`. |
| `scripts/integrate.ts` | The backend script: a) `approve` of both tokens to the integrator, b) `provideLiquidity` 1000 KYIV + 2000 mFIAT into a new pair, c) `swapTokens` of 50 KYIV with `amountOutMin` = the router quote minus 1%. |
| `hardhat.config.ts` | Solidity 0.8.34 and the `sepoliaFork` network. |

## Requirements

- Node.js 22 or newer, which EDR (the Hardhat node runtime) requires; checked with Node.js 22.22.2 and npm 11.14.0
- Internet access: the forked node reads Sepolia state from a JSON-RPC endpoint

## Running

```bash
npm install

# terminal 1: a local fork of Sepolia on http://127.0.0.1:8545
npx hardhat node --network sepoliaFork

# terminal 2: tokens and integrator, then approve -> provideLiquidity -> swapTokens
npx hardhat run scripts/deploy.ts --network localhost
npx hardhat run scripts/integrate.ts --network localhost
```

The scripts reach the forked node as Hardhat's built-in `localhost` network, so they talk to it over
plain JSON-RPC like to any other node.

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `SEPOLIA_RPC_URL` | `https://ethereum-sepolia-rpc.publicnode.com` | Sepolia endpoint the fork reads state from, for example `https://sepolia.drpc.org`; an empty value means the default |

The fork starts from the latest safe block of Sepolia (no block number is pinned). Public endpoints
keep the state of recent blocks only, so pinning an old block usually fails. Each restart of the node
forks a newer block and forgets the local transactions; run `deploy.ts` again after a restart.

The `sepoliaFork` network has its own test mnemonic. The default Hardhat accounts have publicly
known private keys, so on Sepolia they already have thousands of transactions and EIP-7702
delegations, and a fork would copy that state. The accounts of this mnemonic are funded only on the
local fork. The phrase is public, so never send real funds to these addresses.

## Expected output

An excerpt of `scripts/integrate.ts` on a fresh fork. The addresses of the lab contracts and of the
pair are the same on every fresh fork; block numbers, transaction hashes and the number of pairs
may differ.

```text
b) provideLiquidity: 1000.0 KYIV + 2000.0 mFIAT
[Factory] 0x7E0987E5b3a30e3f2828572Bb659A548460a3003: 27135 pairs
          getPair(KYIV, mFIAT) = 0x0000000000000000000000000000000000000000
[Tx] DefiIntegrator.provideLiquidity: block 11956959, status 1, gas used 2332649
[Event] PairCreated: pair 0x614f412A84Fab2Bb5cB41a9Aff4502844C2f4021, pairs 27136
[Pair] reserves: 1000.0 KYIV / 2000.0 mFIAT, 1 KYIV = 2.0 mFIAT
[LP] user: 1414.213562373095047801 of 1414.213562373095048801 LP tokens (1000 wei at address 0)

c) swapTokens: 50.0 KYIV -> mFIAT
[Quote] router.getAmountsOut: 94.965947516311854074 mFIAT
        amountOutMin (quote - 1%): 94.016288041148735533 mFIAT
[Tx] DefiIntegrator.swapTokens: block 11956960, status 1, gas used 161490
[Result] received 94.965947516311854074 mFIAT
```

The received amount equals the Uniswap V2 formula with the 0.3% fee:
50 · 997 · 2000 / (1000 · 1000 + 50 · 997) ≈ 94.9659 mFIAT.

## Notes

- `DefiIntegrator.sol` follows the lab text as is. `amountAMin` and `amountBMin` are fixed at 1, so
  `provideLiquidity` accepts any pool price, and tokens the router does not take stay on the
  integrator (this happens when the pair already exists with another ratio). The deadline
  `block.timestamp + 300` is computed when the transaction executes, so it never expires.
- The interfaces of `@uniswap/v2-periphery` 1.1.0-beta.0 have no SPDX line, so the compiler prints
  two warnings for them; they compile with solc 0.8.34 without changes.
- The token pair is sorted by address inside Uniswap: here mFIAT is `token0` and KYIV is `token1`.

The written report is kept outside this repository.
