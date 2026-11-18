// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {RopesBase} from "../../src/ropes/RopesBase.sol";

/// @dev Exposes HonorCat v2's own internal arithmetic (no copy) to the symbolic checks.
contract RopesMathHarness is RopesBase {
    constructor() RopesBase(IERC20(address(1)), address(this)) {}

    function yesShare(uint256 size, uint256 price, uint256 lower, uint256 upper) external pure returns (uint256) {
        return _yesShare(size, price, lower, upper);
    }

    function potValue(uint256 size, uint256 lower, uint256 upper) external pure returns (uint256) {
        return _potValue(size, lower, upper);
    }

    function divideMath(uint8 exitSide, uint256 size, uint32 price, bool withFee, uint256 lower, uint256 upper)
        external
        pure
        returns (uint256, uint256, uint256)
    {
        return _divideMath(exitSide, size, price, withFee, lower, upper);
    }
}

/// @notice Symbolic checks (halmos: `halmos --contract RopesMathSymbolic`): each `check_` must hold for
///         every input within its bounds. Result on 2026-11-18 (halmos 0.3.3, 300 s per check): no
///         counterexample, but not proven either (two timeouts, one solver error on the 256-bit
///         products). The same properties run as fuzz tests in test/ropes/RopesFuzz.t.sol.
contract RopesMathSymbolic is Test {
    RopesMathHarness h;
    uint256 constant P = 1_000_000;
    uint256 constant MAXSIZE = 2 ** 64;

    function setUp() public {
        h = new RopesMathHarness();
    }

    function _posts(uint256 lower, uint256 upper) internal pure {
        vm.assume(lower < upper && upper <= P && lower % 100 == 0 && upper % 100 == 0);
    }

    /// The clamp: YES's share is within [0, pot], zero at or below L, the whole pot at or above U.
    function check_clamp(uint256 size, uint256 price, uint256 lower, uint256 upper) public view {
        vm.assume(size < MAXSIZE && price <= P);
        _posts(lower, upper);
        uint256 y = h.yesShare(size, price, lower, upper);
        uint256 v = h.potValue(size, lower, upper);
        assertLe(y, v);
        if (price <= lower) assertEq(y, 0);
        if (price >= upper) assertEq(y, v);
    }

    /// Conservation and the fee bound: a division pays out exactly the pot value of the exited size, the
    /// fee is at most 1% of it and never more than the exiter's cash, so no side ends below zero.
    function check_divide(uint8 side, uint256 size, uint32 price, bool withFee, uint256 lower, uint256 upper) public view {
        vm.assume(side < 2 && size < MAXSIZE && price <= P);
        _posts(lower, upper);
        (uint256 y, uint256 n, uint256 fee) = h.divideMath(side, size, price, withFee, lower, upper);
        uint256 v = h.potValue(size, lower, upper);
        assertEq(y + n, v);
        assertLe(fee * 100, v);
        uint256 cashYes = h.yesShare(size, price, lower, upper);
        assertLe(fee, side == 0 ? cashYes : v - cashYes);
    }

    /// An extra life (YES lowers L) never reduces NO's share at any price.
    function check_lifeKeepsOtherClaim(uint256 size, uint256 price, uint256 lower, uint256 upper, uint256 step) public view {
        vm.assume(size < MAXSIZE && price <= P && step % 100 == 0 && step > 0 && step <= lower);
        _posts(lower, upper);
        uint256 noBefore = h.potValue(size, lower, upper) - h.yesShare(size, price, lower, upper);
        uint256 newL = lower - step;
        uint256 noAfter = h.potValue(size, newL, upper) - h.yesShare(size, price, newL, upper);
        assertGe(noAfter, noBefore);
    }
}
