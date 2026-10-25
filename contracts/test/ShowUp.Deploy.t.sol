// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ShowUpTestBase} from "./ShowUp.Base.t.sol";
import {ShowUp} from "../ShowUp.sol";
import {MockERC20} from "../test-helpers/MockERC20.sol";

/// @dev Covers: constructor, createEvent validations, payoutFor view, and event emissions.
contract ShowUpDeployTest is ShowUpTestBase {

    // ── Constructor ────────────────────────────────────────────────────────────

    function test_Constructor_SetsUsdcImmutable() public view {
        assertEq(address(showup.usdc()), address(usdc));
    }

    function test_Constructor_RevertsOnZeroAddress() public {
        vm.expectRevert(bytes("Zero USDC"));
        new ShowUp(address(0));
    }

    function test_Constructor_InitialEventCountZero() public {
        // Deploy a fresh instance to confirm initial state.
        ShowUp fresh = new ShowUp(address(usdc));
        assertEq(fresh.eventCount(), 0);
    }

    // ── createEvent: happy path ────────────────────────────────────────────────

    function test_CreateEvent_IncrementsEventCount() public view {
        assertEq(showup.eventCount(), 1);
    }

    function test_CreateEvent_StoresEventFields() public view {
        ShowUp.Event memory e = showup.getEvent(eventId);
        assertEq(e.name,            "Test Event");
        assertEq(e.organizer,       organizer);
        assertEq(e.deposit,         DEPOSIT);
        assertEq(e.capacity,        CAPACITY);
        assertEq(uint256(e.startTime),        uint256(START));
        assertEq(uint256(e.checkInDeadline),  uint256(DEADLINE));
        assertEq(e.rsvpCount,       0);
        assertEq(e.checkedInCount,  0);
        assertEq(e.claimedCount,    0);
        // createdBlock must be non-zero (set to block.number at creation time).
        assertGt(uint256(e.createdBlock), 0);
    }

    function test_CreateEvent_StoresCreatedBlock() public {
        // Roll forward to a known block number, create a second event, verify createdBlock.
        vm.roll(42_000);
        vm.prank(organizer);
        uint256 eid2 = showup.createEvent("Block Test", DEPOSIT, CAPACITY, START, DEADLINE);
        ShowUp.Event memory e = showup.getEvent(eid2);
        assertEq(uint256(e.createdBlock), 42_000);
    }

    function test_CreateEvent_EmitsEventCreated() public {
        vm.prank(organizer);
        vm.expectEmit(true, true, false, true, address(showup));
        emit ShowUp.EventCreated(
            2,
            organizer,
            "Second Event",
            DEPOSIT,
            CAPACITY,
            START,
            DEADLINE
        );
        showup.createEvent("Second Event", DEPOSIT, CAPACITY, START, DEADLINE);
    }

    // ── createEvent: revert validations ───────────────────────────────────────

    function test_CreateEvent_RevertsOnZeroDeposit() public {
        vm.prank(organizer);
        vm.expectRevert(bytes("Deposit zero"));
        showup.createEvent("Bad", 0, CAPACITY, START, DEADLINE);
    }

    function test_CreateEvent_RevertsOnZeroCapacity() public {
        vm.prank(organizer);
        vm.expectRevert(bytes("Capacity zero"));
        showup.createEvent("Bad", DEPOSIT, 0, START, DEADLINE);
    }

    function test_CreateEvent_RevertsWhenStartTimeInPast() public {
        vm.prank(organizer);
        vm.expectRevert(bytes("Bad start"));
        showup.createEvent("Bad", DEPOSIT, CAPACITY, T0, DEADLINE);
    }

    function test_CreateEvent_RevertsWhenStartTimeIsNow() public {
        vm.prank(organizer);
        vm.expectRevert(bytes("Bad start"));
        showup.createEvent("Bad", DEPOSIT, CAPACITY, uint64(block.timestamp), DEADLINE);
    }

    function test_CreateEvent_RevertsWhenDeadlineEqualsStart() public {
        vm.prank(organizer);
        vm.expectRevert(bytes("Bad deadline"));
        showup.createEvent("Bad", DEPOSIT, CAPACITY, START, START);
    }

    function test_CreateEvent_RevertsWhenDeadlineBeforeStart() public {
        vm.prank(organizer);
        vm.expectRevert(bytes("Bad deadline"));
        showup.createEvent("Bad", DEPOSIT, CAPACITY, START, T0 + 1 hours);
    }

    // ── payoutFor: pre-deadline returns 0 ─────────────────────────────────────

    function test_PayoutFor_ReturnsZeroBeforeDeadline() public {
        _rsvpAll(_arr(alice));
        // Still before DEADLINE — should return 0.
        assertEq(showup.payoutFor(eventId, alice), 0);
    }

    // ── payoutFor: post-deadline, nobody checked in → full deposit ─────────────

    function test_PayoutFor_FullRefundWhenNobodyCheckedIn() public {
        _rsvpAll(_arr(alice, bob));
        _passDeadline();
        assertEq(showup.payoutFor(eventId, alice), DEPOSIT);
        assertEq(showup.payoutFor(eventId, bob),   DEPOSIT);
    }

    // ── payoutFor: post-deadline, with check-ins ───────────────────────────────

    function test_PayoutFor_CorrectPayoutWithCheckins() public {
        // 3 RSVPs, 2 checked in.
        _rsvpAll(_arr(alice, bob, carol));
        _checkInAll(_arr(alice, bob));
        _passDeadline();

        // forfeitedPool = DEPOSIT * (3 - 2) = DEPOSIT
        // payout = DEPOSIT + DEPOSIT / 2
        uint256 expected = DEPOSIT + DEPOSIT / 2;
        assertEq(showup.payoutFor(eventId, alice), expected);
        assertEq(showup.payoutFor(eventId, bob),   expected);
    }

    // ── payoutFor: post-deadline, no-show returns 0 ────────────────────────────

    function test_PayoutFor_ZeroForNoShow() public {
        _rsvpAll(_arr(alice, bob, carol));
        _checkInAll(_arr(alice, bob));
        _passDeadline();
        assertEq(showup.payoutFor(eventId, carol), 0);
    }

    // ── payoutFor: non-RSVPed address returns 0 ────────────────────────────────

    function test_PayoutFor_ZeroForNonRsvped() public {
        _passDeadline();
        assertEq(showup.payoutFor(eventId, dave), 0);
    }

    // ── rsvp: emits Rsvped ─────────────────────────────────────────────────────

    function test_Rsvp_EmitsRsvped() public {
        vm.prank(alice);
        vm.expectEmit(true, true, false, false, address(showup));
        emit ShowUp.Rsvped(eventId, alice);
        showup.rsvp(eventId);
    }

    // ── cancelRsvp: emits RsvpCancelled ───────────────────────────────────────

    function test_CancelRsvp_EmitsRsvpCancelled() public {
        _rsvpAll(_arr(alice));
        vm.prank(alice);
        vm.expectEmit(true, true, false, false, address(showup));
        emit ShowUp.RsvpCancelled(eventId, alice);
        showup.cancelRsvp(eventId);
    }

    // ── checkIn: emits CheckedIn ──────────────────────────────────────────────

    function test_CheckIn_EmitsCheckedIn() public {
        _rsvpAll(_arr(alice));
        vm.warp(START);
        vm.prank(organizer);
        vm.expectEmit(true, true, false, false, address(showup));
        emit ShowUp.CheckedIn(eventId, alice);
        showup.checkIn(eventId, alice);
    }

    // ── claim: emits Claimed ──────────────────────────────────────────────────

    function test_Claim_EmitsClaimed() public {
        _rsvpAll(_arr(alice));
        _passDeadline();
        uint256 expected = DEPOSIT; // nobody checked in → full refund
        vm.prank(alice);
        vm.expectEmit(true, true, false, true, address(showup));
        emit ShowUp.Claimed(eventId, alice, expected);
        showup.claim(eventId);
    }
}
