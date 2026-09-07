'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { api, fmtNum } from '@/lib/ui';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Printer, RefreshCw } from 'lucide-react';

const MONTH_NAMES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

// Emerald-leaning palette so the chart matches the app.
const SLICE_COLORS = ['#047857', '#0d9488', '#0891b2', '#65a30d', '#ca8a04',
  '#b45309', '#9f1239', '#7c3aed', '#475569', '#78716c'];

function monthLabel(m) {
  if (!m) return '';
  const [y, mo] = m.split('-');
  return `${MONTH_NAMES[Number(mo) - 1]} ${y}`;
}

function ReportBody() {
  const params = useSearchParams();
  const [month, setMonth] = useState(params.get('month') || new Date().toISOString().slice(0, 7));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    setData(null); setError(null);
    api(`/reports/monthly?month=${month}`).then(setData).catch(e => setError(e.message));
  }, [month]);

  if (error) {
    return (
      <div className="mx-auto max-w-2xl p-6 text-center">
        <p className="text-sm text-stone-600">{error}</p>
        <a href="/" className="mt-3 inline-block text-sm text-emerald-700 underline">Volver a la app</a>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-stone-500">
        <RefreshCw size={18} className="mr-2 animate-spin" /> Generando informe...
      </div>
    );
  }

  const cats = data.by_category.filter(c => Number(c.total_usd) > 0);
  const maxCat = Math.max(1, ...cats.map(c => Number(c.total_usd)));
  const typeOf = (t) => data.by_type.find(x => x.type === t) || { total_usd: 0, total_usdt: 0, n: 0 };

  return (
    <div className="mx-auto max-w-3xl bg-white p-5 print:p-0 sm:p-8">
      {/* Barra de acciones — se oculta al imprimir */}
      <div className="mb-6 flex items-center justify-between gap-2 print:hidden">
        <a href="/">
          <Button variant="ghost" size="sm" className="h-9"><ArrowLeft size={15} className="mr-1.5" /> Volver</Button>
        </a>
        <div className="flex items-center gap-2">
          <input
            type="month"
            value={month}
            onChange={e => setMonth(e.target.value)}
            className="h-9 rounded-md border border-stone-300 px-2 text-sm"
          />
          <Button size="sm" className="h-9 bg-emerald-600 hover:bg-emerald-700" onClick={() => window.print()}>
            <Printer size={15} className="mr-1.5" /> Guardar PDF
          </Button>
        </div>
      </div>

      {/* Encabezado */}
      <header className="mb-6 border-b border-stone-200 pb-4">
        <div className="text-[11px] uppercase tracking-widest text-emerald-700">NuestrasFinanzas</div>
        <h1 className="mt-1 text-2xl font-bold text-stone-900">Informe de {monthLabel(data.month)}</h1>
        <p className="mt-1 text-xs text-stone-500">
          Generado el {new Date(data.generated_at).toLocaleString('es-VE')}
          {data.rates?.bcv_usd?.rate ? ` · BCV ${fmtNum(data.rates.bcv_usd.rate)} Bs/USD` : ''}
          {data.rates?.binance_usdt?.rate ? ` · USDT ${fmtNum(data.rates.binance_usdt.rate)} Bs` : ''}
        </p>
      </header>

      {/* Resumen */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label="Gasto total" value={`$${fmtNum(data.total_usd)}`} />
        <Metric label="Compartido #Nos" value={`$${fmtNum(typeOf('NOS').total_usd)}`} />
        <Metric label="Personal #Mio" value={`$${fmtNum(typeOf('MIO').total_usd)}`} />
        <Metric label="USDT congelado" value={`${fmtNum(data.frozen_usdt.total_usdt)} ₮`} accent />
      </section>

      {/* Gráfico por categoría */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-700">Gasto por categoría</h2>
        {cats.length === 0 ? (
          <p className="text-sm text-stone-500">Sin gastos registrados este mes.</p>
        ) : (
          <div className="grid gap-5 sm:grid-cols-[200px_1fr]">
            <DonutChart cats={cats} total={Number(data.total_usd)} />
            <div className="space-y-2">
              {cats.map((c, i) => (
                <div key={c.category}>
                  <div className="flex items-baseline justify-between text-xs">
                    <span className="flex items-center gap-1.5 text-stone-700">
                      <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: SLICE_COLORS[i % SLICE_COLORS.length] }} />
                      {c.icon} {c.category}
                      <span className="text-stone-400">({c.n})</span>
                    </span>
                    <span className="tabular-nums text-stone-900">
                      <b>${fmtNum(c.total_usd)}</b> <span className="text-stone-400">{c.pct}%</span>
                    </span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-stone-100">
                    <div
                      className="h-full rounded-full"
                      style={{ width: `${(Number(c.total_usd) / maxCat) * 100}%`, background: SLICE_COLORS[i % SLICE_COLORS.length] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      {/* Por miembro */}
      <section className="mb-6">
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-stone-700">Por persona</h2>
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-stone-200 text-left text-stone-500">
              <th className="py-1.5 font-medium">Miembro</th>
              <th className="py-1.5 text-right font-medium">#Mio</th>
              <th className="py-1.5 text-right font-medium">Parte de #Nos</th>
              <th className="py-1.5 text-right font-medium">Le corresponde</th>
              <th className="py-1.5 text-right font-medium">Puso</th>
            </tr>
          </thead>
          <tbody>
            {data.by_member.map(m => (
              <tr key={m.id} className="border-b border-stone-100">
                <td className="py-2">
                  <span className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: m.color || '#0f766e' }} />
                  {m.name}
                </td>
                <td className="py-2 text-right tabular-nums">${fmtNum(m.mio_usd)}</td>
                <td className="py-2 text-right tabular-nums">${fmtNum(m.nos_share_usd)}</td>
                <td className="py-2 text-right font-semibold tabular-nums">${fmtNum(m.total_usd)}</td>
                <td className="py-2 text-right tabular-nums text-stone-500">${fmtNum(m.paid_usd)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Congelado + billeteras */}
      <section className="mb-6 grid gap-5 sm:grid-cols-2">
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-700">Préstamos congelados</h2>
          <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
            <div className="text-2xl font-bold tabular-nums text-emerald-800">{fmtNum(data.frozen_usdt.total_usdt)} ₮</div>
            <div className="mt-0.5 text-xs text-stone-600">
              {data.frozen_usdt.n} préstamo(s) sin liquidar · valor original ${fmtNum(data.frozen_usdt.total_usd)}
            </div>
            <p className="mt-2 text-[11px] text-stone-500">
              El monto queda congelado en USDT al momento del préstamo, así la devaluación del bolívar no lo diluye.
            </p>
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-700">Saldo de billeteras</h2>
          <div className="space-y-1">
            {data.wallets.length === 0 && <p className="text-sm text-stone-500">Sin billeteras.</p>}
            {data.wallets.map((w, i) => (
              <div key={i} className="flex items-center justify-between rounded border border-stone-200 px-3 py-1.5 text-xs">
                <span className="text-stone-600">{w.name}</span>
                <span className="font-semibold tabular-nums">{fmtNum(w.current_balance)} {w.currency}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {data.settlements.length > 0 && (
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-stone-700">Liquidaciones del mes</h2>
          <div className="space-y-1">
            {data.settlements.map((s, i) => (
              <div key={i} className="flex items-center justify-between border-b border-stone-100 py-1.5 text-xs">
                <span className="text-stone-600">
                  {s.payer_name} → {s.receiver_name} · {new Date(s.settlement_date).toLocaleDateString('es-VE')}
                </span>
                <span className="font-semibold tabular-nums">${fmtNum(s.amount_usd)}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      <footer className="border-t border-stone-200 pt-3 text-[10px] text-stone-400">
        NuestrasFinanzas · informe generado automáticamente. Los montos en USD usan la tasa BCV del momento de cada gasto.
      </footer>
    </div>
  );
}

function Metric({ label, value, accent }) {
  return (
    <div className={`rounded-lg border p-3 ${accent ? 'border-emerald-200 bg-emerald-50/50' : 'border-stone-200'}`}>
      <div className="text-[10px] uppercase tracking-wide text-stone-500">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums text-stone-900">{value}</div>
    </div>
  );
}

// Donut drawn with plain SVG arcs — no chart dependency, prints cleanly.
function DonutChart({ cats, total }) {
  const size = 180, stroke = 34, r = (size - stroke) / 2, cx = size / 2, cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Gasto por categoría">
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#f5f5f4" strokeWidth={stroke} />
      {cats.map((c, i) => {
        const frac = total ? Number(c.total_usd) / total : 0;
        const len = frac * circumference;
        const el = (
          <circle
            key={c.category}
            cx={cx} cy={cy} r={r} fill="none"
            stroke={SLICE_COLORS[i % SLICE_COLORS.length]}
            strokeWidth={stroke}
            strokeDasharray={`${len} ${circumference - len}`}
            strokeDashoffset={-offset}
            transform={`rotate(-90 ${cx} ${cy})`}
          />
        );
        offset += len;
        return el;
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" className="fill-stone-900" style={{ fontSize: 20, fontWeight: 700 }}>
        ${Math.round(total)}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" className="fill-stone-500" style={{ fontSize: 10 }}>
        total del mes
      </text>
    </svg>
  );
}

export default function ReportPage() {
  return (
    <div className="min-h-[100dvh] bg-stone-50 print:bg-white">
      <Suspense fallback={<div className="p-8 text-center text-stone-500">Cargando...</div>}>
        <ReportBody />
      </Suspense>
    </div>
  );
}
