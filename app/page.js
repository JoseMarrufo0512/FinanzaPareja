'use client';

import { useEffect, useMemo, useState, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { toast } from 'sonner';
import {
  ArrowRight, RefreshCw, Wallet, Users, TrendingUp, Trash2, Plus,
  Sparkles, DollarSign, Coins, Receipt, PiggyBank, Snowflake, Send,
  HandCoins, CheckCircle2, LogOut, Lock, LayoutDashboard, PlusCircle,
  Clock, Settings, Eye, EyeOff, ChevronDown, Menu, X
} from 'lucide-react';

/* ─── helpers ─── */
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
  { code: 'NOS', label: '#Nos', fullLabel: '#Nos · Compartido 50/50', desc: 'Se divide entre ambos', color: 'bg-indigo-500', icon: '👫' },
  { code: 'MIO', label: '#Mio', fullLabel: '#Mio · Personal', desc: 'Solo mi gasto', color: 'bg-slate-500', icon: '🧑' },
  { code: 'PRESTAMO', label: '#Prestamo', fullLabel: '#Prestamo · Congelado USDT', desc: 'Se convierte a USDT', color: 'bg-fuchsia-500', icon: '❄️' },
];

function currencySymbol(c) { return { USD: '$', BS: 'Bs.', EUR: '€', USDT: '₮' }[c] || c; }
function fmtNum(v, d = 2) { const n = Number(v || 0); return n.toLocaleString('es-VE', { minimumFractionDigits: d, maximumFractionDigits: d }); }

