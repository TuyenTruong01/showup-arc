// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ShowUpTestBase} from "./ShowUp.Base.t.sol";
import {ShowUp} from "../ShowUp.sol";

/// @dev Covers: full 3-RSVP/2-checkin flow, nobody-checked-in full refund, cancelRsvp.
contract ShowUpFlowTest is ShowUpTestBase {

    // ── Scenario 1: 3 RSVPs, 2 checked in, 1 no-show ─────────────────────────

    /// @dev Each checked-in attendee receives deposit + forfeitedPool/checkedInCount.
    function test_FullFlow_CheckedInAttendeeReceivesCorrectPayout() public {
        // Setup: all 3 RSVP.
        _rsvpAll(_arr(alice, bob, carol));

        // Check in alice and bob only.
        _checkInAll(_arr(alice, bob));

        // Advance past check-in deadline.
        _passDeadline();

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore   = usdc.balanceOf(bob);

        // forfeitedPool = DEPOSIT * (3 - 2) = 10e6
        // each payout   = 10e6 + 10e6 / 2  = 15e6
        uint256 expectedPayout = DEPOSIT + DEPOSIT / 2;

        vm.prank(alice);
        showup.claim(eventId);

        vm.prank(bob);
        showup.claim(eventId);

        assertEq(usdc.balanceOf(alice), aliceBefore + expectedPayout);
        assertEq(usdc.balanceOf(bob),   bobBefore   + expectedPayout);
    }

    /// @dev Contract USDC balance after both claims equals leftover for carol's forfeit.
    function test_FullFlow_ContractBalanceAfterClaims() public {
        _rsvpAll(_arr(alice, bob, carol));
        _checkInAll(_arr(alice, bob));
        _passDeadline();

        vm.prank(alice); showup.claim(eventId);
        vm.prank(bob);   showup.claim(eventId);

        // carol forfeited DEPOSIT; 2 checked-in each got DEPOSIT/2 of it.
        // Remaining = carol's deposit - DEPOSIT/2 - DEPOSIT/2 (integer division).
        // With DEPOSIT = 10e6: forfeitedPool/2 = 5e6 each, total paid out = 10e6 exactly.
        // So remaining = 0 (exact division).
        uint256 remaining = usdc.balanceOf(address(showup));
        // All forfeited funds distributed — remaining is the unclaimable dust from int div.
        uint256 dust = DEPOSIT * 1 - (DEPOSIT / 2) * 2; // = 10e6 - 5e6 * 2 = 0
        assertEq(remaining, dust);
    }

    /// @dev No-show (carol) cannot claim when checkedInCount > 0.
    function test_FullFlow_NoShowClaimReverts() public {
        _rsvpAll(_arr(alice, bob, carol));
        _checkInAll(_arr(alice, bob));
        _passDeadline();

        vm.prank(carol);
        vm.expectRevert(bytes("No-show"));
        showup.claim(eventId);
    }

    // ── Scenario 2: nobody checked in → all RSVPed get full deposit refund ────

    function test_NobodyCheckedIn_AliceGetsFullDeposit() public {
        _rsvpAll(_arr(alice, bob, carol));
        _passDeadline(); // skip check-in period entirely

        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        showup.claim(eventId);
        assertEq(usdc.balanceOf(alice), balBefore + DEPOSIT);
    }

    function test_NobodyCheckedIn_AllThreeGetFullRefund() public {
        _rsvpAll(_arr(alice, bob, carol));
        _passDeadline();

        address[3] memory attendees = [alice, bob, carol];
        for (uint256 i; i < 3; ++i) {
            uint256 balBefore = usdc.balanceOf(attendees[i]);
            vm.prank(attendees[i]);
            showup.claim(eventId);
            assertEq(usdc.balanceOf(attendees[i]), balBefore + DEPOSIT, "wrong refund");
        }
        // Contract balance drained to 0.
        assertEq(usdc.balanceOf(address(showup)), 0);
    }

    // ── Scenario 3: cancelRsvp ─────────────────────────────────────────────────

    /// @dev Cancel before startTime returns deposit and decrements rsvpCount.
    function test_CancelRsvp_BeforeStart_RefundsAndDecrements() public {
        _rsvpAll(_arr(alice, bob));
        uint256 balBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        showup.cancelRsvp(eventId);

        // Balance restored.
        assertEq(usdc.balanceOf(alice), balBefore + DEPOSIT);

        // isRsvped cleared.
        assertEq(showup.isRsvped(eventId, alice), false);

        // rsvpCount decremented.
        ShowUp.Event memory e = showup.getEvent(eventId);
        assertEq(e.rsvpCount, 1); // bob still in
    }

    /// @dev cancelRsvp after startTime reverts.
    function test_CancelRsvp_AfterStart_Reverts() public {
        _rsvpAll(_arr(alice));
        vm.warp(START); // at startTime (block.timestamp == startTime)

        vm.prank(alice);
        vm.expectRevert(bytes("Event started"));
        showup.cancelRsvp(eventId);
    }

    /// @dev cancelRsvp when not RSVPed reverts.
    function test_CancelRsvp_NotRsvped_Reverts() public {
        vm.prank(alice);
        vm.expectRevert(bytes("Not RSVPed"));
        showup.cancelRsvp(eventId);
    }

    // ── rsvp: happy-path state changes ───────────────────────────────────────

    function test_Rsvp_TransfersDepositToContract() public {
        uint256 balBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        showup.rsvp(eventId);
        assertEq(usdc.balanceOf(alice),            balBefore - DEPOSIT);
        assertEq(usdc.balanceOf(address(showup)),  DEPOSIT);
        assertEq(showup.isRsvped(eventId, alice),  true);
        ShowUp.Event memory e = showup.getEvent(eventId);
        assertEq(e.rsvpCount, 1);
    }

    // ── checkIn: happy-path state changes ────────────────────────────────────

    function test_CheckIn_UpdatesState() public {
        _rsvpAll(_arr(alice));
        vm.warp(START);
        vm.prank(organizer);
        showup.checkIn(eventId, alice);

        assertEq(showup.isCheckedIn(eventId, alice), true);
        ShowUp.Event memory e = showup.getEvent(eventId);
        assertEq(e.checkedInCount, 1);
    }

    // ── claim: claimedCount increments ────────────────────────────────────────

    function test_Claim_IncrementsClaimedCount() public {
        _rsvpAll(_arr(alice, bob));
        _checkInAll(_arr(alice, bob));
        _passDeadline();

        // Before any claim, claimedCount == 0.
        ShowUp.Event memory before = showup.getEvent(eventId);
        assertEq(before.claimedCount, 0);

        vm.prank(alice);
        showup.claim(eventId);

        // After alice claims, claimedCount == 1.
        ShowUp.Event memory mid = showup.getEvent(eventId);
        assertEq(mid.claimedCount, 1);

        vm.prank(bob);
        showup.claim(eventId);

        // After bob (last checked-in claimer) claims, claimedCount == checkedInCount == 2.
        ShowUp.Event memory fin = showup.getEvent(eventId);
        assertEq(fin.claimedCount, 2);
    }

    function test_Claim_LastClaimerSweepsDust() public {
        // Need a deposit where forfeitedPool % checkedInCount != 0.
        // 3 RSVPs, 2 checked in → forfeitedPool = deposit * 1 = deposit.
        // Choose deposit = 7_000_001 (odd): 7_000_001 % 2 = 1, so dust = 1.
        uint256 oddDeposit = 7_000_001;
        usdc.mint(alice, oddDeposit);
        usdc.mint(bob,   oddDeposit);
        usdc.mint(carol, oddDeposit);
        // approvals already set to max in setUp

        vm.prank(organizer);
        uint256 eid = showup.createEvent("OddEvent", oddDeposit, 3, START, DEADLINE);

        vm.prank(alice); showup.rsvp(eid);
        vm.prank(bob);   showup.rsvp(eid);
        vm.prank(carol); showup.rsvp(eid);

        // Check in alice and bob (carol is no-show).
        vm.warp(START);
        vm.prank(organizer); showup.checkIn(eid, alice);
        vm.prank(organizer); showup.checkIn(eid, bob);
        _passDeadline();

        // forfeitedPool = 7_000_001 * 1 = 7_000_001
        // floor = 7_000_001 + 7_000_001 / 2 = 7_000_001 + 3_500_000 = 10_500_001
        // dust  = 7_000_001 % 2 = 1
        uint256 floor = oddDeposit + oddDeposit / 2; // 10_500_001
        uint256 dust  = oddDeposit % 2;               // 1

        uint256 aliceBefore = usdc.balanceOf(alice);
        uint256 bobBefore   = usdc.balanceOf(bob);

        vm.prank(alice); showup.claim(eid);  // first claimer gets floor
        vm.prank(bob);   showup.claim(eid);  // last claimer (claimedCount == checkedInCount) gets floor + dust

        uint256 aliceGot = usdc.balanceOf(alice) - aliceBefore;
        uint256 bobGot   = usdc.balanceOf(bob)   - bobBefore;

        assertEq(aliceGot, floor,        "alice should get floor");
        assertEq(bobGot,   floor + dust, "bob (last) should get floor + dust");

        // 3 * oddDeposit paid in; alice + bob claimed everything (carol forfeited to them).
        assertEq(usdc.balanceOf(address(showup)), 0, "contract drained to 0");
    }
}
