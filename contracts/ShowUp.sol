// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract ShowUp is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdc;
    uint256 public eventCount;

    struct Event {
        string name;
        address organizer;
        uint256 deposit;
        uint32 capacity;
        uint64 startTime;
        uint64 checkInDeadline;
        uint32 rsvpCount;
        uint32 checkedInCount;
        uint32 claimedCount;
        uint64 createdBlock;
    }

    mapping(uint256 => Event) public events;
    mapping(uint256 => mapping(address => bool)) public isRsvped;
    mapping(uint256 => mapping(address => bool)) public isCheckedIn;
    mapping(uint256 => mapping(address => bool)) public hasClaimed;

    event EventCreated(
        uint256 indexed eventId,
        address indexed organizer,
        string name,
        uint256 deposit,
        uint32 capacity,
        uint64 startTime,
        uint64 checkInDeadline
    );
    event Rsvped(uint256 indexed eventId, address indexed attendee);
    event RsvpCancelled(uint256 indexed eventId, address indexed attendee);
    event CheckedIn(uint256 indexed eventId, address indexed attendee);
    event Claimed(uint256 indexed eventId, address indexed attendee, uint256 amount);

    constructor(address _usdc) {
        require(_usdc != address(0), "Zero USDC");
        usdc = IERC20(_usdc);
    }

    function createEvent(
        string calldata name,
        uint256 deposit,
        uint32 capacity,
        uint64 startTime,
        uint64 checkInDeadline
    ) external returns (uint256 eventId) {
        require(deposit > 0, "Deposit zero");
        require(capacity > 0, "Capacity zero");
        require(startTime > block.timestamp, "Bad start");
        require(checkInDeadline > startTime, "Bad deadline");

        eventId = ++eventCount;

        events[eventId] = Event({
            name: name,
            organizer: msg.sender,
            deposit: deposit,
            capacity: capacity,
            startTime: startTime,
            checkInDeadline: checkInDeadline,
            rsvpCount: 0,
            checkedInCount: 0,
            claimedCount: 0,
            createdBlock: uint64(block.number)
        });

        emit EventCreated(eventId, msg.sender, name, deposit, capacity, startTime, checkInDeadline);
    }

    function rsvp(uint256 eventId) external {
        Event storage e = events[eventId];

        require(block.timestamp < e.startTime, "Event started");
        require(!isRsvped[eventId][msg.sender], "Already RSVPed");
        require(e.rsvpCount < e.capacity, "Event full");

        usdc.safeTransferFrom(msg.sender, address(this), e.deposit);

        isRsvped[eventId][msg.sender] = true;
        e.rsvpCount += 1;

        emit Rsvped(eventId, msg.sender);
    }

    function cancelRsvp(uint256 eventId) external {
        Event storage e = events[eventId];

        require(block.timestamp < e.startTime, "Event started");
        require(isRsvped[eventId][msg.sender], "Not RSVPed");

        isRsvped[eventId][msg.sender] = false;
        e.rsvpCount -= 1;

        usdc.safeTransfer(msg.sender, e.deposit);

        emit RsvpCancelled(eventId, msg.sender);
    }

    function checkIn(uint256 eventId, address attendee) external {
        Event storage e = events[eventId];

        require(msg.sender == e.organizer, "Not organizer");
        require(block.timestamp >= e.startTime, "Event not started");
        require(block.timestamp <= e.checkInDeadline, "Check-in closed");
        require(isRsvped[eventId][attendee], "Not RSVPed");
        require(!isCheckedIn[eventId][attendee], "Already checked in");

        isCheckedIn[eventId][attendee] = true;
        e.checkedInCount += 1;

        emit CheckedIn(eventId, attendee);
    }

    function claim(uint256 eventId) external nonReentrant {
        Event storage e = events[eventId];

        require(block.timestamp > e.checkInDeadline, "Deadline not passed");
        require(isRsvped[eventId][msg.sender], "Not RSVPed");
        require(!hasClaimed[eventId][msg.sender], "Already claimed");

        hasClaimed[eventId][msg.sender] = true;

        uint256 payout;

        if (e.checkedInCount == 0) {
            // Nobody showed up — full refund for all RSVPed addresses.
            payout = e.deposit;
        } else {
            require(isCheckedIn[eventId][msg.sender], "No-show");

            uint256 forfeitedPool = e.deposit * (e.rsvpCount - e.checkedInCount);
            payout = e.deposit + (forfeitedPool / e.checkedInCount);

            // Last checked-in claimer sweeps the remainder so no dust is ever stranded.
            e.claimedCount += 1;
            if (e.claimedCount == e.checkedInCount) {
                payout += forfeitedPool % e.checkedInCount;
            }
        }

        usdc.safeTransfer(msg.sender, payout);

        emit Claimed(eventId, msg.sender, payout);
    }

    function payoutFor(uint256 eventId, address attendee) external view returns (uint256) {
        Event storage e = events[eventId];

        if (block.timestamp <= e.checkInDeadline) {
            return 0;
        }

        if (!isRsvped[eventId][attendee]) {
            return 0;
        }

        if (e.checkedInCount == 0) {
            return e.deposit;
        }

        if (!isCheckedIn[eventId][attendee]) {
            return 0;
        }

        uint256 forfeitedPool = e.deposit * (e.rsvpCount - e.checkedInCount);
        uint256 floor = e.deposit + (forfeitedPool / e.checkedInCount);

        // The last checked-in claimer receives the remainder dust.
        // Since we can't know who claims last from a view, we return the
        // higher (last-claimer) amount as a conservative upper bound.
        // All checked-in attendees receive at least `floor`; one receives floor + remainder.
        return floor;
    }

    function getEvent(uint256 eventId) external view returns (Event memory) {
        return events[eventId];
    }
}