/* ─── BOTTOM NAV ITEMS ─── */
const NAV_ITEMS = [
  { key: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
  { key: 'new', label: 'Nuevo', icon: PlusCircle },
  { key: 'history', label: 'Historial', icon: Clock },
  { key: 'config', label: 'Ajustes', icon: Settings },
];

/* ══════════════════════════════════════════════
   AUTH GATE
   ══════════════════════════════════════════════ */
function AuthGate({ pinSet, onAuthed }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);

  async function submit() {
    if (!pin || pin.trim().length < 4) { toast.error('El PIN debe tener al menos 4 caracteres'); return; }
    if (!pinSet && pin !== pin2) { toast.error('Los PIN no coinciden'); return; }
    setLoading(true);
    try {
      await api(pinSet ? '/auth/login' : '/auth/setup', { method: 'POST', body: JSON.stringify({ pin }) });
      toast.success(pinSet ? 'Bienvenido de nuevo 💜' : 'PIN creado con éxito');
      await onAuthed();
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-fuchsia-50 px-4 py-8">
      <div className="w-full max-w-sm">
        {/* Logo */}
        <div className="mb-8 flex flex-col items-center">
          <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 p-4 text-white shadow-lg shadow-indigo-500/25">
            <Wallet size={32} />
          </div>
          <h1 className="mt-4 text-xl font-bold text-slate-900">Finanzas Pareja</h1>
          <p className="text-sm text-muted-foreground">Control compartido de gastos</p>
        </div>

        <Card className="border-slate-200/60 shadow-xl shadow-slate-200/50">
          <CardHeader className="pb-4">
            <CardTitle className="text-center text-lg">
              {pinSet ? '🔐 Ingresa tu PIN' : '🔑 Crea un PIN de acceso'}
            </CardTitle>
            <CardDescription className="text-center text-sm">
              {pinSet
                ? 'Introduce la clave compartida para entrar'
                : 'Protege tus finanzas con una clave compartida'}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-sm">PIN</Label>
              <div className="relative mt-1.5">
                <Input
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  autoFocus
                  value={pin}
                  onChange={e => setPin(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && pinSet) submit(); }}
                  placeholder="••••"
                  className="h-12 text-center text-lg tracking-[0.3em] pr-12"
                />
                <button
                  type="button"
                  onClick={() => setShowPin(!showPin)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showPin ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>
            {!pinSet && (
              <div>
                <Label className="text-sm">Confirma el PIN</Label>
                <Input
                  type={showPin ? 'text' : 'password'}
                  inputMode="numeric"
                  value={pin2}
                  onChange={e => setPin2(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') submit(); }}
                  placeholder="••••"
                  className="mt-1.5 h-12 text-center text-lg tracking-[0.3em]"
                />
              </div>
            )}
            <Button
              className="h-12 w-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-base font-semibold hover:opacity-90"
              onClick={submit}
              disabled={loading}
            >
              {loading ? (
                <RefreshCw size={18} className="mr-2 animate-spin" />
              ) : (
                <Lock size={18} className="mr-2" />
              )}
              {loading ? 'Un momento...' : (pinSet ? 'Entrar' : 'Crear PIN y entrar')}
            </Button>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

/* ══════════════════════════════════════════════
   MAIN APP
   ══════════════════════════════════════════════ */
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
  const [authStatus, setAuthStatus] = useState(null);

  // Onboarding
  const [needsOnboard, setNeedsOnboard] = useState(false);
  const [mode, setMode] = useState('couple');
  const [name1, setName1] = useState('José');
  const [name2, setName2] = useState('Aliexis');

  useEffect(() => { boot(); }, []);

  async function boot() {
    try {
      const st = await api('/auth/status');
      setAuthStatus(st);
      if (!st.authenticated) { setReady(true); return; }
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

  async function logout() {
    try { await api('/auth/logout', { method: 'POST' }); } catch {}
    setAuthStatus({ pin_set: true, authenticated: false });
    setNeedsOnboard(false);
    setReady(true);
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
    try {
      const r = await api('/rates/refresh', { method: 'POST' });
      setRates(r.latest);
      toast.success('Tasas actualizadas');
    } catch (e) { toast.error(e.message); }
    finally { setRefreshing(false); }
  }

  function switchMe(uid) {
    const u = users.find(x => x.id === uid);
    if (u) { setMe(u); localStorage.setItem('me_id', uid); toast.success(`Ahora eres ${u.name}`); }
  }

  /* ─── LOADING STATE ─── */
  if (!ready) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center">
        <div className="flex flex-col items-center gap-3">
          <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 p-3 text-white animate-pulse">
            <Wallet size={24} />
          </div>
          <span className="text-sm text-muted-foreground">Cargando...</span>
        </div>
      </div>
    );
  }

  /* ─── AUTH GATE ─── */
  if (authStatus && !authStatus.authenticated) {
    return <AuthGate pinSet={authStatus.pin_set} onAuthed={async () => { setReady(false); await boot(); }} />;
  }

  /* ─── ONBOARDING ─── */
  if (needsOnboard) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-indigo-50 via-white to-fuchsia-50 px-4 py-8">
        <Card className="w-full max-w-md border-indigo-100 shadow-xl">
          <CardHeader>
            <div className="mb-2 flex justify-center">
              <div className="rounded-2xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 p-3 text-white">
                <Sparkles size={28} />
              </div>
            </div>
            <CardTitle className="text-center text-2xl">Bienvenidos 💜</CardTitle>
            <CardDescription className="text-center">Configura tu espacio financiero</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>¿Cómo van a usarla?</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant={mode === 'couple' ? 'default' : 'outline'} className="h-12" onClick={() => setMode('couple')}>👫 Pareja</Button>
                <Button variant={mode === 'single' ? 'default' : 'outline'} className="h-12" onClick={() => setMode('single')}>🧑 Individual</Button>
              </div>
            </div>
            <div>
              <Label>{mode === 'couple' ? 'Nombre 1' : 'Tu nombre'}</Label>
              <Input value={name1} onChange={e => setName1(e.target.value)} className="h-12 mt-1.5" />
            </div>
            {mode === 'couple' && (
              <div>
                <Label>Nombre 2</Label>
                <Input value={name2} onChange={e => setName2(e.target.value)} className="h-12 mt-1.5" />
              </div>
            )}
            <Button className="h-12 w-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-base hover:opacity-90" onClick={completeOnboard}>
              Empezar <ArrowRight className="ml-2" size={18} />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  /* ─── MAIN APP LAYOUT ─── */
  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-slate-50 via-white to-indigo-50/30 pb-20 md:pb-6">
      {/* Header */}
      <MobileHeader
        users={users}
        me={me}
        switchMe={switchMe}
        rates={rates}
        refreshing={refreshing}
        onRefresh={refreshRates}
        onLogout={logout}
      />

      {/* Content */}
      <main className="mx-auto max-w-6xl px-3 sm:px-4 pt-3 sm:pt-4">
        {/* Desktop tabs (hidden on mobile) */}
        <div className="hidden md:flex items-center gap-1 mb-4 bg-white/80 backdrop-blur rounded-xl border p-1">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`flex-1 flex items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                  active
                    ? 'bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-white shadow-md'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                <Icon size={16} />
                {item.label}
              </button>
            );
          })}
        </div>

        {/* Tab Content */}
        <div className="animate-in fade-in duration-200">
          {tab === 'dashboard' && <DashboardView data={dashboard} me={me} reload={loadAll} />}
          {tab === 'new' && (
            <NewExpenseForm
              me={me}
              users={users}
              categories={categories}
              wallets={wallets}
              rates={rates}
              onSaved={loadAll}
              onSwitchTab={() => setTab('history')}
            />
          )}
          {tab === 'history' && (
            <HistoryView
              transactions={transactions}
              onDelete={async (id) => {
                await api('/transactions/' + id, { method: 'DELETE' });
                toast.success('Eliminado');
                await loadAll();
              }}
            />
          )}
          {tab === 'config' && (
            <ConfigView users={users} setUsers={setUsers} wallets={wallets} categories={categories} budgets={budgets} reload={loadAll} />
          )}
        </div>
      </main>

      {/* Mobile Bottom Nav */}
      <nav className="fixed bottom-0 inset-x-0 z-50 md:hidden bg-white/95 backdrop-blur-lg border-t border-slate-200 safe-bottom">
        <div className="flex items-stretch" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`flex-1 flex flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
                  active ? 'text-indigo-600' : 'text-slate-400'
                }`}
              >
                <div className={`p-1.5 rounded-xl transition-all ${active ? 'bg-indigo-50' : ''}`}>
                  <Icon size={20} strokeWidth={active ? 2.5 : 1.5} />
                </div>
                <span className={`text-[10px] font-medium ${active ? 'text-indigo-600' : 'text-slate-500'}`}>
                  {item.label}
                </span>
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

/* ══════════════════════════════════════════════
   MOBILE HEADER
   ══════════════════════════════════════════════ */
function MobileHeader({ users, me, switchMe, rates, refreshing, onRefresh, onLogout }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <header className="border-b bg-white/80 backdrop-blur-md sticky top-0 z-40">
      <div className="mx-auto max-w-6xl flex items-center justify-between px-3 sm:px-4 h-14">
        {/* Logo */}
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-gradient-to-br from-indigo-500 to-fuchsia-500 p-1.5 text-white">
            <Wallet size={18} />
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-bold leading-tight">Finanzas Pareja</div>
            <div className="text-[10px] text-muted-foreground">Multi-moneda + USDT</div>
          </div>
        </div>

        {/* Desktop: rates pill + user selector */}
        <div className="hidden md:flex items-center gap-2">
          <RatesPill rates={rates} refreshing={refreshing} onRefresh={onRefresh} />
          {users.length > 1 && (
            <Select value={me?.id} onValueChange={switchMe}>
              <SelectTrigger className="w-[130px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                {users.map(u => <SelectItem key={u.id} value={u.id}>👤 {u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant="ghost" size="icon" className="h-9 w-9" title="Cerrar sesión" onClick={onLogout}>
            <LogOut size={16} />
          </Button>
        </div>

        {/* Mobile: compact controls */}
        <div className="flex md:hidden items-center gap-1.5">
          {/* Rates badge (compact) */}
          {rates?.bcv_usd?.rate && (
            <button
              onClick={onRefresh}
              className="flex items-center gap-1 rounded-full bg-slate-900 text-white px-2.5 py-1 text-[10px]"
            >
              <span className="opacity-70">BCV</span>
              <span className="font-bold">{fmtNum(rates.bcv_usd.rate, 0)}</span>
              <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
            </button>
          )}

          {/* User/Menu Sheet */}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9">
                <Menu size={20} />
              </Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-0">
              <SheetHeader className="p-4 pb-2 border-b bg-gradient-to-br from-indigo-50 to-fuchsia-50">
                <SheetTitle className="text-base">Finanzas Pareja 💜</SheetTitle>
              </SheetHeader>
              <div className="p-4 space-y-4">
                {/* Current user */}
                {me && (
                  <div className="rounded-lg bg-indigo-50 p-3">
                    <div className="text-xs text-muted-foreground mb-1">Registrando como:</div>
                    <div className="font-semibold text-indigo-700">👤 {me.name}</div>
                  </div>
                )}

                {/* Switch user */}
                {users.length > 1 && (
                  <div>
                    <Label className="text-xs text-muted-foreground">Cambiar usuario</Label>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      {users.map(u => (
                        <Button
                          key={u.id}
                          variant={u.id === me?.id ? 'default' : 'outline'}
                          size="sm"
                          className="h-10"
                          onClick={() => { switchMe(u.id); setMenuOpen(false); }}
                        >
                          {u.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}

                {/* Rates info */}
                <div>
                  <Label className="text-xs text-muted-foreground">Tasas de cambio</Label>
                  <div className="mt-1.5 space-y-1.5">
                    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                      <span className="text-xs text-muted-foreground">BCV USD/VES</span>
                      <span className="text-sm font-bold">{rates?.bcv_usd ? fmtNum(rates.bcv_usd.rate) : '—'}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                      <span className="text-xs text-muted-foreground">Binance USDT</span>
                      <span className="text-sm font-bold">{rates?.binance_usdt ? fmtNum(rates.binance_usdt.rate) : '—'}</span>
                    </div>
                    <div className="flex items-center justify-between rounded-lg border px-3 py-2">
                      <span className="text-xs text-muted-foreground">BCV EUR/VES</span>
                      <span className="text-sm font-bold">{rates?.bcv_eur ? fmtNum(rates.bcv_eur.rate) : '—'}</span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="w-full mt-2 h-9"
                    onClick={onRefresh}
                    disabled={refreshing}
                  >
                    <RefreshCw size={14} className={`mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                    {refreshing ? 'Actualizando...' : 'Actualizar tasas'}
                  </Button>
                </div>

                <Separator />

                {/* Logout */}
                <Button variant="ghost" className="w-full justify-start text-rose-600 hover:text-rose-700 hover:bg-rose-50 h-11" onClick={() => { onLogout(); setMenuOpen(false); }}>
                  <LogOut size={16} className="mr-2" /> Cerrar sesión
                </Button>
              </div>
            </SheetContent>
          </Sheet>
        </div>
      </div>
    </header>
  );
}

function RatesPill({ rates, refreshing, onRefresh }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-slate-900 text-white px-3 py-1.5 text-xs">
      <span className="opacity-70">BCV</span>
      <span className="font-semibold">{rates?.bcv_usd ? fmtNum(rates.bcv_usd.rate) : '—'}</span>
      <Separator orientation="vertical" className="h-3 bg-white/20" />
      <span className="opacity-70">USDT</span>
      <span className="font-semibold">{rates?.binance_usdt ? fmtNum(rates.binance_usdt.rate) : '—'}</span>
      <button onClick={onRefresh} className="ml-1 opacity-70 hover:opacity-100">
        <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════
   DASHBOARD
   ══════════════════════════════════════════════ */
function DashboardView({ data, me, reload }) {
  const [settleOpen, setSettleOpen] = useState(false);
  if (!data) return <div className="py-12 text-center text-muted-foreground">Cargando dashboard...</div>;
  const { net, totals, budgets, rates } = data;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Net debt hero card */}
      {net && (
        <Card className="overflow-hidden border-0 bg-gradient-to-br from-indigo-600 via-purple-600 to-fuchsia-600 text-white shadow-xl">
          <CardContent className="p-4 sm:p-6">
            <div className="mb-2 flex items-center gap-2 text-white/80">
              <Snowflake size={14} />
              <span className="text-[11px] uppercase tracking-wider">Deuda neta actual</span>
            </div>
            {Number(net.amount_usd) < 0.01 ? (
              <div className="flex items-center gap-3">
                <CheckCircle2 size={24} />
                <div className="text-xl sm:text-2xl font-bold">Están al día · $0.00</div>
              </div>
            ) : (
              <>
                <div className="text-lg sm:text-2xl md:text-3xl font-bold leading-tight">
                  {net.from.name} le debe a {net.to.name}
                </div>
                <div className="mt-2 flex flex-wrap items-baseline gap-3">
                  <div>
                    <span className="text-3xl sm:text-4xl font-black">${fmtNum(net.amount_usd)}</span>
                    <span className="ml-1 text-white/70 text-sm">USD</span>
                  </div>
                  <div className="flex items-center gap-1 rounded-full bg-white/15 px-2.5 py-1 text-xs sm:text-sm">
                    <Coins size={12} /> {fmtNum(net.amount_usdt)} USDT
                  </div>
                </div>
                <div className="mt-3">
                  <Button
                    variant="secondary"
                    className="bg-white text-indigo-700 hover:bg-white/90 h-10 text-sm"
                    onClick={() => setSettleOpen(true)}
                  >
                    <HandCoins size={15} className="mr-1.5" /> Liquidar deuda
                  </Button>
                </div>
              </>
            )}
          </CardContent>
          <SettleDialog open={settleOpen} setOpen={setSettleOpen} net={net} onDone={reload} />
        </Card>
      )}

      {/* Stats grid */}
      <div className="grid grid-cols-2 gap-2 sm:gap-3 sm:grid-cols-4">
        <StatCard icon={<Users size={14} />} label="#Nos" value={`$${fmtNum(totals?.total_nos)}`} color="indigo" />
        <StatCard icon={<DollarSign size={14} />} label="#Mio" value={`$${fmtNum(totals?.total_mio)}`} color="slate" />
        <StatCard icon={<Snowflake size={14} />} label="USDT" value={`${fmtNum(totals?.total_prestamo_usdt)} ₮`} color="fuchsia" />
        <StatCard icon={<Receipt size={14} />} label="Transacciones" value={totals?.n || 0} color="emerald" />
      </div>

      {/* Budgets */}
      <Card>
        <CardHeader className="pb-2 px-4 sm:px-6">
          <CardTitle className="flex items-center gap-2 text-base">
            <PiggyBank size={16} /> Presupuestos
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 sm:px-6 pb-4">
          {budgets?.length === 0 && (
            <div className="text-sm text-muted-foreground py-4 text-center">Aún no hay presupuestos. Crea uno en Ajustes.</div>
          )}
          <div className="space-y-3">
            {budgets?.map(b => {
              const pct = b.pct || 0;
              const color = pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500';
              return (
                <div key={b.id}>
                  <div className="mb-1 flex items-center justify-between text-xs sm:text-sm">
                    <span className="font-medium truncate mr-2">
                      {b.category_icon} {b.category_name}
                      {!b.is_shared && <span className="text-muted-foreground"> (personal)</span>}
                    </span>
                    <span className="tabular-nums text-muted-foreground whitespace-nowrap">
                      ${fmtNum(b.spent_usd)} / ${fmtNum(b.monthly_limit_usd)}
                      <span className={`ml-1 ${pct > 90 ? 'text-rose-600 font-semibold' : pct > 75 ? 'text-amber-600 font-semibold' : ''}`}>
                        {pct.toFixed(0)}%
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                    <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Rates card */}
      <Card>
        <CardHeader className="pb-2 px-4 sm:px-6">
          <CardTitle className="flex items-center gap-2 text-base">
            <TrendingUp size={16} /> Tasas de cambio
          </CardTitle>
        </CardHeader>
        <CardContent className="px-4 sm:px-6 pb-4">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 sm:gap-3">
            <RateCard label="BCV · USD/VES" rate={rates?.bcv_usd?.rate} at={rates?.bcv_usd?.fetched_at} />
            <RateCard label="BCV · EUR/VES" rate={rates?.bcv_eur?.rate} at={rates?.bcv_eur?.fetched_at} />
            <RateCard label="Binance P2P" rate={rates?.binance_usdt?.rate} at={rates?.binance_usdt?.fetched_at} highlight />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, color }) {
  const colors = {
    indigo: 'bg-indigo-50 text-indigo-600',
    slate: 'bg-slate-50 text-slate-600',
    fuchsia: 'bg-fuchsia-50 text-fuchsia-600',
    emerald: 'bg-emerald-50 text-emerald-600',
  };
  return (
    <Card className="border-slate-200/60">
      <CardContent className="p-3 sm:p-4">
        <div className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] sm:text-[11px] font-medium ${colors[color]}`}>
          {icon}{label}
        </div>
        <div className="mt-1.5 text-lg sm:text-2xl font-bold tabular-nums">{value}</div>
      </CardContent>
    </Card>
  );
}

function RateCard({ label, rate, at, highlight }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-fuchsia-200 bg-fuchsia-50/50' : 'border-slate-200'}`}>
      <div className="text-[10px] sm:text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-lg sm:text-2xl font-bold tabular-nums">{rate ? fmtNum(rate, 4) : '—'}</div>
      {at && <div className="mt-0.5 text-[9px] sm:text-[10px] text-muted-foreground">{new Date(at).toLocaleString('es-VE')}</div>}
    </div>
  );
}

/* ══════════════════════════════════════════════
   NEW EXPENSE FORM
   ══════════════════════════════════════════════ */
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
      await api('/transactions', {
        method: 'POST',
        body: JSON.stringify({
          payer_id: me.id, type, original_amount: amount, original_currency: currency,
          applied_rate: rateOverride || undefined,
          beneficiary_id: type === 'PRESTAMO' ? beneficiary : null,
          category_id: categoryId || null, wallet_id: walletId || null, description,
        }),
      });
      toast.success('✅ Gasto registrado');
      setAmount(''); setDescription(''); setRateOverride('');
      await onSaved();
      onSwitchTab?.();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Card>
      <CardHeader className="px-4 sm:px-6 pb-2">
        <CardTitle className="text-base sm:text-lg">Registrar gasto</CardTitle>
        <CardDescription className="text-xs sm:text-sm">El sistema calcula automáticamente USD y USDT</CardDescription>
      </CardHeader>
      <CardContent className="px-4 sm:px-6 pb-4 space-y-4">
        {/* Type selector */}
        <div>
          <Label className="text-sm">Tipo</Label>
          <div className="mt-2 grid grid-cols-3 gap-1.5 sm:gap-2">
            {TX_TYPES.map(t => (
              <button
                key={t.code}
                onClick={() => setType(t.code)}
                className={`rounded-xl border p-2.5 sm:p-3 text-center transition-all ${
                  type === t.code
                    ? 'border-indigo-500 ring-2 ring-indigo-500/20 bg-indigo-50/50'
                    : 'border-slate-200 hover:border-slate-300 active:bg-slate-50'
                }`}
              >
                <div className="text-lg sm:text-xl">{t.icon}</div>
                <div className="font-semibold text-[11px] sm:text-xs mt-0.5">{t.label}</div>
                <div className="text-[9px] sm:text-[10px] text-muted-foreground mt-0.5 hidden sm:block">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Amount + Currency */}
        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="col-span-2">
            <Label className="text-sm">Monto</Label>
            <Input
              type="number"
              step="0.01"
              placeholder="0.00"
              value={amount}
              onChange={e => setAmount(e.target.value)}
              className="h-12 text-lg mt-1.5"
            />
          </div>
          <div>
            <Label className="text-sm">Moneda</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="h-12 mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(c => <SelectItem key={c} value={c}>{currencySymbol(c)} {c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Rate override */}
        {(currency === 'BS' || currency === 'EUR') && (
          <div className="rounded-lg bg-slate-50 p-3">
            <div className="text-xs text-muted-foreground">Tasa {currency}/USD</div>
            <div className="mt-1 flex flex-col sm:flex-row items-start sm:items-center gap-2">
              <div className="text-sm text-muted-foreground">BCV: <b className="text-slate-900">{fmtNum(suggestedRate, 4)}</b></div>
              <Input
                type="number"
                step="0.0001"
                placeholder="Sobrescribir..."
                value={rateOverride}
                onChange={e => setRateOverride(e.target.value)}
                className="max-w-full sm:max-w-[160px] h-9"
              />
            </div>
          </div>
        )}

        {/* Category + Wallet */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label className="text-sm">Categoría <span className="text-[10px] text-muted-foreground">· auto IA ✨</span></Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="h-11 mt-1.5"><SelectValue placeholder="Auto (IA)" /></SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Billetera <span className="text-[10px] text-muted-foreground">· opcional</span></Label>
            <Select value={walletId} onValueChange={setWalletId}>
              <SelectTrigger className="h-11 mt-1.5"><SelectValue placeholder="Ninguna" /></SelectTrigger>
              <SelectContent>
                {myWallets.map(w => <SelectItem key={w.id} value={w.id}>{w.name} ({w.currency})</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Beneficiary (for PRESTAMO) */}
        {type === 'PRESTAMO' && (
          <div>
            <Label className="text-sm">Beneficiario del préstamo</Label>
            <Select value={beneficiary} onValueChange={setBeneficiary}>
              <SelectTrigger className="h-11 mt-1.5"><SelectValue /></SelectTrigger>
              <SelectContent>
                {users.filter(u => u.id !== me?.id).map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Description */}
        <div>
          <Label className="text-sm">Descripción</Label>
          <Textarea
            placeholder="Ej: cena en La Estancia"
            value={description}
            onChange={e => setDescription(e.target.value)}
            rows={2}
            className="mt-1.5"
          />
        </div>

        {/* Preview */}
        <div className="rounded-xl border-2 border-dashed border-indigo-200 bg-gradient-to-br from-indigo-50/50 to-fuchsia-50/50 p-3 sm:p-4">
          <div className="text-[10px] sm:text-xs text-muted-foreground mb-1">Previsualización</div>
          <div className="flex flex-wrap items-baseline gap-3">
            <div>
              <span className="text-xl sm:text-2xl font-bold">${fmtNum(amountUsd)}</span>
              <span className="text-[10px] sm:text-xs text-muted-foreground ml-1">USD</span>
            </div>
            {type === 'PRESTAMO' && (
              <div className="flex items-center gap-1 rounded-full bg-fuchsia-500 text-white px-2.5 py-0.5 text-xs font-semibold">
                <Snowflake size={11} /> {fmtNum(amountUsdt)} USDT
              </div>
            )}
          </div>
          {type === 'NOS' && parseFloat(amount) > 0 && (
            <div className="mt-1 text-[10px] sm:text-xs text-muted-foreground">
              Cada uno aporta ${fmtNum(amountUsd / 2)}
            </div>
          )}
        </div>

        <Button
          className="h-12 w-full bg-gradient-to-r from-indigo-500 to-fuchsia-500 text-base font-semibold"
          disabled={saving}
          onClick={submit}
        >
          {saving ? (
            <><RefreshCw size={16} className="mr-2 animate-spin" /> Guardando...</>
          ) : (
            '💾 Registrar gasto'
          )}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════
   HISTORY
   ══════════════════════════════════════════════ */
function HistoryView({ transactions, onDelete }) {
  const typeColor = {
    NOS: 'bg-indigo-100 text-indigo-800',
    MIO: 'bg-slate-100 text-slate-800',
    PRESTAMO: 'bg-fuchsia-100 text-fuchsia-800',
  };

  return (
    <Card>
      <CardHeader className="px-4 sm:px-6 pb-2">
        <CardTitle className="text-base sm:text-lg">Historial</CardTitle>
        <CardDescription className="text-xs sm:text-sm">Últimas 50 operaciones</CardDescription>
      </CardHeader>
      <CardContent className="px-4 sm:px-6 pb-4">
        {transactions.length === 0 && (
          <div className="text-sm text-muted-foreground py-12 text-center">
            <Receipt size={32} className="mx-auto mb-2 opacity-30" />
            No hay transacciones aún
          </div>
        )}
        <div className="divide-y">
          {transactions.map(t => (
            <div key={t.id} className="py-3">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2.5 min-w-0 flex-1">
                  <div className="text-xl sm:text-2xl mt-0.5 shrink-0">{t.category_icon || '💰'}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <Badge className={`${typeColor[t.type]} text-[10px] px-1.5 py-0`}>#{t.type?.toLowerCase()}</Badge>
                      <span className="font-semibold text-sm truncate">{t.description || t.category_name || 'Sin descripción'}</span>
                    </div>
                    <div className="text-[10px] sm:text-xs text-muted-foreground mt-0.5">
                      <b>{t.payer_name}</b>{t.beneficiary_name ? ` → ${t.beneficiary_name}` : ''} · {new Date(t.transaction_date).toLocaleDateString('es-VE')}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="text-right">
                    <div className="font-bold text-sm tabular-nums">
                      {currencySymbol(t.original_currency)} {fmtNum(t.original_amount)}
                    </div>
                    <div className="text-[10px] text-muted-foreground tabular-nums">
                      ${fmtNum(t.amount_usd)}{t.amount_usdt ? ` · ${fmtNum(t.amount_usdt)}₮` : ''}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => onDelete(t.id)}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════
   CONFIG
   ══════════════════════════════════════════════ */
function ConfigView({ users, wallets, categories, budgets, reload }) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <TelegramSection users={users} reload={reload} />
      <div className="grid gap-3 sm:gap-4 grid-cols-1 md:grid-cols-2">
        <WalletsSection users={users} wallets={wallets} reload={reload} />
        <BudgetsSection categories={categories} users={users} budgets={budgets} reload={reload} />
      </div>
    </div>
  );
}

function TelegramSection({ users, reload }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api('/telegram/status').then(setStatus).catch(() => {}); }, []);
  const botLink = 'https://t.me/Finanzas_ParejaJM_Bot';
  const bound = users.filter(u => u.telegram_chat_id);
  const setupWebhook = async () => {
    setBusy(true);
    try {
      await api('/telegram/setup', { method: 'POST' });
      toast.success('Webhook activado');
      const s = await api('/telegram/status');
      setStatus(s);
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  const unbind = async (uid) => {
    await api('/telegram/unbind', { method: 'POST', body: JSON.stringify({ user_id: uid }) });
    toast.success('Desvinculado');
    await reload();
  };

  return (
    <Card>
      <CardHeader className="px-4 sm:px-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <CardTitle className="flex items-center gap-2 text-base">
              <Send size={16} /> Bot de Telegram
            </CardTitle>
            <CardDescription className="text-xs sm:text-sm mt-1">
              Registra gastos por chat, voz o foto
            </CardDescription>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            {status?.info?.url
              ? <Badge className="bg-emerald-100 text-emerald-800 text-[10px]">Webhook activo</Badge>
              : <Badge variant="outline" className="text-[10px]">Sin webhook</Badge>
            }
            <Button size="sm" variant="outline" onClick={setupWebhook} disabled={busy} className="h-8 text-xs">
              {busy ? 'Configurando...' : 'Activar'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="px-4 sm:px-6 pb-4 space-y-3">
        {/* How to link */}
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/50 p-3">
          <div className="text-xs font-semibold mb-1">📲 Cómo vincularse</div>
          <ol className="list-decimal list-inside text-xs space-y-0.5 text-slate-700">
            <li>Abrir: <a href={botLink} target="_blank" rel="noreferrer" className="text-indigo-600 underline font-medium">@Finanzas_ParejaJM_Bot</a></li>
            <li>Enviar <code className="bg-white px-1 py-0.5 rounded text-[10px]">/start</code></li>
            <li>Tocar tu nombre</li>
          </ol>
        </div>

        {/* Syntax */}
        <div className="rounded-lg border p-3 text-xs">
          <div className="font-medium mb-1.5">✍️ Sintaxis rápida</div>
          <div className="space-y-0.5 text-slate-600 text-[11px] font-mono">
            <div><b>30$ cena #Nos J</b></div>
            <div><b>5000 bs comida #Mio</b></div>
            <div><b>15 usd hotel #Prestamo J</b></div>
            <div>🎤 Nota de voz · 📷 Foto OCR</div>
          </div>
        </div>

        {/* Bindings */}
        <div>
          <div className="text-xs font-medium mb-1.5">Vinculaciones</div>
          {bound.length === 0 && <div className="text-[11px] text-muted-foreground">Nadie vinculado. Envía /start al bot.</div>}
          <div className="space-y-1">
            {bound.map(u => (
              <div key={u.id} className="flex items-center justify-between rounded border px-3 py-2 text-xs">
                <span>✅ <b>{u.name}</b></span>
                <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => unbind(u.id)}>Desvincular</Button>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function SettleDialog({ open, setOpen, net, onDone }) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  if (!net) return null;
  const submit = async () => {
    setSaving(true);
    try {
      await api('/settlements', {
        method: 'POST',
        body: JSON.stringify({
          payer_id: net.from.id, receiver_id: net.to.id, amount_usd: net.amount_usd, notes,
        }),
      });
      toast.success('✨ Deuda liquidada');
      setOpen(false); setNotes('');
      await onDone();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md rounded-xl">
        <DialogHeader><DialogTitle>Liquidar deuda</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg bg-gradient-to-br from-indigo-50 to-fuchsia-50 border p-4 text-center">
            <div className="text-xs text-muted-foreground">{net.from.name} le paga a {net.to.name}</div>
            <div className="text-3xl font-black mt-1">${fmtNum(net.amount_usd)}</div>
            <div className="text-xs text-fuchsia-600 mt-1">≈ {fmtNum(net.amount_usdt)} USDT</div>
          </div>
          <div>
            <Label>Notas (opcional)</Label>
            <Textarea placeholder="Ej: Transferencia Binance" value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1.5" />
          </div>
        </div>
        <DialogFooter className="flex-col sm:flex-row gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button className="bg-gradient-to-r from-indigo-500 to-fuchsia-500" disabled={saving} onClick={submit}>
            {saving ? 'Liquidando...' : '💸 Confirmar'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function WalletsSection({ users, wallets, reload }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ user_id: '', name: '', currency: 'USD', account_type: 'BANK', current_balance: 0 });
  async function submit() {
    try {
      await api('/wallets', { method: 'POST', body: JSON.stringify(form) });
      toast.success('Billetera creada');
      setOpen(false);
      setForm({ user_id: '', name: '', currency: 'USD', account_type: 'BANK', current_balance: 0 });
      await reload();
    } catch (e) { toast.error(e.message); }
  }
  async function del(id) {
    await api('/wallets/' + id, { method: 'DELETE' });
    toast.success('Eliminada');
    await reload();
  }
  return (
    <Card>
      <CardHeader className="px-4 sm:px-6 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Wallet size={16} /> Billeteras</CardTitle>
          <CardDescription className="text-xs">Bancos y cuentas</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8"><Plus size={14} className="mr-1" /> Nueva</Button>
          </DialogTrigger>
          <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md rounded-xl">
            <DialogHeader><DialogTitle>Nueva billetera</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-sm">Dueño</Label>
                <Select value={form.user_id} onValueChange={v => setForm({ ...form, user_id: v })}>
                  <SelectTrigger className="h-11 mt-1"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                  <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">Nombre</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ej: Banesco" className="h-11 mt-1" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-sm">Tipo</Label>
                  <Select value={form.account_type} onValueChange={v => setForm({ ...form, account_type: v })}>
                    <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="BANK">Banco</SelectItem>
                      <SelectItem value="PAYMENT_GATEWAY">Pago Móvil</SelectItem>
                      <SelectItem value="CASH">Efectivo</SelectItem>
                      <SelectItem value="CREDIT">Crédito</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm">Moneda</Label>
                  <Select value={form.currency} onValueChange={v => setForm({ ...form, currency: v })}>
                    <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-sm">Saldo inicial</Label>
                <Input type="number" step="0.01" value={form.current_balance} onChange={e => setForm({ ...form, current_balance: e.target.value })} className="h-11 mt-1" />
              </div>
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button onClick={submit} className="h-11">Crear</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="px-4 sm:px-6 pb-4">
        {wallets.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">Aún no hay billeteras</div>}
        <div className="divide-y">
          {wallets.map(w => (
            <div key={w.id} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{w.name} <Badge variant="secondary" className="ml-1 text-[10px]">{w.currency}</Badge></div>
                <div className="text-[10px] sm:text-xs text-muted-foreground">{w.user_name || users.find(u => u.id === w.user_id)?.name} · {w.account_type}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="text-sm font-semibold tabular-nums">{fmtNum(w.current_balance)}</div>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => del(w.id)}><Trash2 size={13} /></Button>
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
    try {
      await api('/budgets', { method: 'POST', body: JSON.stringify(form) });
      toast.success('Presupuesto guardado');
      setOpen(false);
      await reload();
    } catch (e) { toast.error(e.message); }
  }
  async function del(id) {
    await api('/budgets/' + id, { method: 'DELETE' });
    toast.success('Eliminado');
    await reload();
  }
  return (
    <Card>
      <CardHeader className="px-4 sm:px-6 flex flex-row items-center justify-between">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><PiggyBank size={16} /> Presupuestos</CardTitle>
          <CardDescription className="text-xs">Límites mensuales</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8"><Plus size={14} className="mr-1" /> Nuevo</Button>
          </DialogTrigger>
          <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md rounded-xl">
            <DialogHeader><DialogTitle>Nuevo presupuesto</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-sm">Categoría</Label>
                <Select value={form.category_id} onValueChange={v => setForm({ ...form, category_id: v })}>
                  <SelectTrigger className="h-11 mt-1"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                  <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">Límite mensual (USD)</Label>
                <Input type="number" step="0.01" value={form.monthly_limit_usd} onChange={e => setForm({ ...form, monthly_limit_usd: e.target.value })} placeholder="300" className="h-11 mt-1" />
              </div>
              <div>
                <Label className="text-sm">Alcance</Label>
                <Select value={form.is_shared ? 'shared' : 'personal'} onValueChange={v => setForm({ ...form, is_shared: v === 'shared', user_id: v === 'shared' ? '' : form.user_id })}>
                  <SelectTrigger className="h-11 mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shared">Compartido (#Nos)</SelectItem>
                    <SelectItem value="personal">Personal (#Mio)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!form.is_shared && (
                <div>
                  <Label className="text-sm">Usuario</Label>
                  <Select value={form.user_id} onValueChange={v => setForm({ ...form, user_id: v })}>
                    <SelectTrigger className="h-11 mt-1"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                    <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter className="flex-col sm:flex-row gap-2">
              <Button onClick={submit} className="h-11">Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="px-4 sm:px-6 pb-4">
        {budgets.length === 0 && <div className="text-xs text-muted-foreground text-center py-4">Aún no hay presupuestos</div>}
        <div className="divide-y">
          {budgets.map(b => (
            <div key={b.id} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <div className="font-medium text-sm truncate">{b.category_icon} {b.category_name}{!b.is_shared && ` · ${b.user_name}`}</div>
                <div className="text-[10px] sm:text-xs text-muted-foreground">{b.is_shared ? 'Compartido' : 'Personal'}</div>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <div className="text-sm font-semibold tabular-nums">${fmtNum(b.monthly_limit_usd)}</div>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => del(b.id)}><Trash2 size={13} /></Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
