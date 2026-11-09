# Mkopo wa Ripa Chache — Live Telegram Approval Workflow

Customer journey:
1. Anniversary introduction screen.
2. Loan amount and repayment-term selection, with live repayment estimate.
3. Customer enters a contact phone number and submits the application.
4. The application is saved in PostgreSQL and sent to the assigned Telegram administrator.
5. The customer remains on the waiting screen until the administrator chooses APPROVE or REJECT.
6. The customer's page updates automatically with the decision.

## Render
Build command: `npm install`
Start command: `npm start`

## Required environment variables
- `DATABASE_URL` — PostgreSQL connection string
- `TELEGRAM_BOT_TOKEN` — Telegram bot token
- `TELEGRAM_ADMIN_IDS` — comma-separated Telegram administrator IDs
- `TELEGRAM_SUPER_ADMIN_IDS` — super administrator IDs
- `APP_BASE_URL` — deployed site URL
- `TELEGRAM_BOT_USERNAME` — bot username without @

Other loan settings are configurable in Render:
- `INTEREST_RATE` (default 5 percent per month)
- `MIN_LOAN_AMOUNT` (default TSh 50,000)
- `MAX_LOAN_AMOUNT` (default TSh 5,000,000)
- `DEFAULT_TERM_MONTHS` (default 3)
- `DEFAULT_LOAN_AMOUNT` (default TSh 1,000,000)
- `TELEGRAM_POLLING=true` on only one live service using this bot token

The portal is operated by an independent lender and is not an official Halotel service. Confirm the lender's legal authority, disclose all interest/fees and repayment terms, and obtain customer consent before processing a real loan. Never request or collect mobile-money PINs or OTPs.
