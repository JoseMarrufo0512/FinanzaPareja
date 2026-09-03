const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const API = TOKEN ? `https://api.telegram.org/bot${TOKEN}` : null;

export async function tg(method, body) {
  if (!API) throw new Error('TELEGRAM_BOT_TOKEN missing');
  const r = await fetch(`${API}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const j = await r.json();
  if (!j.ok) throw new Error(j.description || 'Telegram error');
  return j.result;
}

export async function sendMessage(chatId, text, extra = {}) {
  try { return await tg('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML', ...extra }); }
  catch (e) { console.error('sendMessage', chatId, e.message); return null; }
}

export async function answerCallback(id, text) {
  try { return await tg('answerCallbackQuery', { callback_query_id: id, text }); }
  catch (e) { console.error('answerCallback', e.message); return null; }
}

export async function editMessage(chatId, messageId, text, extra = {}) {
  return tg('editMessageText', { chat_id: chatId, message_id: messageId, text, parse_mode: 'HTML', ...extra });
}

export async function downloadFile(fileId) {
  const f = await tg('getFile', { file_id: fileId });
  const url = `https://api.telegram.org/file/bot${TOKEN}/${f.file_path}`;
  const r = await fetch(url);
  if (!r.ok) throw new Error('download failed');
  return { buffer: Buffer.from(await r.arrayBuffer()), path: f.file_path };
}

export async function setWebhook(url, secret) {
  return tg('setWebhook', {
    url, secret_token: secret, drop_pending_updates: true,
    allowed_updates: ['message', 'callback_query'],
  });
}

export async function getWebhookInfo() { return tg('getWebhookInfo', {}); }
