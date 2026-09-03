import cron from 'node-cron';
import { query } from './db';
import { sendMessage } from './telegram';

let started = false;

export function startScheduler() {
  if (started) return;
  if (!process.env.TELEGRAM_BOT_TOKEN) return;
  started = true;

  // 9:00 PM Venezuela time (UTC-4)
  cron.schedule('0 21 * * *', async () => {
    try {
      const r = await query("SELECT id, name, telegram_chat_id FROM app_users WHERE telegram_chat_id IS NOT NULL");
      for (const u of r.rows) {
        const today = new Date().toISOString().slice(0, 10);
        const tx = await query(
          `SELECT COUNT(*)::int AS n FROM transactions WHERE payer_id=$1 AND transaction_date::date = $2::date`,
          [u.id, today]
        );
        const text = tx.rows[0].n === 0
          ? `🌙 <b>Cierre de jornada</b>\n\nHola ${u.name}, no registraste ningún gasto hoy. ¿Hubo algo? Escribe algo como <code>30$ cena #Nos J</code> o envía una captura del Pago Móvil ✅`
          : `🌙 <b>Cierre de jornada</b>\n\n${u.name}, hoy registraste <b>${tx.rows[0].n}</b> gasto(s). ¿Falta alguno? Envíalo por aquí antes de dormir 🙏`;
        try { await sendMessage(u.telegram_chat_id, text); } catch (e) { console.error('daily reminder to', u.name, e.message); }
      }
    } catch (e) { console.error('scheduler tick error', e.message); }
  }, { timezone: 'America/Caracas' });

  console.log('[scheduler] started (9pm America/Caracas daily reminder)');
}
