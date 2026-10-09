# AegisPay — Final Aligned Business & Functional Specification

## Status
Consolidated implementation specification for the current AegisPay prototype/testnet build.

## 1. Roles
Only two user-facing interfaces are provided:
- Client UI
- Master Admin UI

The previous Nodes and separate Admin UI concepts are retired.

## 2. Client account
Client signup creates:
- Username-based Client ID (with a stable 6-digit fallback where needed)
- Name
- Email
- Password/authentication state
- Unique referral code/link
- Referrer relationship
- Account status

Forgot Password resets the password and starts a temporary security freeze. The current app defaults this freeze to 24 hours.

## 3. Withdrawal wallet
The client links one withdrawal wallet.
Once linked, the client cannot change it.
Only Master Admin can change it.
The prototype also requires the wallet owner name to match the signup name.

## 4. Deposit
Client enters any positive USDT deposit amount; the client does not select a fixed deposit tier or see a client-side minimum, maximum, or fixed deposit fee.
The backend associates the deposit with an internal enabled tier for accounting/cycle compatibility.
The prototype is configured for TRON TESTNET only.
Transaction screenshot is mandatory.
The TXID must be available for the verification workflow.
Deposit verification is represented as:
Screenshot → TXID → receiving address → amount/status match → verified credit.

A $2 deposit fee is configured. First deposit minimum is $30; repeat deposits are at least $10.

## 5. VIP tiers
- Tier 1: $30 deposit, $5 initial cycle profit
- Tier 2: $50 deposit, $10 initial cycle profit
- Tier 3: $100 deposit, $15 initial cycle profit
- VVIP 1: $250 deposit, $40 initial cycle profit
- VVIP 2: $500 deposit, $65 initial cycle profit
- VVIP 3: $1,000 deposit, $135 initial cycle profit

Configured cycle rate is the initial profit divided by the tier gross deposit.

## 6. Shop / tasks
After verified deposit and tier selection, the client receives an internal AegisPay Shop interface inspired by modern Amazon-style shopping UX. It is not directly linked to Amazon.
- Products are filtered by the selected tier and the user's current cycle balance.
- Each assigned product/task shows a task value and task profit.
- Tasks are generated automatically; Master Admin task assignment is not required for the normal client cycle flow.
- A new Shop cycle is automatically opened whenever an active client has available balance above $0 and no existing TASKS_OPEN or WAITING_18H cycle.
- Available balance for automatic task assignment is the user's current platform balance minus any amount held for pending withdrawal, floored at $0.00.
- The automatic cycle base equals the available balance at assignment time.
- The automatic task set is built from active Shop offers available to the user's selected tier.
- The task values always sum to the full automatic cycle base.
- The cycle checkout is locked until the cart total equals the full cycle balance and Remaining Balance is exactly $0.00.
- Completing checkout marks the assigned tasks complete and moves the cycle to 18-hour settlement.
- Shop orders/tasks are retained in activity and order history.
- Automatic task assignment stops when available balance reaches $0.00.

## 7. 18-hour settlement
The completed cycle stores its cycle base.
After 18 hours, the system settles:
new amount = cycle base + cycle base × tier rate.

After settlement, the system automatically opens the next Shop cycle from the user's new available balance whenever that balance is above $0 and no active cycle exists. This is the normal compounding flow; Master Admin does not need to assign the next task set manually.

## 8. Referral
Two levels:
- Level 1: $5 after a referred client's verified first qualifying deposit
- Level 2: $2 after a second-level referred client's verified first qualifying deposit

Example:
A → B → C
B first deposit: A earns $5.
C first deposit: B earns $5 and A earns $2.

## 9. Withdrawals
Minimum withdrawal is $50.
Transfer fee is 10%:
$50 request → $5 fee → $45 net.
$100 request → $10 fee → $90 net.

Request flow:
Client submits → PENDING_APPROVAL → Telegram bot prepares internal Master Admin message → Master Admin approves/rejects → approved payout is recorded.

The prototype does not execute a live blockchain transfer.

## 10. Master Admin manual adjustments
Master Admin can search by Unique User ID and:
- Credit balance
- Reverse/deduct balance
- Freeze
- Block
- Restore normal status
- Review deposit records
- Review referral activity
- Review withdrawals
- Approve/reject withdrawals
- Change a locked withdrawal wallet
- Change platform settings

Credits and reversals are fully audited.

Manual task/offer controls may remain available to Master Admin for operational exceptions, but the normal client cycle does not depend on manual task assignment.

## 11. Liquidity settlement
For the prototype's backend accounting model, an approved withdrawal records the withdrawing user's own principal portion first. Any remaining simulated settlement requirement can be represented as internal liquidity/principal adjustment ledger entries against non-withdrawing users. This is an internal backend record and is not exposed as a separate client-side action.

## 12. AI assistant
AI handles client guidance and issue resolution:
- Deposit instructions
- Withdrawal instructions
- Referral instructions
- Shop/task explanations
- Password reset assistance
- Account status explanations
- General troubleshooting

AI has no financial approval authority.
AI cannot approve/reject withdrawals or freely edit balances.

## 13. Telegram
Clients do not receive direct Telegram access.
The bot is an internal Master Admin communication mechanism.
Client-side code never stores a Telegram bot token or Master Admin Telegram credentials.

## 14. Security
Sensitive financial operations remain server-side in a production architecture.
RLS is used for authenticated access.
Wallet linking is one-time for clients.
Withdrawal approval is Master Admin only.
Live payout execution is disabled in the prototype.

## 15. UI
Client:
Dashboard, Deposit, Shop, Referrals, Withdraw, Activity, Notifications, AI Assistant, Profile.
The client notification bell opens an in-app notifications view with unread/read state; workflow notices are rendered inside the UI rather than browser alert popups.

Master Admin:
Overview, Users, Withdrawals, Credits, Settings, Telegram.

Visual direction:
premium black + deep red + white client UI, with emerald success states, amber transaction states, gold/VVIP tier accents, and red security/rejection states.

## 16. User instructions are built into the app
Every critical workflow includes on-screen instructions:
- Deposit steps
- Screenshot/TXID requirement
- TRC20 network reminder
- Wallet locking warning
- Withdrawal minimum/fee calculation
- 18-hour cycle explanation
- Automatic task assignment explanation
- Referral bonus trigger explanation
- Password reset security freeze
- AI authority limitation
- Testnet/prototype warning

## 17. Prototype boundary
This build is a professional functional prototype/testnet foundation.
It does not execute real Mainnet USDT transfers, does not custody real funds, does not store private keys, and does not claim independent proof-of-reserves.
