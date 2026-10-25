// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {ShowUp} from "../ShowUp.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Handler for the ShowUp invariant suite.
///      Exposes a bounded call-set that the fuzzer drives.
contract ShowUpHandler is Test {
    ShowUp    internal showup;
    MockERC20 internal usdc;

    // Single event under test.
    uint256 public eventId;
    uint64  public deadline;

    // Bounded actor set.
    address[] internal actors;
    address   internal organizer;

    // Track unclaimed deposits still owed by the contract.
    uint256 public totalDeposited;
    uint256 public totalClaimed;
    uint256 public totalRefunded;

    uint256 internal constant DEPOSIT  = 5e6;
    uint32  internal constant CAPACITY = 5;
    uint256 internal constant N        = 5;

    constructor(ShowUp _showup, MockERC20 _usdc) {
        showup   = _showup;
        usdc     = _usdc;
        organizer = makeAddr("inv_organizer");

        // Pin timestamps.
        uint64 start = uint64(block.timestamp + 1 days);
        deadline     = uint64(block.timestamp + 2 days);

        vm.prank(organizer);
        eventId = showup.createEvent("Inv Event", DEPOSIT, CAPACITY, start, deadline);

        // Create actors and fund them.
        for (uint256 i = 0; i < N; ++i) {
            address a = address(uint160(0xA000 + i));
            actors.push(a);
            usdc.mint(a, DEPOSIT * 10);
            vm.prank(a);
            usdc.approve(address(showup), type(uint256).max);
        }
    }

    function rsvpActor(uint256 seed) external {
        address actor = actors[seed % actors.length];
        if (showup.isRsvped(eventId, actor)) return;
        ShowUp.Event memory e = showup.getEvent(eventId);
        if (block.timestamp >= e.startTime)  return;
        if (e.rsvpCount >= e.capacity)       return;

        vm.prank(actor);
        showup.rsvp(eventId);
        totalDeposited += DEPOSIT;
    }

    function cancelActor(uint256 seed) external {
        address actor = actors[seed % actors.length];
        if (!showup.isRsvped(eventId, actor)) return;
        ShowUp.Event memory e = showup.getEvent(eventId);
        if (block.timestamp >= e.startTime)  return;

        vm.prank(actor);
        showup.cancelRsvp(eventId);
        // totalDeposited is gross inflows only — do NOT subtract here.
        totalRefunded += DEPOSIT;
    }

    function checkInActor(uint256 seed) external {
        address actor = actors[seed % actors.length];
        if (!showup.isRsvped(eventId, actor))    return;
        if (showup.isCheckedIn(eventId, actor))  return;
        ShowUp.Event memory e = showup.getEvent(eventId);
        if (block.timestamp > e.checkInDeadline) return;
        if (block.timestamp < e.startTime) {
            vm.warp(e.startTime);
        }

        vm.prank(organizer);
        showup.checkIn(eventId, actor);
    }

    function claimActor(uint256 seed) external {
        address actor = actors[seed % actors.length];
        if (!showup.isRsvped(eventId, actor))  return;
        if (showup.hasClaimed(eventId, actor)) return;
        if (block.timestamp <= deadline) {
            vm.warp(deadline + 1);
        }

        uint256 payout = showup.payoutFor(eventId, actor);
        // payoutFor returns 0 for no-shows when checkedInCount > 0 — claim would revert.
        if (payout == 0) return;

        vm.prank(actor);
        showup.claim(eventId);
        totalClaimed += payout;
    }

    function warpToDeadline() external {
        if (block.timestamp <= deadline) vm.warp(deadline + 1);
    }
}

/// @dev Invariant: contract USDC balance >= sum of unclaimed deposits still owed.
contract ShowUpInvariantTest is Test {
    ShowUp        internal showup;
    MockERC20     internal usdc;
    ShowUpHandler internal handler;

    function setUp() public {
        vm.warp(1_000_000);
        usdc   = new MockERC20("Mock USDC", "mUSDC", 6);
        showup = new ShowUp(address(usdc));

        handler = new ShowUpHandler(showup, usdc);

        // Only fuzz through the handler.
        targetContract(address(handler));
    }

    /// @dev The contract must always hold at least as much USDC as
    ///      (totalDeposited - totalClaimed - totalRefunded).
    ///      This is the conservation-of-funds invariant.
    function invariant_ContractBalanceCoversOutstanding() public view {
        uint256 balance     = usdc.balanceOf(address(showup));
        uint256 totalIn     = handler.totalDeposited();
        uint256 totalOut    = handler.totalClaimed() + handler.totalRefunded();
        uint256 outstanding = totalIn > totalOut ? totalIn - totalOut : 0;

        assertGe(balance, outstanding, "Contract underfunded vs outstanding deposits");
    }

    /// @dev balance >= (totalDeposited - totalClaimed - totalRefunded).
    ///      No funds are ever drained below what is still owed.
    ///      Note: integer-division dust can leave the contract with *more* than
    ///      totalDeposited - totalClaimed - totalRefunded; >= is the correct bound.
    function invariant_FundsAccountedFor() public view {
        uint256 balance  = usdc.balanceOf(address(showup));
        uint256 inflow   = handler.totalDeposited();
        uint256 outflow  = handler.totalClaimed() + handler.totalRefunded();
        uint256 expected = inflow > outflow ? inflow - outflow : 0;
        // balance must be >= expected (dust may leave a small surplus)
        assertGe(balance, expected, "Contract drained below outstanding obligations");
    }
}
