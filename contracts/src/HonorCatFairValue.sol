// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {SignatureChecker} from "@openzeppelin/contracts/utils/cryptography/SignatureChecker.sol";
import {HonorCatPots} from "./HonorCatPots.sol";

/// @title HonorCatFairValue
/// @notice A stateless reader: what a side of a live pot is worth, from a supplied price attestation.
///         The attestation is a window of kind QUOTE (6), signed by the pot's own signer set exactly
///         like an exit price, but it never moves money: the pot contract accepts only joins, exits,
///         nets and bowls. Other contracts (a lender, a marketplace for sides) can use this to value a
///         side token without trusting anyone but the pot's signer set.
/// @dev Kept out of HonorCatPots to stay under the 24 KB code limit. Reverts on anything it cannot
///      vouch for; never returns a stale or unsigned value.
contract HonorCatFairValue {
    uint8 public constant KIND_QUOTE = 6;
    uint256 internal constant P = 1e6;

    error NotLive();
    error BadQuote();
    error StaleQuote();
    error BadSignatures();

    /// @param pots    The HonorCatPots contract.
    /// @param side    0 = YES, 1 = NO.
    /// @param a       A QUOTE window for `a.potId`, signed by the pot's resolver (M of N, ERC-1271).
    /// @param sigs    The signatures, in the resolver's format.
    /// @param maxAge  How old (seconds after its end) the quote may be.
    /// @return share     The side's share of the pot at the attested price (USDC base units).
    /// @return exitFee   The fee that side would pay to leave with its whole share now.
    /// @return priceYes  The attested YES price (ppm).
    function fairValue(HonorCatPots pots, uint8 side, HonorCatPots.WindowAttestation calldata a, bytes calldata sigs, uint256 maxAge)
        external
        view
        returns (uint256 share, uint256 exitFee, uint32 priceYes)
    {
        HonorCatPots.Pot memory p = pots.pot(a.potId);
        if (p.state != HonorCatPots.State.Live && p.state != HonorCatPots.State.ExitRequested) revert NotLive();
        if (side > 1 || a.kind != KIND_QUOTE || !a.valid || a.priceYes > P || a.sampleCount < p.minSamples) revert BadQuote();
        if (a.windowEnd != a.windowStart + p.window) revert BadQuote();
        if (a.windowEnd > block.timestamp || block.timestamp - a.windowEnd > maxAge) revert StaleQuote();
        if (!SignatureChecker.isValidERC1271SignatureNow(p.resolver, pots.windowDigest(a), sigs)) revert BadSignatures();
        uint256 yes = pots.yesPart(p.notional, a.priceYes);
        share = side == 0 ? yes : p.notional - yes;
        exitFee = (p.notional * p.feeBps + 9_999) / 10_000;
        if (exitFee > share) exitFee = share;
        priceYes = a.priceYes;
    }
}
