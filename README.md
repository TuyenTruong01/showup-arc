# ShowUp

ShowUp fixes the "free meetup no-show" problem: attendees lock a small USDC deposit to RSVP. If they show up (the organizer checks them in), they get it back plus a proportional share of the no-shows' forfeited deposits. If nobody shows, everyone gets a full refund. The organizer never touches the money.

Built with [Arc Studio](https://studio.arc.io)

## Tech Stack

- **Frontend:** React 18, Vite, TypeScript, Tailwind CSS
- **Blockchain:** wagmi v2, viem v2, ConnectKit
- **Contracts:** Solidity 0.8.28 + Foundry + OpenZeppelin 5.6.1
- **Chain:** Arc Mainnet (Chain ID 5042) and Arc Testnet (Chain ID 5042002) — USDC is the native gas token
- **Token:** USDC (ERC-20) at `0x3600000000000000000000000000000000000000`

## Features

- Create a meetup event with a USDC deposit requirement, capacity, start time, and check-in deadline
- RSVP by locking the exact deposit via ERC-20 approve + contract pull
- Cancel your RSVP before the event starts for a full refund
- Organizer checks in attendees after the event starts (before the check-in deadline)
- After the deadline, checked-in attendees claim deposit + their share of forfeited deposits
- If nobody was checked in, every RSVPed address claims a full refund
- No admin functions — the organizer cannot withdraw or touch deposited funds

## Prerequisites

- Node.js 18+ / Bun
- A wallet (MetaMask or any injected EVM wallet)
- Arc Mainnet: a wallet funded with USDC (for gas and deposits)
- Arc Testnet: use the "Get test USDC" button in Arc Studio's sidebar

## Development

```bash
bun install
bun run dev        # Start the Vite dev server (port 5173)
```

## Contracts

```bash
bun run contracts:build    # forge build
bun run contracts:test     # forge test (47 unit tests)
```

## Environment Variables

None required for running locally. The contract address and chain facts are baked in from Arc Studio's registry.

## Deployed Contracts

| Contract | Network      | Address | Explorer |
|----------|--------------|---------|----------|
| ShowUp   | Arc Mainnet  | `0x10c540AA3925CF05aAfA3c65E76Bad6eE5e5d31C` | [explorer.arc.io](https://explorer.arc.io/address/0x10c540AA3925CF05aAfA3c65E76Bad6eE5e5d31C) |
| ShowUp   | Arc Testnet  | `0xde1d55d2fffd968f77f32a1b2450f437c382545a` | [explorer.testnet.arc.io](https://explorer.testnet.arc.io/address/0xde1d55d2fffd968f77f32a1b2450f437c382545a) |
