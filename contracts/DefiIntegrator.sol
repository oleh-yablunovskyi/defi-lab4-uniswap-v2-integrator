// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
// Import of the official Uniswap V2 router interface
import "@uniswap/v2-periphery/contracts/interfaces/IUniswapV2Router02.sol";

contract DefiIntegrator {
    IUniswapV2Router02 public immutable uniswapRouter;

    constructor(address _routerAddress) {
        uniswapRouter = IUniswapV2Router02(_routerAddress);
    }

    function provideLiquidity(
        address tokenA,
        address tokenB,
        uint256 amountADesired,
        uint256 amountBDesired
    ) external {
        // Move the tokens from the user to this contract
        IERC20(tokenA).transferFrom(msg.sender, address(this), amountADesired);
        IERC20(tokenB).transferFrom(msg.sender, address(this), amountBDesired);

        // Allow the Router to take these tokens from our contract
        IERC20(tokenA).approve(address(uniswapRouter), amountADesired);
        IERC20(tokenB).approve(address(uniswapRouter), amountBDesired);

        // Call the Uniswap function that adds liquidity
        uniswapRouter.addLiquidity(
            tokenA,
            tokenB,
            amountADesired,
            amountBDesired,
            1, // amountAMin (slippage protection, calculated in real code)
            1, // amountBMin
            msg.sender, // LP tokens (proof of liquidity) go to the owner
            block.timestamp + 300 // Transaction deadline (5 minutes)
        );
    }

    function swapTokens(
        address tokenIn,
        address tokenOut,
        uint256 amountIn,
        uint256 amountOutMin
    ) external {
        IERC20(tokenIn).transferFrom(msg.sender, address(this), amountIn);
        IERC20(tokenIn).approve(address(uniswapRouter), amountIn);

        // Swap path. For a direct swap it is an array of two addresses.
        address[] memory path = new address[](2);
        path[0] = tokenIn;
        path[1] = tokenOut;

        uniswapRouter.swapExactTokensForTokens(
            amountIn,
            amountOutMin, // Minimum amount of tokens we agree to receive
            path,
            msg.sender, // Recipient of the final tokens
            block.timestamp + 300 // Deadline
        );
    }
}
