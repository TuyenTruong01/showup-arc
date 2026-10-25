// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ShowUpTestBase} from "./ShowUp.Base.t.sol";
import {ShowUp} from "../ShowUp.sol";

/// @dev Covers: capacity / double-RSVP guards, checkIn guards, claim guards.
contract ShowUpGuardTest is ShowUpTestBase {

    // ── Scenario 4: capacity and double-RSVP ─────────────────────────────────

    /// @dev 4th RSVP when capacity == 3 reverts with "Event full".
    function test_Rsvp_RevertsWhenCapacityReached() public {
        // Fill all 3 slots.
        _rsvpAll(_arr(alice, bob, carol));

        // mint & approve for dave, then try to RSVP.
        vm.prank(dave);
        vm.expectRevert(bytes("Event full"));
        showup.rsvp(eventId);
    }

    /// @dev Attempting to RSVP a second time reverts with "Already RSVPed".
    function test_Rsvp_RevertsOnDoubleRsvp() public {
        _rsvpAll(_arr(alice));

        vm.prank(alice);
        vm.expectRevert(bytes("Already RSVPed"));
        showup.rsvp(eventId);
    }

    /// @dev RSVP after startTime reverts with "Event started".
    function test_Rsvp_RevertsAfterStartTime() public {
        vm.warp(START);
        vm.prank(alice);
        vm.expectRevert(bytes("Event started"));
        showup.rsvp(eventId);
    }

    // ── Scenario 5: checkIn guards ────────────────────────────────────────────

    /// @dev Non-organizer calling checkIn reverts.
    function test_CheckIn_RevertsForNonOrganizer() public {
        _rsvpAll(_arr(alice));
        vm.warp(START);
        vm.prank(alice); // alice is NOT the organizer
        vm.expectRevert(bytes("Not organizer"));
        showup.checkIn(eventId, alice);
    }

    /// @dev checkIn after checkInDeadline reverts with "Check-in closed".
    function test_CheckIn_RevertsAfterDeadline() public {
        _rsvpAll(_arr(alice));
        _passDeadline(); // warp past deadline
        vm.prank(organizer);
        vm.expectRevert(bytes("Check-in closed"));
        showup.checkIn(eventId, alice);
    }

    /// @dev checkIn of a non-RSVPed address reverts with "Not RSVPed".
    function test_CheckIn_RevertsForNonRsvpedAddress() public {
        vm.warp(START);
        vm.prank(organizer);
        vm.expectRevert(bytes("Not RSVPed"));
        showup.checkIn(eventId, dave); // dave never RSVPed
    }

    /// @dev Double checkIn reverts with "Already checked in".
    function test_CheckIn_RevertsOnDoubleCheckIn() public {
        _rsvpAll(_arr(alice));
        _checkInAll(_arr(alice));

        vm.prank(organizer);
        vm.expectRevert(bytes("Already checked in"));
        showup.checkIn(eventId, alice);
    }

    // ── Scenario 6: claim guards ──────────────────────────────────────────────

    /// @dev Double claim reverts with "Already claimed".
    function test_Claim_RevertsOnDoubleClaim() public {
        _rsvpAll(_arr(alice));
        _passDeadline();

        vm.prank(alice);
        showup.claim(eventId); // first claim succeeds

        vm.prank(alice);
        vm.expectRevert(bytes("Already claimed"));
        showup.claim(eventId); // second should revert
    }

    /// @dev Claim before checkInDeadline reverts with "Deadline not passed".
    function test_Claim_RevertsBeforeDeadline() public {
        _rsvpAll(_arr(alice));
        // still before DEADLINE
        vm.prank(alice);
        vm.expectRevert(bytes("Deadline not passed"));
        showup.claim(eventId);
    }

    /// @dev Claim by address that never RSVPed reverts with "Not RSVPed".
    function test_Claim_RevertsForNonRsvped() public {
        _passDeadline();
        vm.prank(dave); // dave never RSVPed
        vm.expectRevert(bytes("Not RSVPed"));
        showup.claim(eventId);
    }

    // ── Fuzz: deposit bounds arithmetic ──────────────────────────────────────

    /// @dev For any deposit d and attendee count n (1..50), where all n RSVPed but
    ///      only k (0..n) checked in, the sum of all payouts never exceeds total held.
    function testFuzz_PayoutNeverExceedsTotalHeld(
        uint96 rawDeposit,
        uint8  rawN,
        uint8  rawK
    ) public {
        // Bound inputs.
        uint256 deposit = bound(rawDeposit, 1, 1_000_000e6);
        uint256 n       = bound(rawN, 1, 10);  // keep gas manageable
        uint256 k       = bound(rawK, 0, n);

        // Create a fresh event with these params.
        uint64 fStart    = uint64(block.timestamp + 1);
        uint64 fDeadline = uint64(block.timestamp + 2);

        vm.prank(organizer);
        uint256 eid = showup.createEvent(
            "Fuzz Event",
            deposit,
            uint32(n),
            fStart,
            fDeadline
        );

        // Create n actors, mint/approve, and RSVP them.
        address[] memory actors = new address[](n);
        for (uint256 i = 0; i < n; ++i) {
            actors[i] = address(uint160(0xBEEF0000 + i));
            usdc.mint(actors[i], deposit);
            vm.prank(actors[i]);
            usdc.approve(address(showup), type(uint256).max);
            vm.prank(actors[i]);
            showup.rsvp(eid);
        }

        uint256 totalHeld = deposit * n;

        // Check in first k actors.
        vm.warp(fStart);
        for (uint256 i = 0; i < k; ++i) {
            vm.prank(organizer);
            showup.checkIn(eid, actors[i]);
        }

        // Move past deadline and compute sum of claimed payouts.
        vm.warp(fDeadline + 1);

        uint256 totalClaimed;
        for (uint256 i = 0; i < n; ++i) {
            uint256 p = showup.payoutFor(eid, actors[i]);
            if (p > 0) {
                vm.prank(actors[i]);
                showup.claim(eid);
                totalClaimed += p;
            }
        }

        assertLe(totalClaimed, totalHeld, "Claimed more than held");
    }
}
