# Africell Easy Loan Demo demo with Telegram review

This is a demo portal and is not affiliated with Africell or any mobile operator. It does not issue loans or verify identity with a mobile operator.

## Setup
1. Install Node.js 18 or newer.
2. Run `npm install`.
3. Copy `.env.example` to `.env` and set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_ADMIN_CHAT_ID`.
4. Start with `npm start` after loading those environment variables.
5. In Telegram, open the bot and send `/start`. The admin chat ID must be the ID of the private admin chat or the group where the bot is allowed to post.

For deployments, set the same variables in your hosting provider's environment-variable settings. Do not commit `.env` or expose the bot token publicly.

## Approval flow
- Step 1 remains on the details page until an admin presses Approve in Telegram. Reject leaves the user on Step 1 to correct and resubmit.
- Step 2 remains on the reference page until an admin presses Approve. Reject clears the field and allows a retry.
- Telegram notifications contain the application reference and application details. The 6-digit value entered in Step 2 is validated but is not stored or sent to Telegram. Never enter PINs, passwords, or SMS/OTP codes.
- Demo applications are stored in memory, so they reset when the server restarts. Use a database and authentication for production.


## Super-admin Telegram controls
Set `TELEGRAM_SUPER_ADMIN_CHAT_ID` to the private Telegram chat ID authorized to manage admins. If omitted, the existing `TELEGRAM_ADMIN_CHAT_ID` is used as super admin. Set `BASE_URL` to the deployed demo URL. Restart the server after changing environment variables.

Commands (super-admin only):
- `/addadmin Name` — creates the next numbered admin and a unique personal application link.
- `/admins` — lists admins, status, connection status and personal links.
- `/revoke NUMBER` — disables an admin.
- `/restore NUMBER` — restores a revoked admin.
- `/link NUMBER` — shows the personal link again.
- `/broadcast MESSAGE` — sends a message to all connected active admins.
- `/notify MESSAGE` — sends a super-admin notification test.

Admin onboarding: the admin opens the bot and sends `/start` to receive their Telegram Chat ID. They send that Chat ID to the Super Admin. The Super Admin runs `/addadmin CHAT_ID`; the admin is immediately activated and the bot sends their personal customer link directly to that Telegram account. The admin can use `/mylink` at any time to retrieve the link again. Admin records are stored in `admins.json`; back up this file. This demo uses local JSON/in-memory storage and should be upgraded to a database plus authenticated admin onboarding before production use.

## Telegram notification troubleshooting
- Set `TELEGRAM_BOT_TOKEN` and `TELEGRAM_SUPER_ADMIN_CHAT_ID` in the host's environment variables (not just in a local file if hosted elsewhere).
- Open the bot in Telegram and press **Start** from the super-admin account before testing.
- Restart/redeploy after changing environment variables. Check server logs for `Telegram startup error`, `Telegram polling error`, or `Telegram callback error`.
- `/api/health` reports whether Telegram variables are present; it does not guarantee the token is valid.
- This version clears an existing webhook (without dropping queued updates) before enabling Telegram long polling. Do not run multiple copies of this bot against the same token at once.
- Use `/notify Test notification` in the bot to verify super-admin delivery.
