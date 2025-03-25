// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { IERC20 } from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import { IERC1271 } from "@openzeppelin/contracts/interfaces/IERC1271.sol";

interface IBaseTrustedFiller is IERC1271 {
    function initialize(
        address _creator,
        IERC20 _sellToken,
        IERC20 _buyToken,
        uint256 _sellAmount,
        uint256 _minBuyAmount
    ) external;

    function buyToken() external view returns (IERC20);

    function sellToken() external view returns (IERC20);

    function closeFiller() external;

    function rescueToken(IERC20 token) external;
}
