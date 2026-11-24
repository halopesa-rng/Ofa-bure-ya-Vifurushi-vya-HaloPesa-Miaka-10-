# Africell Easy Loan — Independent Application Demo

A mobile-friendly, independent application-inquiry demo styled for an Africell Gambia concept. It is not an official Africell product, is not endorsed by Africell, and does not issue real loans or funds. Do not use official branding without authorization.

## Customer flow
1. Enter a name and mobile number.
2. Select an amount from GMD D5,000 to D1,000,000 in D5,000 increments.
3. Choose a repayment period and submit the inquiry.
4. The system generates and displays a six-digit application tracking reference automatically.
5. An assigned Telegram administrator receives the application and can approve or reject the inquiry.

The six-digit value is an application reference only. It is not an OTP, PIN, password, or mobile-money verification code. The customer form does not request transaction SMS messages, PINs, passwords, or OTPs.

## Run
```bash
npm install
cp .env.example .env
npm start
```

Configure PostgreSQL and Telegram administrator credentials using environment variables. Demo mode is for local testing only.

## Admin personal-link subscriptions
- Super Admin verifies the admin's payment, then credits it in Telegram with `/credit TELEGRAM_ID AMOUNT`.
- Subscription rate: KSh 1,000 adds 30 days; other positive amounts are prorated proportionally.
- Further credits extend from the later of the current expiry or the current time.
- `/admins` shows each admin's credited total and expiry; `/subscription` shows an admin's own status.
- Expired subscriptions block `/mylink`, Telegram customer-link access, and new applications submitted through that personal link.
