// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import { SafeERC20, IERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { Initializable } from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";

import { IBaseTrustedFiller } from "@interfaces/IBaseTrustedFiller.sol";

import { GPv2OrderLib, COWSWAP_GPV2_SETTLEMENT, COWSWAP_GPV2_VAULT_RELAYER } from "./GPv2OrderLib.sol";

uint256 constant D27 = 1e27; // D27

/// Swap MUST occur in the same block as initialization
/// Expected to be newly deployed in the pre-hook of a CowSwap order
/// Ideally `close()` is called in the end as a post-hook, but this is not relied upon
contract CowSwapFiller is Initializable, IBaseTrustedFiller {
    using GPv2OrderLib for GPv2OrderLib.Data;
    using SafeERC20 for IERC20;

    error CowSwapFiller__Unauthorized();
    error CowSwapFiller__SlippageExceeded();
    error CowSwapFiller__InvalidCowSwapOrder();
    error CowSwapFiller__InvalidEIP1271Signature();

    address public fillCreator;

    IERC20 public sellToken;
    IERC20 public buyToken;

    uint256 public sellAmount; // {sellTok}
    uint256 public blockInitialized; // {block}

    uint256 public price; // D27{buyTok/sellTok}

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        _disableInitializers();
    }

    /// Initialize the swap, transferring in `_sellAmount` of the `_sell` token
    /// @dev Built for the pre-hook of a CowSwap order
    function initialize(
        address _beneficiary,
        IERC20 _sell,
        IERC20 _buy,
        uint256 _sellAmount,
        uint256 _minBuyAmount
    ) external initializer {
        fillCreator = _beneficiary;
        sellToken = _sell;
        buyToken = _buy;
        sellAmount = _sellAmount;

        blockInitialized = block.number;

        // D27{buyTok/sellTok} = {buyTok} * D27 / {sellTok}
        price = (_minBuyAmount * D27) / _sellAmount;

        sellToken.forceApprove(COWSWAP_GPV2_VAULT_RELAYER, _sellAmount);
        sellToken.safeTransferFrom(_beneficiary, address(this), _sellAmount);
    }

    /// @dev Validates an in-same-block cowswap order for a partial fill via EIP-1271
    function isValidSignature(bytes32 _hash, bytes calldata signature) external view returns (bytes4) {
        require(block.number == blockInitialized, CowSwapFiller__Unauthorized());

        // Decode signature to get the CowSwap order
        GPv2OrderLib.Data memory order = abi.decode(signature, (GPv2OrderLib.Data));

        // Verify Order Hash
        require(
            _hash == order.hash(COWSWAP_GPV2_SETTLEMENT.domainSeparator()),
            CowSwapFiller__InvalidEIP1271Signature()
        );

        // D27{buyTok/sellTok} = {buyTok} * D27 / {sellTok}
        uint256 orderPrice = (order.buyAmount * D27) / order.sellAmount; // TODO: Replace with SafeMath?
        require(
            order.sellToken == address(sellToken) &&
                order.buyToken == address(buyToken) &&
                order.feeAmount == 0 &&
                order.partiallyFillable && // TODO: This partial fill stuff is a bit of a thing.
                order.receiver == address(this),
            CowSwapFiller__InvalidCowSwapOrder()
        );
        require(
            order.sellAmount != 0 && order.sellAmount <= sellAmount && orderPrice >= price,
            CowSwapFiller__SlippageExceeded()
        );

        // If all checks pass, return the magic value
        return this.isValidSignature.selector;
    }

    /// Collect all balances back to the beneficiary
    function closeFiller() external {
        sellToken.safeTransfer(fillCreator, sellToken.balanceOf(address(this)));
        buyToken.safeTransfer(fillCreator, buyToken.balanceOf(address(this)));
    }
}
