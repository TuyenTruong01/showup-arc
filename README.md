# ShowUp — USDC RSVP deposits for meetups

Free meetups routinely lose a big share of RSVPs to no-shows, so organizers over-book, order too much food, or turn people away. ShowUp makes an RSVP cost something only if you skip it: attendees lock a small USDC deposit to RSVP. Show up and you get it back plus a share of the no-shows' deposits. Don't show up and your deposit goes to the people who came. The organizer never touches the money.

Built end to end with [Arc Studio](https://studio.arc.io) and live on **Arc Mainnet**.

| | |
|---|---|
| Live app | https://arc-studio-7b23e623a7c3470a96cb2c37.vercel.app/ |
| Contract (Arc Mainnet, chain 5042) | [`0x10c540AA3925CF05aAfA3c65E76Bad6eE5e5d31C`](https://explorer.arc.io/address/0x10c540AA3925CF05aAfA3c65E76Bad6eE5e5d31C) |
| Arc Studio project | https://studio.arc.io/app/7b23e623-a7c3-470a-96cb-2c37ec4e1d88 |
| Example claim (0.15 USDC paid out) | [`0x8fc676e6…aab230b`](https://explorer.arc.io/tx/0x8fc676e63f1b2373f734acf8ede020f4c5ff3ffa8ced3154db1271cb9aab230b) |

## How it works

1. **Organizer creates an event:** name, deposit (e.g. 0.1 USDC), seats, "RSVP closes & doors open" time, "check-in closes" time.
2. **Attendees RSVP:** approve the exact deposit, then `rsvp()` pulls it into the contract. They can cancel for a full refund until doors open.
3. **At the door:** the attendee taps **Show my ticket**, signs a gasless message, and shows a QR code valid for 60 seconds. The organizer scans it; the app checks the signature, event, chain, contract and freshness, then calls `checkIn()`.
4. **After check-in closes:** every checked-in attendee calls `claim()` and receives `deposit + (no-show deposits ÷ attendees)`. If nobody was checked in, everyone gets a full refund.

## Try it (judges)

Arc Mainnet uses USDC for gas. Each wallet needs about 0.2 USDC for a 0.1 USDC deposit.

1. Open the live app, connect a wallet (Rabby or MetaMask), make sure the network chip says **Arc** → you see the event list read from the mainnet contract.
2. Click **Create event**, set deposit `0.1`, seats `3`, doors open in 8 minutes, check-in closes 5 minutes later → the event appears with a countdown.
3. From 2–3 wallets, open the event and click **RSVP — lock 0.1 USDC** → seats fill up, the attendee list updates.
4. When doors open, switch to the organizer wallet → the **Check in attendees** panel appears. Scan a ticket QR (phone + webcam) or paste an address in **Manual** → "2 / 3 checked in", payout preview shows 0.15 USDC.
5. After check-in closes, claim from each checked-in wallet → **You received 0.15 USDC** with an explorer link. The no-show wallet sees **You didn't check in**.

## Proof on Arc Mainnet

Three real events were run on 26 Oct 2026 with 0.1 USDC deposits (9 deposits in, 9 deposits out, contract balance back to 0):

| Event | RSVPs | Checked in | Payout per attendee |
|---|---|---|---|
| Builder Meetup | 3 | 1 | 0.30 USDC |
| Builder Meetup 2 | 3 | 2 | 0.15 USDC |
| Builder Meetup 3 | 3 | 2 | 0.15 USDC |

Full flow of **Builder Meetup 3** (event id 3):

| Step | Transaction |
|---|---|
| Deploy contract | [`0x92100c5b…4c049a43`](https://explorer.arc.io/tx/0x92100c5b698b1c1a2b6432da3a436d1fd988acbfb4970238588d54374c049a43) |
| Create event | [`0x70912171…e13449d4`](https://explorer.arc.io/tx/0x70912171ddaee86b15a3469575018f9284f97c60294b80670168cfd4e13449d4) |
| RSVP wallet 1 | [`0x2f585538…05373854`](https://explorer.arc.io/tx/0x2f585538f48d98a19bd75abf3c0d8f3d95514a6f918172ca1244fbf505373854) |
| RSVP wallet 2 | [`0x5dd2e0d6…5f7927be`](https://explorer.arc.io/tx/0x5dd2e0d6eecc6415449141171bd6623d925e42dba61873c6e48991848f7927be) |
| RSVP wallet 3 (no-show) | [`0xbef21c08…95f4a027`](https://explorer.arc.io/tx/0xbef21c0823b931021a65a28db1de9f90e2f292a8efb1f5c30e1969b195f4a027) |
| Check in wallet 1 | [`0x2c0ea83e…66470625`](https://explorer.arc.io/tx/0x2c0ea83e94d90f8f09a1b4acc1241df96b597b83ea7fff557e8f002066470625) |
| Check in wallet 2 | [`0x0f74e8f2…91d34ea2`](https://explorer.arc.io/tx/0x0f74e8f296b2a33bc4639d4fbdf2f6a42f6bd22e7a95325995b56a9291d34ea2) |
| Claim wallet 1 (0.15 USDC) | [`0x513d32be…3b03cb0`](https://explorer.arc.io/tx/0x513d32be611b7fbf7ac4717acb7a4413acf18d13aff3c29ae2b6985f83b03cb0) |
| Claim wallet 2 (0.15 USDC) | [`0x8fc676e6…aab230b`](https://explorer.arc.io/tx/0x8fc676e63f1b2373f734acf8ede020f4c5ff3ffa8ced3154db1271cb9aab230b) |

## How Arc Studio was used

- **Contract:** described the deposit/check-in/claim rules in plain English; Arc Studio wrote `contracts/ShowUp.sol` (OpenZeppelin SafeERC20 + ReentrancyGuard).
- **Testing:** Arc Studio wrote and ran 47 Foundry tests, including fuzzing and two invariant suites (128,000 random calls each) proving the contract always holds enough USDC to pay what it owes. It ran its built-in Solidity and functional audits.
- **App:** Arc Studio built the React app (event list, QR tickets with signatures, camera scanner, attendee list, live payout preview) and iterated on it across several rounds.
- **Testnet:** the full 3-wallet flow was tested in Arc Studio's Preview on Arc Testnet before mainnet.
- **Mainnet:** Arc Studio produced the `forge create` deploy; the deployed bytecode matches this repo's build byte for byte (only the immutable USDC address differs). The app was deployed to Vercel from Arc Studio's Integrations.

## Contract

`contracts/ShowUp.sol` · Solidity 0.8.28 · USDC ERC-20 interface `0x3600000000000000000000000000000000000000` (6 decimals)

| Function | Who | When |
|---|---|---|
| `createEvent(name, deposit, capacity, startTime, checkInDeadline)` | anyone (becomes organizer) | any time |
| `rsvp(eventId)` / `cancelRsvp(eventId)` | attendee | before `startTime` |
| `checkIn(eventId, attendee)` | organizer only | `startTime` → `checkInDeadline` |
| `claim(eventId)` | RSVPed attendee | after `checkInDeadline`, once |

- No admin, owner or withdraw function. The organizer cannot move deposits.
- Nobody checked in → every RSVP gets a full refund (protects attendees from an organizer who never shows).
- Rounding remainder goes to the last checked-in claimer, so no dust is stranded.

**Verify the bytecode yourself:**

```bash
bun install
forge build
cast code 0x10c540AA3925CF05aAfA3c65E76Bad6eE5e5d31C --rpc-url https://rpc.mainnet.arc.io
```

Compare with `forge inspect contracts/ShowUp.sol:ShowUp deployedBytecode`; the only difference is the immutable USDC address.

## Known limitations

- **Check-in trusts the organizer.** An organizer could RSVP with extra wallets and check in only those. Deposits are small, the organizer cannot withdraw directly, and "nobody checked in → full refund" limits the damage. Next step: attendee co-signed check-in.
- **Tickets block old screenshots, not live forwarding.** A QR is valid for 60 seconds, so a screenshot taken earlier is rejected, but a friend could sign at home and forward it within that window.
- **Unclaimed payouts stay in the contract.** There is no claim deadline; funds wait for their owner.
- Source verification on explorer.arc.io failed with "verifier service connection" at submission time; the bytecode check above proves the deployed code.

## Run locally

```bash
bun install
bun run dev                # Vite dev server on port 5173
bun run contracts:build    # forge build
bun run contracts:test     # forge test (47 tests)
```

No environment variables are required. Contract addresses and chain settings live in `src/showup-contract.ts`.

## Tech stack

React 18, Vite, TypeScript, Tailwind CSS · wagmi v2, viem v2, ConnectKit · Solidity 0.8.28, Foundry, OpenZeppelin 5.6.1 · Arc Mainnet (5042) and Arc Testnet (5042002)

| Contract | Network | Address |
|---|---|---|
| ShowUp | Arc Mainnet | [`0x10c540AA3925CF05aAfA3c65E76Bad6eE5e5d31C`](https://explorer.arc.io/address/0x10c540AA3925CF05aAfA3c65E76Bad6eE5e5d31C) |
| ShowUp | Arc Testnet | [`0xde1d55d2fffd968f77f32a1b2450f437c382545a`](https://explorer.testnet.arc.io/address/0xde1d55d2fffd968f77f32a1b2450f437c382545a) |
