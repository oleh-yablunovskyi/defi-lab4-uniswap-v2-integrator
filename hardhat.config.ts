import hardhatToolboxMochaEthersPlugin from "@nomicfoundation/hardhat-toolbox-mocha-ethers";
import { defineConfig } from "hardhat/config";

// JSON-RPC endpoint of Sepolia that the fork reads its state from. The default is a
// public endpoint that needs no account or API key; SEPOLIA_RPC_URL overrides it.
const sepoliaRpcUrl =
  process.env.SEPOLIA_RPC_URL ?? "https://ethereum-sepolia-rpc.publicnode.com";

export default defineConfig({
  plugins: [hardhatToolboxMochaEthersPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.34",
      },
      production: {
        version: "0.8.34",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    // Local fork of Sepolia: `npx hardhat node --network sepoliaFork` starts a node on
    // http://127.0.0.1:8545 that reads Sepolia state (the Uniswap V2 contracts among it)
    // as of the latest safe block; no block number is pinned. The scripts reach it as the
    // built-in "localhost" network. Transactions are executed only on this local node and
    // never reach Sepolia.
    sepoliaFork: {
      type: "edr-simulated",
      chainType: "l1",
      forking: {
        url: sepoliaRpcUrl,
      },
      // Test-only accounts made for this lab; they exist only on the local fork. The default
      // Hardhat accounts are not used here: their private keys are public, so on Sepolia
      // they have thousands of transactions and EIP-7702 delegations, which a fork copies.
      accounts: {
        mnemonic: "exclude april payment live found wealth glow indoor story tent lawsuit foot",
      },
    },
  },
});
