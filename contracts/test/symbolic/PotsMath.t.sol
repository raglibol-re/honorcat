// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {HonorCatPots} from "../../src/HonorCatPots.sol";

/// @dev Exposes the contract's own pure arithmetic (no copy) to the symbolic checks.
contract PotsMathHarness is HonorCatPots {
    constructor() HonorCatPots(IERC20(address(1)), address(this)) {}

    function divideMath(uint8 exitSide, uint256 n, uint32 price, uint16 fee_, uint256 depYes, uint256 notional)
        external
        pure
        returns (uint256, uint256, uint256, uint256)
    {
        return _divideMath(exitSide, n, price, fee_, depYes, notional);
    }
}

/// @notice Symbolic checks (halmos: `halmos --contract PotsMathSymbolic`). Each `check_` holds for
///         every input in its bounds, not just sampled ones. Also run as fuzz tests by forge.
contract PotsMathSymbolic is Test {
    PotsMathHarness h;
    uint256 constant MAXN = 2 ** 128;

    function setUp() public {
        h = new PotsMathHarness();
    }

    /// The split never loses or creates a unit.
    function check_split(uint256 n, uint256 p) public view {
        vm.assume(n < MAXN && p <= 1_000_000);
        uint256 y = h.yesPart(n, p);
        assertLe(y, n);
        assertEq(y + h.noPart(n, p), n);
    }

    /// A division pays out exactly the exited amount, the fee never exceeds the exiter's cash, and the
    /// remaining deposits stay within the remaining pot.
    function check_divide(uint8 side, uint256 n, uint32 price, uint16 fee, uint256 depYes, uint256 notional) public view {
        vm.assume(side <= 1 && price <= 1_000_000 && fee <= 500);
        vm.assume(notional > 0 && notional < MAXN && n > 0 && n <= notional && depYes <= notional);
        (uint256 payYes, uint256 payNo, uint256 f, uint256 newDepYes) = h.divideMath(side, n, price, fee, depYes, notional);
        assertEq(payYes + payNo, n);
        uint256 cashExit = side == 0 ? h.yesPart(n, price) : h.noPart(n, price);
        assertLe(f, cashExit);
        assertLe(newDepYes, notional - n);
    }

    /// Every entry price inside the band costs each side at most what it escrowed for the band.
    function check_bandEscrowCovers(uint256 n, uint32 c, uint32 t, uint32 e) public view {
        vm.assume(n < MAXN && c <= 1_000_000 && t <= 50_000 && e <= 1_000_000);
        vm.assume(uint256(e) + t >= c && e <= uint256(c) + t);
        assertLe(h.yesPart(n, e), h.worstCase(0, n, c, t));
        assertLe(h.noPart(n, e), h.worstCase(1, n, c, t));
    }

    // Run the same properties as fuzz tests under forge.
    function testFuzz_split(uint256 n, uint256 p) public view {
        n = bound(n, 0, MAXN - 1);
        p = bound(p, 0, 1_000_000);
        check_split(n, p);
    }

    function testFuzz_divide(uint8 side, uint256 n, uint32 price, uint16 fee, uint256 depYes, uint256 notional) public view {
        side = side % 2;
        price = uint32(bound(price, 0, 1_000_000));
        fee = uint16(bound(fee, 0, 500));
        notional = bound(notional, 1, MAXN - 1);
        n = bound(n, 1, notional);
        depYes = bound(depYes, 0, notional);
        check_divide(side, n, price, fee, depYes, notional);
    }
}
