# MoMo Easy Loan — Independent Demo

This is an independent loan-application demonstration using a generic MoMo-inspired navy and yellow visual theme. It is not an official MTN or MoMo product, is not endorsed by MTN, and does not issue real loans or funds. Do not use official MTN/MoMo logos or represent this as an official service without written authorization.

## Customer flow
1. Enter a supported MTN Zambia mobile number and a 4–6 digit demo application reference.
2. Select a demo loan amount and repayment period.
3. Wait for administrator review.
4. Paste the transaction reference text only into Reference Code 1. It auto-submits after paste/typing pause. Do not paste a complete SMS.
5. Enter exactly four numeric digits for Reference Code 2; it auto-submits on the fourth digit.
6. Review the demo loan summary.

Never ask users for mobile-money PINs, account passwords, or financial-service OTPs. Reference fields are for non-secret transaction reference identifiers only.

## MTN Zambia number validation
Accepted local prefixes are 056, 076 and 096; international format is +260 followed by the nine-digit national number. Prefix checks do not confirm current network ownership where number portability applies.

## Run
```bash
npm install
cp .env.example .env
npm start
```

Configure PostgreSQL and Telegram admin credentials using environment variables. Demo mode is for local testing only.
