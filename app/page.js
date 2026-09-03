'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { ArrowRight, RefreshCw, Wallet, Users, TrendingUp, Trash2, Plus, Sparkles, DollarSign, Coins, Receipt, PiggyBank, Snowflake } from 'lucide-react';

const api = async (path, options = {}) => {
  const r = await fetch('/api' + path, {
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || 'Error de servidor');
  return data;
};

const CURRENCIES = ['USD', 'BS', 'EUR', 'USDT'];
const TX_TYPES = [
  { code: 'NOS', label: '#Nos · Compartido 50/50', desc: 'Se divide entre ambos', color: 'bg-indigo-500' },
  { code: 'MIO', label: '#Mio · Personal', desc: 'Solo mi gasto', color: 'bg-slate-500' },
  { code: 'PRESTAMO', label: '#Prestamo · Congelado en USDT', desc: 'Se convierte a USDT al instante', color: 'bg-fuchsia-500' },
];

function currencySymbol(c) { return { USD: '$', BS: 'Bs.', EUR: '€', USDT: '₮' }[c] || c; }
function fmtNum(v, d = 2) { const n = Number(v || 0); return n.toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d }); }

export default function App() {
  const [ready, setReady] = useState(false);
  const [users, setUsers] = useState([]);
  const [me, setMe] = useState(null);
  const [tab, setTab] = useState('dashboard');
  const [dashboard, setDashboard] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [categories, setCategories] = useState([]);
  const [wallets, setWallets] = useState([]);
  const [budgets, setBudgets] = useState([]);
  const [rates, setRates] = useState(null);
  const [refreshing, setRefreshing] = useState(false);

  // ------ ONBOARDING ------
  const [needsOnboard, setNeedsOnboard] = useState(false);
  const [mode, setMode] = useState('couple');
  const [name1, setName1] = useState('José');
  const [name2, setName2] = useState('Aliexis');

  useEffect(() => { boot(); }, []);

  async function boot() {
    try {
      const us = await api('/users');
      if (!us || us.length === 0) {
        setNeedsOnboard(true);
        setReady(true);
        return;
      }
      setUsers(us);
      const savedMe = typeof window !== 'undefined' ? localStorage.getItem('me_id') : null;
      const meUser = us.find(u => u.id === savedMe) || us[0];
      setMe(meUser);
      await loadAll();
      setReady(true);
    } catch (e) {
      toast.error('Error inicial: ' + e.message);
      setReady(true);
    }
  }

  async function completeOnboard() {
    try {
      const names = mode === 'couple' ? [name1, name2] : [name1];
      await api('/init', { method: 'POST', body: JSON.stringify({ mode, names }) });
      toast.success('¡Listo! Configurando cuentas...');
      setNeedsOnboard(false);
      await boot();
    } catch (e) { toast.error(e.message); }
  }

  async function loadAll() {
    const [d, tx, c, w, b, r] = await Promise.all([
      api('/dashboard'),
      api('/transactions?limit=50'),
      api('/categories'),
      api('/wallets'),
      api('/budgets'),
      api('/rates'),
    ]);
    setDashboard(d); setTransactions(tx); setCategories(c); setWallets(w); setBudgets(b); setRates(r);
  }

  async function refreshRates() {
    setRefreshing(true);
    try { const r = await api('/rates/refresh', { method: 'POST' }); setRates(r.latest); toast.success('Tasas actualizadas'); }
    catch (e) { toast.error(e.message); }
    finally { setRefreshing(false); }
  }

  function switchMe(uid) {
    const u = users.find(x => x.id === uid);
    if (u) { setMe(u); localStorage.setItem('me_id', uid); toast.success(`Ahora eres ${u.name}`); }
  }

  // ------ ONBOARDING VIEW ------
  if (!ready) return <div className="flex min-h-screen items-center justify-center text-muted-foreground">Cargando...</div>;

  if (needsOnboard) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-fuchsia-50 p-4">
        <Card className="w-full max-w-md border-indigo-100 shadow-xl">
          <CardHeader>
            <div className="mb-2 flex justify-center"><div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 p-3 text-white"><Sparkles size={28} /></div></div>
            <CardTitle className="text-center text-2xl">Bienvenidos 💜</CardTitle>
            <CardDescription className="text-center">Configura tu espacio financiero</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>¿Cómo van a usarla?</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant={mode === 'couple' ? 'default' : 'outline'} onClick={() => setMode('couple')}>👫 Pareja</Button>
                <Button variant={mode === 'single' ? 'default' : 'outline'} onClick={() => setMode('single')}>🧑 Individual</Button>
              </div>
            </div>
            <div>
              <Label>{mode === 'couple' ? 'Nombre 1' : 'Tu nombre'}</Label>
              <Input value={name1} onChange={e => setName1(e.target.value)} />
            </div>
            {mode === 'couple' && (
              <div>
                <Label>Nombre 2</Label>
                <Input value={name2} onChange={e => setName2(e.target.value)} />
              </div>
            )}
            <Button className="w-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 hover:opacity-90" onClick={completeOnboard}>
              Empezar <ArrowRight className="ml-2" size={16} />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ------ MAIN LAYOUT ------
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-indigo-50">
      <Header users={users} me={me} switchMe={switchMe} rates={rates} refreshing={refreshing} onRefresh={refreshRates} />
      <main className="container mx-auto max-w-6xl px-4 py-6">
        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="dashboard">📊 Dashboard</TabsTrigger>
            <TabsTrigger value="new">➕ Nuevo Gasto</TabsTrigger>
            <TabsTrigger value="history">📜 Historial</TabsTrigger>
            <TabsTrigger value="config">⚙️ Ajustes</TabsTrigger>
          </TabsList>

          <TabsContent value="dashboard"><DashboardView data={dashboard} me={me} /></TabsContent>
          <TabsContent value="new"><NewExpenseForm me={me} users={users} categories={categories} wallets={wallets} rates={rates} onSaved={loadAll} onSwitchTab={() => setTab('history')} /></TabsContent>
          <TabsContent value="history"><HistoryView transactions={transactions} onDelete={async (id) => { await api('/transactions/' + id, { method: 'DELETE' }); toast.success('Eliminado'); await loadAll(); }} /></TabsContent>
          <TabsContent value="config"><ConfigView users={users} setUsers={setUsers} wallets={wallets} categories={categories} budgets={budgets} reload={loadAll} /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

// ------ HEADER ------
function Header({ users, me, switchMe, rates, refreshing, onRefresh }) {
  return (
    <header className="border-b bg-white/70 backdrop-blur-sm sticky top-0 z-40">
      <div className="container mx-auto max-w-6xl flex items-center justify-between px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 p-2 text-white"><Wallet size={20} /></div>
          <div>
            <div className="text-sm font-semibold leading-tight">Finanzas Pareja</div>
            <div className="text-[11px] text-muted-foreground">Multi-moneda + USDT</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <RatesPill rates={rates} refreshing={refreshing} onRefresh={onRefresh} />
          {users.length > 1 && (
            <Select value={me?.id} onValueChange={switchMe}>
              <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {users.map(u => <SelectItem key={u.id} value={u.id}>👤 {u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>
    </header>
  );
}

function RatesPill({ rates, refreshing, onRefresh }) {
  return (
    <div className="hidden md:flex items-center gap-2 rounded-full bg-slate-900 text-white px-3 py-1 text-xs">
      <span className="opacity-70">BCV</span> <span className="font-semibold">{rates?.bcv_usd ? fmtNum(rates.bcv_usd.rate) : '—'}</span>
      <Separator orientation="vertical" className="h-3 bg-white/20" />
      <span className="opacity-70">USDT</span> <span className="font-semibold">{rates?.binance_usdt ? fmtNum(rates.binance_usdt.rate) : '—'}</span>
      <button onClick={onRefresh} className="ml-1 opacity-70 hover:opacity-100"><RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} /></button>
    </div>
  );
}

// ------ DASHBOARD ------
function DashboardView({ data, me }) {
  if (!data) return <div className="text-muted-foreground">Cargando...</div>;
  const { net, totals, budgets, rates } = data;

  return (
    <div className="space-y-4">
      {/* Net debt hero card */}
      {net && (
        <Card className="overflow-hidden border-0 bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-600 text-white shadow-xl">
          <CardContent className="p-6">
            <div className="mb-2 flex items-center gap-2 text-white/80"><Snowflake size={16} /> <span className="text-xs uppercase tracking-wider">Deuda neta actual</span></div>
            {Number(net.amount_usd) < 0.01 ? (
              <div className="text-2xl font-bold">✨ Están al día · $0.00</div>
            ) : (
              <>
                <div className="text-3xl md:text-4xl font-bold">
                  {net.from.name} le debe a {net.to.name}
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-4">
                  <div><span className="text-4xl font-black">${fmtNum(net.amount_usd)}</span><span className="ml-1 text-white/70">USD</span></div>
                  <div className="flex items-center gap-1 rounded-full bg-white/15 px-3 py-1 text-sm"><Coins size={14} /> {fmtNum(net.amount_usdt)} USDT · congelado</div>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {/* Totals grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard icon={<Users size={16} />} label="#Nos este mes" value={`$${fmtNum(totals?.total_nos)}`} color="indigo" />
        <StatCard icon={<DollarSign size={16} />} label="#Mio este mes" value={`$${fmtNum(totals?.total_mio)}`} color="slate" />
        <StatCard icon={<Snowflake size={16} />} label="Préstamos USDT" value={`${fmtNum(totals?.total_prestamo_usdt)} ₮`} color="fuchsia" />
        <StatCard icon={<Receipt size={16} />} label="Transacciones" value={totals?.n || 0} color="emerald" />
      </div>

      {/* Budgets */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><PiggyBank size={18} /> Presupuestos del mes</CardTitle>
          <CardDescription>Verde &lt;75% · Amarillo 75-90% · Rojo &gt;90%</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {budgets?.length === 0 && <div className="text-sm text-muted-foreground">Aún no hay presupuestos. Crea uno en Ajustes.</div>}
          {budgets?.map(b => {
            const pct = b.pct || 0;
            const color = pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500';
            return (
              <div key={b.id}>
                <div className="mb-1 flex items-center justify-between text-sm">
                  <span className="font-medium">{b.category_icon} {b.category_name} {!b.is_shared && '(personal)'}</span>
                  <span className="tabular-nums text-muted-foreground">${fmtNum(b.spent_usd)} / ${fmtNum(b.monthly_limit_usd)} · <span className={pct > 90 ? 'text-rose-600 font-semibold' : pct > 75 ? 'text-amber-600 font-semibold' : ''}>{pct.toFixed(0)}%</span></span>
                </div>
                <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                  <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
                </div>
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Rates card */}
      <Card>
        <CardHeader><CardTitle className="flex items-center gap-2"><TrendingUp size={18} /> Tasas de cambio</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <RateCard label="BCV · USD/VES" rate={rates?.bcv_usd?.rate} at={rates?.bcv_usd?.fetched_at} />
          <RateCard label="BCV · EUR/VES" rate={rates?.bcv_eur?.rate} at={rates?.bcv_eur?.fetched_at} />
          <RateCard label="Binance P2P · USDT/VES" rate={rates?.binance_usdt?.rate} at={rates?.binance_usdt?.fetched_at} highlight />
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, color }) {
  const colors = { indigo: 'bg-indigo-50 text-indigo-700', slate: 'bg-slate-50 text-slate-700', fuchsia: 'bg-fuchsia-50 text-fuchsia-700', emerald: 'bg-emerald-50 text-emerald-700' };
  return (
    <Card className="border-slate-200">
      <CardContent className="p-4">
        <div className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] ${colors[color]}`}>{icon}{label}</div>
        <div className="mt-2 text-2xl font-bold">{value}</div>
      </CardContent>
    </Card>
  );
}

function RateCard({ label, rate, at, highlight }) {
  return (
    <div className={`rounded-lg border p-4 ${highlight ? 'border-fuchsia-200 bg-fuchsia-50/50' : 'border-slate-200'}`}>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums">{rate ? fmtNum(rate, 4) : '—'}</div>
      {at && <div className="mt-1 text-[10px] text-muted-foreground">{new Date(at).toLocaleString('es-VE')}</div>}
    </div>
  );
}

// ------ NEW EXPENSE FORM ------
function NewExpenseForm({ me, users, categories, wallets, rates, onSaved, onSwitchTab }) {
  const [type, setType] = useState('NOS');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [beneficiary, setBeneficiary] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [walletId, setWalletId] = useState('');
  const [description, setDescription] = useState('');
  const [rateOverride, setRateOverride] = useState('');
  const [saving, setSaving] = useState(false);

  const otherUser = useMemo(() => users.find(u => u.id !== me?.id), [users, me]);
  const myWallets = useMemo(() => wallets.filter(w => w.user_id === me?.id), [wallets, me]);

  useEffect(() => {
    if (type === 'PRESTAMO' && !beneficiary && otherUser) setBeneficiary(otherUser.id);
  }, [type, otherUser]);

  const suggestedRate = useMemo(() => {
    if (currency === 'USD' || currency === 'USDT') return 1;
    if (currency === 'BS') return rates?.bcv_usd?.rate || 0;
    if (currency === 'EUR') {
      const bu = rates?.bcv_usd?.rate, be = rates?.bcv_eur?.rate;
      if (bu && be) return bu / be;
      return 0;
    }
    return 0;
  }, [currency, rates]);

  const usedRate = rateOverride ? parseFloat(rateOverride) : suggestedRate;
  const amountUsd = useMemo(() => {
    const a = parseFloat(amount || 0);
    if (!a) return 0;
    if (currency === 'USD' || currency === 'USDT') return a;
    if (!usedRate) return 0;
    return a / usedRate;
  }, [amount, currency, usedRate]);

  const amountUsdt = useMemo(() => {
    if (type !== 'PRESTAMO') return null;
    const a = parseFloat(amount || 0);
    const bcvUsd = rates?.bcv_usd?.rate || 0;
    const bcvEur = rates?.bcv_eur?.rate || 0;
    const bin = rates?.binance_usdt?.rate || 0;
    if (!a || !bin) return 0;
    let ves = 0;
    if (currency === 'BS') ves = a;
    else if (currency === 'USD') ves = a * bcvUsd;
    else if (currency === 'EUR') ves = a * bcvEur;
    else if (currency === 'USDT') return a;
    return ves / bin;
  }, [amount, currency, type, rates]);

  async function submit() {
    if (!me) { toast.error('Selecciona quién eres'); return; }
    if (!amount || parseFloat(amount) <= 0) { toast.error('Monto inválido'); return; }
    if (type === 'PRESTAMO' && !beneficiary) { toast.error('Selecciona beneficiario'); return; }
    setSaving(true);
    try {
      await api('/transactions', { method: 'POST', body: JSON.stringify({
        payer_id: me.id, type, original_amount: amount, original_currency: currency,
        applied_rate: rateOverride || undefined,
        beneficiary_id: type === 'PRESTAMO' ? beneficiary : null,
        category_id: categoryId || null, wallet_id: walletId || null, description,
      })});
      toast.success('✅ Gasto registrado');
      setAmount(''); setDescription(''); setRateOverride('');
      await onSaved();
      onSwitchTab?.();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader><CardTitle>Registrar gasto</CardTitle><CardDescription>El sistema calcula automáticamente USD y USDT</CardDescription></CardHeader>
      <CardContent className="space-y-4">
        <div>
          <Label>Tipo</Label>
          <div className="mt-2 grid grid-cols-1 md:grid-cols-3 gap-2">
            {TX_TYPES.map(t => (
              <button key={t.code} onClick={() => setType(t.code)}
                className={`rounded-lg border p-3 text-left transition ${type === t.code ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/40' : 'border-slate-200 hover:border-slate-300'}`}>
                <div className={`inline-block h-2 w-2 rounded-full ${t.color} mr-2`}></div>
                <span className="font-medium text-sm">{t.label}</span>
                <div className="text-[11px] text-muted-foreground mt-1">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <Label>Monto</Label>
            <Input type="number" step="0.01" placeholder="0.00" value={amount} onChange={e => setAmount(e.target.value)} className="text-lg" />
          </div>
          <div>
            <Label>Moneda</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(c => <SelectItem key={c} value={c}>{currencySymbol(c)} {c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {(currency === 'BS' || currency === 'EUR') && (
          <div className="rounded-md bg-slate-50 p-3">
            <Label className="text-xs">Tasa {currency}/USD</Label>
            <div className="mt-1 flex items-center gap-2">
              <div className="text-sm text-muted-foreground">Sugerida BCV: <b className="text-slate-900">{fmtNum(suggestedRate, 4)}</b></div>
              <Input type="number" step="0.0001" placeholder="Sobrescribir..." value={rateOverride} onChange={e => setRateOverride(e.target.value)} className="max-w-[160px] h-8" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Categoría</Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger><SelectValue placeholder="Seleccionar..." /></SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Billetera (opcional)</Label>
            <Select value={walletId} onValueChange={setWalletId}>
              <SelectTrigger><SelectValue placeholder="Ninguna" /></SelectTrigger>
              <SelectContent>
                {myWallets.map(w => <SelectItem key={w.id} value={w.id}>{w.name} ({w.currency})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {type === 'PRESTAMO' && (
          <div>
            <Label>Beneficiario del préstamo</Label>
            <Select value={beneficiary} onValueChange={setBeneficiary}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {users.filter(u => u.id !== me?.id).map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        <div>
          <Label>Descripción</Label>
          <Textarea placeholder="Ej: cena en La Estancia" value={description} onChange={e => setDescription(e.target.value)} rows={2} />
        </div>

        {/* Preview */}
        <div className="rounded-xl border-2 border-dashed border-indigo-200 bg-gradient-to-br from-indigo-50 to-fuchsia-50 p-4">
          <div className="text-xs text-muted-foreground mb-2">Previsualización</div>
          <div className="flex flex-wrap items-baseline gap-4">
            <div><span className="text-2xl font-bold">${fmtNum(amountUsd)}</span> <span className="text-xs text-muted-foreground">USD equivalente</span></div>
            {type === 'PRESTAMO' && (
              <div className="flex items-center gap-1 rounded-full bg-fuchsia-500 text-white px-3 py-1 text-sm font-semibold">
                <Snowflake size={12} /> {fmtNum(amountUsdt)} USDT · congelado
              </div>
            )}
          </div>
          {type === 'NOS' && parseFloat(amount) > 0 && <div className="mt-1 text-xs text-muted-foreground">Cada uno aporta ${fmtNum(amountUsd / 2)}</div>}
        </div>

        <Button className="w-full bg-gradient-to-r from-indigo-500 to-fuchsia-500" disabled={saving} onClick={submit}>
          {saving ? 'Guardando...' : '💾 Registrar gasto'}
        </Button>
      </CardContent>
    </Card>
  );
}

// ------ HISTORY ------
function HistoryView({ transactions, onDelete }) {
  const typeColor = { NOS: 'bg-indigo-100 text-indigo-800', MIO: 'bg-slate-100 text-slate-800', PRESTAMO: 'bg-fuchsia-100 text-fuchsia-800' };
  return (
    <Card>
      <CardHeader><CardTitle>Historial de transacciones</CardTitle><CardDescription>Últimas 50 operaciones</CardDescription></CardHeader>
      <CardContent>
        {transactions.length === 0 && <div className="text-sm text-muted-foreground py-8 text-center">No hay transacciones aún</div>}
        <div className="divide-y">
          {transactions.map(t => (
            <div key={t.id} className="flex items-center justify-between py-3 gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="text-2xl">{t.category_icon || '💰'}</div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge className={typeColor[t.type]}>#{t.type.toLowerCase()}</Badge>
                    <span className="font-semibold">{t.description || t.category_name || 'Sin descripción'}</span>
                  </div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    Pagó <b>{t.payer_name}</b>{t.beneficiary_name ? ` para ${t.beneficiary_name}` : ''} · {new Date(t.transaction_date).toLocaleDateString('es-VE')}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 shrink-0">
                <div className="text-right">
                  <div className="font-bold tabular-nums">{currencySymbol(t.original_currency)} {fmtNum(t.original_amount)}</div>
                  <div className="text-xs text-muted-foreground tabular-nums">${fmtNum(t.amount_usd)} USD{t.amount_usdt ? ` · ${fmtNum(t.amount_usdt)} ₮` : ''}</div>
                </div>
                <Button size="icon" variant="ghost" onClick={() => onDelete(t.id)}><Trash2 size={14} /></Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

// ------ CONFIG ------
function ConfigView({ users, wallets, categories, budgets, reload }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <WalletsSection users={users} wallets={wallets} reload={reload} />
      <BudgetsSection categories={categories} users={users} budgets={budgets} reload={reload} />
    </div>
  );
}

function WalletsSection({ users, wallets, reload }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ user_id: '', name: '', currency: 'USD', account_type: 'BANK', current_balance: 0 });
  async function submit() {
    try { await api('/wallets', { method: 'POST', body: JSON.stringify(form) }); toast.success('Billetera creada'); setOpen(false); setForm({ user_id: '', name: '', currency: 'USD', account_type: 'BANK', current_balance: 0 }); await reload(); }
    catch (e) { toast.error(e.message); }
  }
  async function del(id) { await api('/wallets/' + id, { method: 'DELETE' }); toast.success('Eliminada'); await reload(); }
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle className="flex items-center gap-2"><Wallet size={18} /> Billeteras</CardTitle><CardDescription>Bancos, Pago Móvil, Efectivo</CardDescription></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus size={14} className="mr-1" /> Nueva</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nueva billetera</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Dueño</Label>
                <Select value={form.user_id} onValueChange={v => setForm({ ...form, user_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                  <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label>Nombre</Label><Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ej: Banesco, Pago Móvil BDV, Efectivo" /></div>
              <div className="grid grid-cols-2 gap-2">
                <div><Label>Tipo</Label>
                  <Select value={form.account_type} onValueChange={v => setForm({ ...form, account_type: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BANK">Banco</SelectItem>
                      <SelectItem value="PAYMENT_GATEWAY">Pago Móvil</SelectItem>
                      <SelectItem value="CASH">Efectivo</SelectItem>
                      <SelectItem value="CREDIT">Crédito (Cashea)</SelectItem>
                    </SelectContent>
                  </Select></div>
                <div><Label>Moneda</Label>
                  <Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select></div>
              </div>
              <div><Label>Saldo inicial</Label><Input type="number" step="0.01" value={form.current_balance} onChange={e => setForm({ ...form, current_balance: e.target.value })} /></div>
            </div>
            <DialogFooter><Button onClick={submit}>Crear</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {wallets.length === 0 && <div className="text-sm text-muted-foreground text-center py-4">Aún no hay billeteras</div>}
        <div className="divide-y">
          {wallets.map(w => (
            <div key={w.id} className="flex items-center justify-between py-2">
              <div>
                <div className="font-medium text-sm">{w.name} <Badge variant="secondary" className="ml-1">{w.currency}</Badge></div>
                <div className="text-xs text-muted-foreground">{w.user_name || users.find(u => u.id === w.user_id)?.name} · {w.account_type}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold tabular-nums">{fmtNum(w.current_balance)}</div>
                <Button size="icon" variant="ghost" onClick={() => del(w.id)}><Trash2 size={14} /></Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function BudgetsSection({ categories, users, budgets, reload }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ category_id: '', monthly_limit_usd: '', is_shared: true, user_id: '' });
  async function submit() {
    try { await api('/budgets', { method: 'POST', body: JSON.stringify(form) }); toast.success('Presupuesto guardado'); setOpen(false); await reload(); }
    catch (e) { toast.error(e.message); }
  }
  async function del(id) { await api('/budgets/' + id, { method: 'DELETE' }); toast.success('Eliminado'); await reload(); }
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div><CardTitle className="flex items-center gap-2"><PiggyBank size={18} /> Presupuestos</CardTitle><CardDescription>Límites mensuales por categoría</CardDescription></div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild><Button size="sm"><Plus size={14} className="mr-1" /> Nuevo</Button></DialogTrigger>
          <DialogContent>
            <DialogHeader><DialogTitle>Nuevo presupuesto</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div><Label>Categoría</Label>
                <Select value={form.category_id} onValueChange={v => setForm({ ...form, category_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                  <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}</SelectContent>
                </Select></div>
              <div><Label>Límite mensual (USD)</Label><Input type="number" step="0.01" value={form.monthly_limit_usd} onChange={e => setForm({ ...form, monthly_limit_usd: e.target.value })} placeholder="300" /></div>
              <div><Label>Alcance</Label>
                <Select value={form.is_shared ? 'shared' : 'personal'} onValueChange={v => setForm({ ...form, is_shared: v === 'shared', user_id: v === 'shared' ? '' : form.user_id })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shared">Compartido (#Nos)</SelectItem>
                    <SelectItem value="personal">Personal (#Mio)</SelectItem>
                  </SelectContent>
                </Select></div>
              {!form.is_shared && (
                <div><Label>Usuario</Label>
                  <Select value={form.user_id} onValueChange={v => setForm({ ...form, user_id: v })}>
                    <SelectTrigger><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                    <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                  </Select></div>
              )}
            </div>
            <DialogFooter><Button onClick={submit}>Guardar</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {budgets.length === 0 && <div className="text-sm text-muted-foreground text-center py-4">Aún no hay presupuestos</div>}
        <div className="divide-y">
          {budgets.map(b => (
            <div key={b.id} className="flex items-center justify-between py-2">
              <div>
                <div className="font-medium text-sm">{b.category_icon} {b.category_name} {!b.is_shared && `· ${b.user_name}`}</div>
                <div className="text-xs text-muted-foreground">{b.is_shared ? 'Compartido' : 'Personal'}</div>
              </div>
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold tabular-nums">${fmtNum(b.monthly_limit_usd)}</div>
                <Button size="icon" variant="ghost" onClick={() => del(b.id)}><Trash2 size={14} /></Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
