# ShowUp — Project Memory (updated)

> Built with Arc Studio — money-powered apps in minutes

## What This App Does

ShowUp is a USDC RSVP deposit app for community meetups. Attendees lock a small USDC deposit to RSVP. If they show up (organizer checks them in), they get it back plus a share of the no-shows' deposits. If nobody shows, everyone gets a full refund. The organizer cannot touch the deposited funds.

## Tech Stack

- Frontend: React 18, Vite, TypeScript, Tailwind CSS (Arc Light theme)
- Web3: wagmi v2, viem v2, ConnectKit
- Contracts: Solidity 0.8.28 + Foundry + OpenZeppelin 5.6.1
- Chain: Arc Testnet (Chain ID: 5042002)
- Token: USDC (ERC-20, 6 decimals, 0x3600000000000000000000000000000000000000)
- Toasts: Sonner

## Contract Deployments

| Contract       | Network      | Address                                    | Deploy Block | Explorer |
|----------------|--------------|--------------------------------------------|--------------|----------|
| ShowUp (live)  | Arc Mainnet  | 0x10c540AA3925CF05aAfA3c65E76Bad6eE5e5d31C | 27825276     | https://explorer.arc.io/address/0x10c540AA3925CF05aAfA3c65E76Bad6eE5e5d31C |
| ShowUp v2      | Arc Testnet  | 0xde1d55d2fffd968f77f32a1b2450f437c382545a | 69053559     | https://explorer.testnet.arc.io/address/0xde1d55d2fffd968f77f32a1b2450f437c382545a |
| ShowUp v1      | Arc Testnet  | 0xd626824a81fabc8128fb657f59318af7e442f548 | 69050221     | (superseded) |

Deploy tx (mainnet): 0x92100c5b698b1c1a2b6432da3a436d1fd988acbfb4970238588d54374c049a43
Deployer: 0x5C73D6297A7447D3412a1B1f9b5B3d9746DfBD81
USDC constructor arg (both chains): 0x3600000000000000000000000000000000000000
v2 adds `createdBlock` to the Event struct (AttendeeList scans from event creation block, not contract deploy block).

## Key Files

- `src/App.tsx` — Main app shell (event list + routing)
- `src/components/CreateEventSheet.tsx` — Bottom sheet for creating events
- `src/components/EventCard.tsx` — Card component for event list
- `src/components/EventDetail.tsx` — Full event view with RSVP/cancel/check-in/claim actions
- `src/showup-contract.ts` — Contract address + ABI config
- `contracts/ShowUp.sol` — Main contract
- `contracts/test/` — Foundry unit tests (47 passing)
- `contracts/test-helpers/MockERC20.sol` — Mock USDC for tests
- `contracts/contract-metadata/ShowUp.json` — Deployment metadata

## Security Notes

- checkIn requires block.timestamp >= startTime (prevents pre-start check-in + RSVP cancel state drift)
- Last checked-in claimer sweeps forfeiture dust (no permanently stranded funds)
- Organizer has no withdraw function; rounding goes to last claimer
- Known trust assumption: organizer controls check-in, so a malicious organizer could selectively deny attendees — document in UX

## To Run

```bash
bun install
bun run dev
```

## To Test Contracts

```bash
bun run contracts:test
```

## To Build Contracts

```bash
bun run contracts:build
```
