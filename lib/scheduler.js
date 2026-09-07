import cron from 'node-cron';
import { query } from './db';
import { sendMessage } from './telegram';

let started = false;

// The 9pm nudge. Called by Vercel Cron in production (serverless kills any
// in-process timer) and by node-cron when running on a long-lived server.
export async function sendDailyReminders() {
  const r = await query("SELECT id, name, telegram_chat_id FROM app_users WHERE telegram_chat_id IS NOT NULL AND is_active");
  let sent = 0;
  for (const u of r.rows) {
    const today = new Date().toISOString().slice(0, 10);
    const tx = await query(
      `SELECT COUNT(*)::int AS n FROM transactions WHERE payer_id=$1 AND transaction_date::date = $2::date`,
      [u.id, today]
    );
    const text = tx.rows[0].n === 0
      ? `🌙 <b>Cierre de jornada</b>\n\nHola ${u.name}, no registraste ningún gasto hoy. ¿Hubo algo? Escribe algo como <code>30$ cena #Nos</code> o envía la foto de la factura ✅`
      : `🌙 <b>Cierre de jornada</b>\n\n${u.name}, hoy registraste <b>${tx.rows[0].n}</b> gasto(s). ¿Falta alguno? Envíalo por aquí antes de dormir 🙏`;
    try { await sendMessage(u.telegram_chat_id, text); sent++; }
    catch (e) { console.error('daily reminder to', u.name, e.message); }
  }
  return sent;
}

export function startScheduler() {
  if (started) return;
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  // On Vercel the scheduling comes from vercel.json crons, not from this process.
  if (process.env.VERCEL) return;
  started = true;

  cron.schedule('0 21 * * *', async () => {
    try { await sendDailyReminders(); }
    catch (e) { console.error('scheduler tick error', e.message); }
  }, { timezone: 'America/Caracas' });

  console.log('[scheduler] started (9pm America/Caracas daily reminder)');
}
