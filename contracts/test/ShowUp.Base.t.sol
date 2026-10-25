// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ShowUp} from "../ShowUp.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Shared setup and helpers for all ShowUp test suites.
abstract contract ShowUpTestBase is Test {
    // ─── Actors ────────────────────────────────────────────────────────────────
    address internal organizer = makeAddr("organizer");
    address internal alice     = makeAddr("alice");
    address internal bob       = makeAddr("bob");
    address internal carol     = makeAddr("carol");
    address internal dave      = makeAddr("dave");   // extra, for capacity tests

    // ─── Contracts ─────────────────────────────────────────────────────────────
    MockERC20 internal usdc;
    ShowUp    internal showup;

    // ─── Event constants ───────────────────────────────────────────────────────
    uint256 internal constant DEPOSIT   = 10e6;   // 10 USDC (6 decimals)
    uint32  internal constant CAPACITY  = 3;
    uint256 internal constant MINT_AMT  = 1_000e6;

    // ─── Time anchors (set in setUp relative to block.timestamp = 1_000_000) ───
    uint64 internal T0;          // "now" baseline
    uint64 internal START;       // T0 + 1 day
    uint64 internal DEADLINE;    // T0 + 2 days

    // ─── Event-id for the default event ────────────────────────────────────────
    uint256 internal eventId;

    // ─────────────────────────────────────────────────────────────────────────
    function setUp() public virtual {
        // Pin block.timestamp so relative offsets are deterministic.
        vm.warp(1_000_000);
        T0       = uint64(block.timestamp);
        START    = T0 + 1 days;
        DEADLINE = T0 + 2 days;

        // Deploy mock USDC and ShowUp.
        usdc   = new MockERC20("Mock USDC", "mUSDC", 6);
        showup = new ShowUp(address(usdc));

        // Mint tokens and approve ShowUp for every actor.
        address[4] memory actors = [alice, bob, carol, dave];
        for (uint256 i; i < actors.length; ++i) {
            usdc.mint(actors[i], MINT_AMT);
            vm.prank(actors[i]);
            usdc.approve(address(showup), type(uint256).max);
        }

        // Create the default event as organizer.
        vm.prank(organizer);
        eventId = showup.createEvent("Test Event", DEPOSIT, CAPACITY, START, DEADLINE);
    }

    // ─── Helpers ───────────────────────────────────────────────────────────────

    /// @dev RSVP a list of addresses to `eventId`.
    function _rsvpAll(address[] memory attendees) internal {
        for (uint256 i; i < attendees.length; ++i) {
            vm.prank(attendees[i]);
            showup.rsvp(eventId);
        }
    }

    /// @dev Move time past start, check in a list of addresses.
    function _checkInAll(address[] memory attendees) internal {
        // Only move if we're still before start.
        if (block.timestamp < START) vm.warp(START);
        for (uint256 i; i < attendees.length; ++i) {
            vm.prank(organizer);
            showup.checkIn(eventId, attendees[i]);
        }
    }

    /// @dev Move time past deadline so claims are open.
    function _passDeadline() internal {
        vm.warp(DEADLINE + 1);
    }

    /// @dev Build a dynamic address array from fixed-size inputs.
    function _arr(address a) internal pure returns (address[] memory r) {
        r = new address[](1); r[0] = a;
    }
    function _arr(address a, address b) internal pure returns (address[] memory r) {
        r = new address[](2); r[0] = a; r[1] = b;
    }
    function _arr(address a, address b, address c) internal pure returns (address[] memory r) {
        r = new address[](3); r[0] = a; r[1] = b; r[2] = c;
    }
}
