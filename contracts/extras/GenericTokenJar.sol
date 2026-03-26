// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import { Ownable } from "@openzeppelin/contracts/access/Ownable.sol";
import { IERC20, SafeERC20 } from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import { ECDSA } from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import { EIP712 } from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";

import { IBaseTrustedFiller } from "@interfaces/IBaseTrustedFiller.sol";
import { ITrustedFillerRegistry } from "@interfaces/ITrustedFillerRegistry.sol";

/**
 * @title Generic Token Jar
 * @notice Custodies arbitrary ERC20 sell tokens and routes them through any trusted
 *         filler implementation approved by the Trusted Filler Registry.
 * @dev Fill creation can be restricted to owner-signed requests. If ownership is
 *      renounced, fill creation becomes permissionless.
 */
contract GenericTokenJar is Ownable, EIP712 {
    using SafeERC20 for IERC20;

    bytes32 public constant FILL_REQUEST_TYPEHASH = keccak256(
        "FillRequest(address targetFiller,address sellToken,uint256 sellAmount,uint256 minBuyAmount,bytes32 deploymentSalt,uint256 deadline)"
    );

    address public immutable destination;
    IERC20 public immutable token;
    ITrustedFillerRegistry public immutable trustedFillerRegistry;

    IBaseTrustedFiller public activeTrustedFill;

    struct FillRequest {
        address targetFiller;
        address sellToken;
        uint256 sellAmount;
        uint256 minBuyAmount;
        bytes32 deploymentSalt;
        uint256 deadline;
    }

    error GenericTokenJar__ExpiredRequest();
    error GenericTokenJar__InvalidInitialization(uint256 errorCode);
    error GenericTokenJar__InvalidRequest(uint256 errorCode);
    error GenericTokenJar__UnauthorizedSigner();

    event TrustedFillClosed(address indexed filler);
    event TrustedFillCreated(
        address indexed relayer,
        address indexed filler,
        address indexed sellToken,
        uint256 sellAmount,
        uint256 minBuyAmount,
        bytes32 deploymentSalt,
        uint256 deadline
    );

    constructor(address _destination, IERC20 _token, address _signer, ITrustedFillerRegistry _trustedFillerRegistry)
        Ownable(_signer)
        EIP712("GenericTokenJar", "1")
    {
        require(_destination != address(0), GenericTokenJar__InvalidInitialization(1));
        require(address(_token) != address(0), GenericTokenJar__InvalidInitialization(2));
        require(address(_trustedFillerRegistry) != address(0), GenericTokenJar__InvalidInitialization(3));

        destination = _destination;
        token = _token;
        trustedFillerRegistry = _trustedFillerRegistry;
    }

    function createTrustedFill(FillRequest calldata request, bytes calldata ownerSignature)
        external
        returns (IBaseTrustedFiller filler)
    {
        _closeTrustedFill();
        _validateRequest(request);

        if (owner() != address(0)) {
            address signer = ECDSA.recover(_hashTypedDataV4(_hashFillRequest(request)), ownerSignature);

            require(signer == owner(), GenericTokenJar__UnauthorizedSigner());
        }

        filler = trustedFillerRegistry.createTrustedFiller(msg.sender, request.targetFiller, request.deploymentSalt);
        activeTrustedFill = filler;

        IERC20 sellToken = IERC20(request.sellToken);

        sellToken.forceApprove(address(filler), request.sellAmount);
        filler.initialize(address(this), sellToken, token, request.sellAmount, request.minBuyAmount);

        emit TrustedFillCreated(
            msg.sender,
            address(filler),
            request.sellToken,
            request.sellAmount,
            request.minBuyAmount,
            request.deploymentSalt,
            request.deadline
        );
    }

    function closeTrustedFill() external {
        _closeTrustedFill();
    }

    function pushTokens() external {
        _closeTrustedFill();

        token.safeTransfer(destination, token.balanceOf(address(this)));
    }

    function getFillRequestHash(FillRequest calldata request) external view returns (bytes32) {
        return _hashTypedDataV4(_hashFillRequest(request));
    }

    function _hashFillRequest(FillRequest calldata request) internal pure returns (bytes32) {
        return keccak256(
            abi.encode(
                FILL_REQUEST_TYPEHASH,
                request.targetFiller,
                request.sellToken,
                request.sellAmount,
                request.minBuyAmount,
                request.deploymentSalt,
                request.deadline
            )
        );
    }

    function _validateRequest(FillRequest calldata request) internal view {
        require(request.targetFiller != address(0), GenericTokenJar__InvalidRequest(1));
        require(request.sellToken != address(0), GenericTokenJar__InvalidRequest(2));
        require(request.sellAmount != 0, GenericTokenJar__InvalidRequest(3));
        require(request.minBuyAmount != 0, GenericTokenJar__InvalidRequest(4));
        require(block.timestamp <= request.deadline, GenericTokenJar__ExpiredRequest());
    }

    function _closeTrustedFill() internal {
        IBaseTrustedFiller filler = activeTrustedFill;
        if (address(filler) == address(0)) {
            return;
        }

        filler.closeFiller();
        delete activeTrustedFill;

        emit TrustedFillClosed(address(filler));
    }
}
