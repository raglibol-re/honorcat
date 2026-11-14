// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IPotCounter {
    function potCount() external view returns (uint256);
}

/// @title BatchGuard
/// @notice Stateless helper for one-transaction batches on Arc (Multicall3From).
/// @dev Pot ids in VerdictVault are sequential, so a batch such as
///      [USDC.approve, BatchGuard.expectNextPotId(vault, n), vault.createPot, vault.fund(n)]
///      has to predict the new pot's id. If someone else creates a pot first, this call reverts
///      and, with allowFailure = false, the whole batch reverts instead of funding another pot.
///      Kept outside the vault so the deployed vault does not change.
contract BatchGuard {
    error UnexpectedPotId(uint256 expected, uint256 next);

    function expectNextPotId(IPotCounter vault, uint256 id) external view {
        uint256 next = vault.potCount() + 1;
        if (next != id) revert UnexpectedPotId(id, next);
    }
}
