import OpenAI from 'openai';

let client;
export function getAI() {
  if (!client) {
    if (!process.env.EMERGENT_LLM_KEY) throw new Error('EMERGENT_LLM_KEY missing');
    client = new OpenAI({
      apiKey: process.env.EMERGENT_LLM_KEY,
      baseURL: 'https://integrations.emergentagent.com/llm',
    });
  }
  return client;
}

// Transcribe audio buffer to text (Spanish).
export async function transcribeAudio(buffer, filename = 'voice.ogg', mimetype = 'audio/ogg') {
  const { toFile } = await import('openai');
  const file = await toFile(buffer, filename, { type: mimetype });
  const r = await getAI().audio.transcriptions.create({
    file,
    model: 'whisper-1',
    language: 'es',
    prompt: 'Venezuela, Pago Móvil, Banesco, BDV, bolívares, Bs, USDT, dólar, referencia, comprobante, gasto, compartido, préstamo, comida, cena.',
  });
  return r.text;
}

// Suggest the best-fitting category for an expense description.
// Returns one of the provided category names, or null if unclear.
export async function suggestCategory(description, categoryNames = []) {
  if (!description || !categoryNames.length) return null;
  const sys = `Eres un clasificador de gastos para una app de finanzas de pareja en Venezuela.
Dada una descripción de un gasto, elige la MEJOR categoría de esta lista exacta:
${categoryNames.join(', ')}.
Reglas: responde SOLO JSON válido {"category": "<nombre exacto de la lista>"}.
Si nada encaja claramente, usa {"category": "Otros"}.
Ejemplos: "cena en restaurante" -> Comida; "gasolina de la moto" -> Moto; "noche de hotel" -> Hotel; "mercado del mes" -> Supermercado; "cervezas con amigos" -> Salidas; "medicinas" -> Farmacia.`;
  try {
    const r = await getAI().chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: sys },
        { role: 'user', content: `Gasto: "${description}"` },
      ],
      temperature: 0,
      response_format: { type: 'json_object' },
    });
    const txt = r.choices[0]?.message?.content || '{}';
    const data = JSON.parse(txt);
    return data.category || null;
  } catch (e) {
    console.error('suggestCategory', e.message);
    return null;
  }
}

// Extract structured expense from Pago Movil receipt image.
export async function extractReceipt(buffer, mimetype = 'image/jpeg') {
  const base64 = buffer.toString('base64');
  const dataUrl = `data:${mimetype};base64,${base64}`;
  const sys = `Extraes datos de comprobantes de pago venezolanos (Pago Móvil, Banesco, BDV, POS).
Devuelve SOLO JSON válido con este formato exacto:
{"amount_bs": number|null, "reference": string|null, "bank": string|null, "date": "YYYY-MM-DD"|null, "description": string|null}
El monto viene en formato venezolano: 1.234,56 = 1234.56 (punto es miles, coma decimal). Devuelve números normalizados. Si no ves un campo, usa null.`;
  const r = await getAI().chat.completions.create({
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: sys },
      { role: 'user', content: [
        { type: 'text', text: 'Extrae los datos de este comprobante.' },
        { type: 'image_url', image_url: { url: dataUrl } },
      ]},
    ],
    temperature: 0,
    response_format: { type: 'json_object' },
  });
  const txt = r.choices[0]?.message?.content || '{}';
  try { return JSON.parse(txt); } catch { return {}; }
}
