'use client';

import { useEffect, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from '@/components/ui/sheet';
import { toast } from 'sonner';
import {
  ArrowRight, RefreshCw, Wallet, Users, TrendingUp, Trash2,
  Sparkles, DollarSign, Coins, Receipt, PiggyBank, Snowflake,
  HandCoins, CheckCircle2, LogOut, Lock, LayoutDashboard, PlusCircle,
  Clock, Settings, Eye, EyeOff, Menu, FileText, ChevronRight,
} from 'lucide-react';
import { api, CURRENCIES, TX_TYPES, currencySymbol, fmtNum, initials } from '@/lib/ui';
import ConfigView from '@/components/app/config';

const NAV_ITEMS = [
  { key: 'dashboard', label: 'Inicio', icon: LayoutDashboard },
  { key: 'new', label: 'Nuevo', icon: PlusCircle },
  { key: 'history', label: 'Historial', icon: Clock },
  { key: 'config', label: 'Ajustes', icon: Settings },
];

/* ══════════════════════════════════════════════
   AUTH GATE — Google primero, PIN como respaldo
   ══════════════════════════════════════════════ */
function AuthGate({ status, onAuthed }) {
  const [pin, setPin] = useState('');
  const [pin2, setPin2] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPin, setShowPin] = useState(false);
  const [showPinForm, setShowPinForm] = useState(!status.google_enabled);
  const pinSet = status.pin_set;

  async function submit() {
    if (!pin || pin.trim().length < 4) { toast.error('El PIN debe tener al menos 4 caracteres'); return; }
    if (!pinSet && pin !== pin2) { toast.error('Los PIN no coinciden'); return; }
    setLoading(true);
    try {
      await api(pinSet ? '/auth/login' : '/auth/setup', { method: 'POST', body: JSON.stringify({ pin }) });
      toast.success(pinSet ? 'Bienvenido de nuevo' : 'PIN creado con éxito');
      await onAuthed();
    } catch (e) { toast.error(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-stone-100 via-stone-50 to-emerald-50 px-4 py-8">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center">
          <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-500 p-4 text-white shadow-lg shadow-emerald-600/20">
            <Wallet size={32} />
          </div>
          <h1 className="mt-4 text-xl font-bold text-stone-900">NuestrasFinanzas</h1>
          <p className="text-sm text-stone-500">Control compartido de gastos</p>
        </div>

        <Card className="border-stone-200/70 shadow-xl shadow-stone-200/50">
          <CardHeader className="pb-4">
            <CardTitle className="text-center text-lg text-stone-900">
              {status.google_enabled && !showPinForm ? 'Inicia sesión' : (pinSet ? 'Ingresa tu PIN' : 'Crea un PIN de acceso')}
            </CardTitle>
            <CardDescription className="text-center text-sm">
              {status.google_enabled && !showPinForm
                ? 'Entra con tu cuenta de Google'
                : (pinSet ? 'Introduce la clave compartida para entrar' : 'Protege tus finanzas con una clave compartida')}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {status.google_enabled && (
              <>
                <a href="/api/auth/google/start" className="block">
                  <Button variant="outline" className="h-12 w-full gap-2 border-stone-300 text-base font-medium">
                    <GoogleMark /> Continuar con Google
                  </Button>
                </a>
                {!showPinForm && (
                  <button
                    className="w-full text-center text-xs text-stone-500 underline underline-offset-4 hover:text-stone-700"
                    onClick={() => setShowPinForm(true)}
                  >
                    Prefiero usar el PIN
                  </button>
                )}
                {showPinForm && (
                  <div className="flex items-center gap-3 py-1">
                    <Separator className="flex-1" />
                    <span className="text-[10px] uppercase tracking-wider text-stone-400">o con PIN</span>
                    <Separator className="flex-1" />
                  </div>
                )}
              </>
            )}

            {showPinForm && (
              <>
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
                      className="h-12 pr-12 text-center text-lg tracking-[0.3em]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPin(!showPin)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-stone-400 hover:text-stone-600"
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
                  className="h-12 w-full bg-emerald-600 text-base font-semibold hover:bg-emerald-700"
                  onClick={submit}
                  disabled={loading}
                >
                  {loading ? <RefreshCw size={18} className="mr-2 animate-spin" /> : <Lock size={18} className="mr-2" />}
                  {loading ? 'Un momento...' : (pinSet ? 'Entrar' : 'Crear PIN y entrar')}
                </Button>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.6l6.7-6.7C35.6 2.6 30.2 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.8 6.1C12.3 13.2 17.6 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.2-.4-4.6H24v9.1h12.4c-.5 2.9-2.1 5.3-4.6 6.9l7.1 5.5c4.2-3.9 6.6-9.6 6.6-16.9z" />
      <path fill="#FBBC05" d="M10.4 28.7c-.5-1.5-.8-3-.8-4.7s.3-3.2.8-4.7l-7.8-6.1C1 16.3 0 20 0 24s1 7.7 2.6 10.8l7.8-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.1-5.5c-2 1.3-4.6 2.1-8.8 2.1-6.4 0-11.7-3.7-13.6-8.8l-7.8 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
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
      if (!us || us.length === 0) { setNeedsOnboard(true); setReady(true); return; }
      setUsers(us);
      const savedMe = typeof window !== 'undefined' ? localStorage.getItem('me_id') : null;
      const meUser = us.find(u => u.id === st.user_id) || us.find(u => u.id === savedMe) || us[0];
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
    setAuthStatus({ ...(authStatus || {}), authenticated: false });
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
    const [d, tx, c, w, b, r, us] = await Promise.all([
      api('/dashboard'), api('/transactions?limit=50'), api('/categories'),
      api('/wallets'), api('/budgets'), api('/rates'), api('/users'),
    ]);
    setDashboard(d); setTransactions(tx); setCategories(c);
    setWallets(w); setBudgets(b); setRates(r); setUsers(us);
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

  if (!ready) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-stone-50">
        <div className="flex flex-col items-center gap-3">
          <div className="animate-pulse rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-500 p-3 text-white">
            <Wallet size={24} />
          </div>
          <span className="text-sm text-stone-500">Cargando...</span>
        </div>
      </div>
    );
  }

  if (authStatus && !authStatus.authenticated) {
    return <AuthGate status={authStatus} onAuthed={async () => { setReady(false); await boot(); }} />;
  }

  if (needsOnboard) {
    return (
      <div className="flex min-h-[100dvh] items-center justify-center bg-gradient-to-br from-stone-100 via-stone-50 to-emerald-50 px-4 py-8">
        <Card className="w-full max-w-md border-stone-200/70 shadow-xl">
          <CardHeader>
            <div className="mb-2 flex justify-center">
              <div className="rounded-2xl bg-gradient-to-br from-emerald-600 to-emerald-500 p-3 text-white">
                <Sparkles size={28} />
              </div>
            </div>
            <CardTitle className="text-center text-2xl">Bienvenidos</CardTitle>
            <CardDescription className="text-center">Configura tu espacio financiero</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label>¿Cómo van a usarla?</Label>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <Button variant={mode === 'couple' ? 'default' : 'outline'} className={`h-12 ${mode === 'couple' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`} onClick={() => setMode('couple')}>👫 Pareja</Button>
                <Button variant={mode === 'single' ? 'default' : 'outline'} className={`h-12 ${mode === 'single' ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`} onClick={() => setMode('single')}>🧑 Individual</Button>
              </div>
              <p className="mt-2 text-[11px] text-stone-500">Podrás sumar más miembros después desde Ajustes.</p>
            </div>
            <div>
              <Label>{mode === 'couple' ? 'Nombre 1' : 'Tu nombre'}</Label>
              <Input value={name1} onChange={e => setName1(e.target.value)} className="mt-1.5 h-12" />
            </div>
            {mode === 'couple' && (
              <div>
                <Label>Nombre 2</Label>
                <Input value={name2} onChange={e => setName2(e.target.value)} className="mt-1.5 h-12" />
              </div>
            )}
            <Button className="h-12 w-full bg-emerald-600 text-base hover:bg-emerald-700" onClick={completeOnboard}>
              Empezar <ArrowRight className="ml-2" size={18} />
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] bg-gradient-to-br from-stone-100 via-stone-50 to-emerald-50/40 pb-20 md:pb-6">
      <AppHeader
        users={users} me={me} switchMe={switchMe} rates={rates}
        refreshing={refreshing} onRefresh={refreshRates} onLogout={logout}
        authStatus={authStatus}
      />

      <main className="mx-auto max-w-6xl px-3 pt-3 sm:px-4 sm:pt-4">
        <div className="mb-4 hidden items-center gap-1 rounded-xl border border-stone-200/70 bg-white/70 p-1 backdrop-blur-xl md:flex">
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium transition-all ${
                  active ? 'bg-emerald-600 text-white shadow-sm' : 'text-stone-600 hover:bg-stone-100'
                }`}
              >
                <Icon size={16} />{item.label}
              </button>
            );
          })}
        </div>

        <div className="animate-in fade-in duration-200">
          {tab === 'dashboard' && <DashboardView data={dashboard} me={me} reload={loadAll} onGoTo={setTab} />}
          {tab === 'new' && (
            <NewExpenseForm
              me={me} users={users} categories={categories} wallets={wallets} rates={rates}
              onSaved={loadAll} onSwitchTab={() => setTab('history')}
            />
          )}
          {tab === 'history' && (
            <HistoryView
              transactions={transactions}
              onDelete={async (id) => {
                await api('/transactions/' + id, { method: 'DELETE' });
                toast.success('Eliminado · saldo devuelto a la billetera');
                await loadAll();
              }}
            />
          )}
          {tab === 'config' && (
            <ConfigView
              users={users} wallets={wallets} categories={categories}
              budgets={budgets} authStatus={authStatus} reload={loadAll}
            />
          )}
        </div>
      </main>

      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-50 border-t border-stone-200/70 bg-white/80 backdrop-blur-xl md:hidden">
        <div className="flex items-stretch" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {NAV_ITEMS.map(item => {
            const Icon = item.icon;
            const active = tab === item.key;
            return (
              <button
                key={item.key}
                onClick={() => setTab(item.key)}
                className={`flex flex-1 flex-col items-center justify-center gap-0.5 py-2 transition-colors ${
                  active ? 'text-emerald-700' : 'text-stone-400'
                }`}
              >
                <div className={`rounded-xl p-1.5 transition-all ${active ? 'bg-emerald-50' : ''}`}>
                  <Icon size={20} strokeWidth={active ? 2.5 : 1.5} />
                </div>
                <span className={`text-[10px] font-medium ${active ? 'text-emerald-700' : 'text-stone-500'}`}>
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
   HEADER
   ══════════════════════════════════════════════ */
function AppHeader({ users, me, switchMe, rates, refreshing, onRefresh, onLogout, authStatus }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const activeUsers = users.filter(u => u.is_active !== false);

  return (
    <header className="sticky top-0 z-40 border-b border-stone-200/70 bg-white/70 backdrop-blur-xl">
      <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-3 sm:px-4">
        <div className="flex items-center gap-2.5">
          <div className="rounded-xl bg-gradient-to-br from-emerald-600 to-emerald-500 p-1.5 text-white">
            <Wallet size={18} />
          </div>
          <div className="hidden sm:block">
            <div className="text-sm font-bold leading-tight text-stone-900">NuestrasFinanzas</div>
            <div className="text-[10px] text-stone-500">Multi-moneda + USDT</div>
          </div>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <RatesPill rates={rates} refreshing={refreshing} onRefresh={onRefresh} />
          {activeUsers.length > 1 && (
            <Select value={me?.id} onValueChange={switchMe}>
              <SelectTrigger className="h-9 w-[140px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {activeUsers.map(u => <SelectItem key={u.id} value={u.id}>👤 {u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button variant="ghost" size="icon" className="h-9 w-9" title="Cerrar sesión" onClick={onLogout}>
            <LogOut size={16} />
          </Button>
        </div>

        <div className="flex items-center gap-1.5 md:hidden">
          {rates?.bcv_usd?.rate && (
            <button onClick={onRefresh} className="flex items-center gap-1 rounded-full bg-stone-900 px-2.5 py-1 text-[10px] text-white">
              <span className="opacity-70">BCV</span>
              <span className="font-bold">{fmtNum(rates.bcv_usd.rate, 0)}</span>
              <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
            </button>
          )}
          <Sheet open={menuOpen} onOpenChange={setMenuOpen}>
            <SheetTrigger asChild>
              <Button variant="ghost" size="icon" className="h-9 w-9"><Menu size={20} /></Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-72 p-0">
              <SheetHeader className="border-b bg-gradient-to-br from-stone-100 to-emerald-50 p-4 pb-2">
                <SheetTitle className="text-base">NuestrasFinanzas</SheetTitle>
              </SheetHeader>
              <div className="space-y-4 p-4">
                {me && (
                  <div className="rounded-lg bg-emerald-50 p-3">
                    <div className="mb-1 text-xs text-stone-500">Registrando como:</div>
                    <div className="font-semibold text-emerald-800">👤 {me.name}</div>
                    {authStatus?.email && <div className="mt-0.5 text-[11px] text-stone-500">{authStatus.email}</div>}
                  </div>
                )}
                {activeUsers.length > 1 && (
                  <div>
                    <Label className="text-xs text-stone-500">Cambiar miembro</Label>
                    <div className="mt-1.5 grid grid-cols-2 gap-2">
                      {activeUsers.map(u => (
                        <Button
                          key={u.id}
                          variant={u.id === me?.id ? 'default' : 'outline'}
                          size="sm"
                          className={`h-10 ${u.id === me?.id ? 'bg-emerald-600 hover:bg-emerald-700' : ''}`}
                          onClick={() => { switchMe(u.id); setMenuOpen(false); }}
                        >
                          {u.name}
                        </Button>
                      ))}
                    </div>
                  </div>
                )}
                <div>
                  <Label className="text-xs text-stone-500">Tasas de cambio</Label>
                  <div className="mt-1.5 space-y-1.5">
                    <RateRow label="BCV USD/VES" value={rates?.bcv_usd?.rate} />
                    <RateRow label="Binance USDT" value={rates?.binance_usdt?.rate} />
                    {rates?.bcv_eur?.rate ? <RateRow label="BCV EUR/VES" value={rates.bcv_eur.rate} /> : null}
                  </div>
                  <Button variant="outline" size="sm" className="mt-2 h-9 w-full" onClick={onRefresh} disabled={refreshing}>
                    <RefreshCw size={14} className={`mr-2 ${refreshing ? 'animate-spin' : ''}`} />
                    {refreshing ? 'Actualizando...' : 'Actualizar tasas'}
                  </Button>
                </div>
                <Separator />
                <Button variant="ghost" className="h-11 w-full justify-start text-rose-600 hover:bg-rose-50 hover:text-rose-700" onClick={() => { onLogout(); setMenuOpen(false); }}>
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

function RateRow({ label, value }) {
  return (
    <div className="flex items-center justify-between rounded-lg border border-stone-200 px-3 py-2">
      <span className="text-xs text-stone-500">{label}</span>
      <span className="text-sm font-bold tabular-nums">{value ? fmtNum(value) : '—'}</span>
    </div>
  );
}

function RatesPill({ rates, refreshing, onRefresh }) {
  return (
    <div className="flex items-center gap-2 rounded-full bg-stone-900 px-3 py-1.5 text-xs text-white">
      <span className="opacity-70">BCV</span>
      <span className="font-semibold tabular-nums">{rates?.bcv_usd ? fmtNum(rates.bcv_usd.rate) : '—'}</span>
      <Separator orientation="vertical" className="h-3 bg-white/20" />
      <span className="opacity-70">USDT</span>
      <span className="font-semibold tabular-nums">{rates?.binance_usdt ? fmtNum(rates.binance_usdt.rate) : '—'}</span>
      {rates?.bcv_eur?.rate ? (
        <>
          <Separator orientation="vertical" className="h-3 bg-white/20" />
          <span className="opacity-70">EUR</span>
          <span className="font-semibold tabular-nums">{fmtNum(rates.bcv_eur.rate)}</span>
        </>
      ) : null}
      <button onClick={onRefresh} className="ml-1 opacity-70 hover:opacity-100">
        <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
      </button>
    </div>
  );
}

/* ══════════════════════════════════════════════
   DASHBOARD
   ══════════════════════════════════════════════ */
function DashboardView({ data, me, reload, onGoTo }) {
  const [settle, setSettle] = useState(null);
  if (!data) return <div className="py-12 text-center text-stone-500">Cargando dashboard...</div>;
  const { totals, budgets, rates, per_user: perUser = [], transfers = [], month } = data;
  const settled = !transfers.length;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/* Deudas — soporta 2 o N miembros */}
      <Card className="overflow-hidden border-0 bg-gradient-to-br from-stone-800 via-stone-800 to-emerald-800 text-white shadow-xl">
        <CardContent className="p-4 sm:p-6">
          <div className="mb-2 flex items-center gap-2 text-white/70">
            <HandCoins size={14} />
            <span className="text-[11px] uppercase tracking-wider">Cuentas entre nosotros</span>
          </div>
          {settled ? (
            <div className="flex items-center gap-3">
              <CheckCircle2 size={24} className="text-emerald-300" />
              <div className="text-xl font-bold sm:text-2xl">Están al día · $0.00</div>
            </div>
          ) : (
            <div className="space-y-3">
              {transfers.map((t, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-white/10 p-3">
                  <div>
                    <div className="text-sm font-semibold sm:text-base">
                      {t.from.name} <span className="text-white/60">le debe a</span> {t.to.name}
                    </div>
                    <div className="mt-1 flex items-baseline gap-2">
                      <span className="text-2xl font-black tabular-nums sm:text-3xl">${fmtNum(t.amount_usd)}</span>
                      {t.amount_usdt && (
                        <span className="flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px]">
                          <Coins size={11} /> {fmtNum(t.amount_usdt)} ₮
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="secondary"
                    className="h-10 bg-white text-sm text-emerald-800 hover:bg-white/90"
                    onClick={() => setSettle(t)}
                  >
                    <HandCoins size={15} className="mr-1.5" /> Liquidar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
        <SettleDialog transfer={settle} onClose={() => setSettle(null)} onDone={reload} />
      </Card>

      {/* Totales del mes */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 sm:gap-3">
        <StatCard icon={<Users size={14} />} label="#Nos" value={`$${fmtNum(totals?.total_nos)}`} tone="emerald" />
        <StatCard icon={<DollarSign size={14} />} label="#Mio" value={`$${fmtNum(totals?.total_mio)}`} tone="stone" />
        <StatCard icon={<Snowflake size={14} />} label="USDT congelado" value={`${fmtNum(totals?.total_prestamo_usdt)} ₮`} tone="teal" />
        <StatCard icon={<Receipt size={14} />} label="Movimientos" value={totals?.n || 0} tone="amber" />
      </div>

      {/* #Mio por persona */}
      <Card className="border-stone-200/70">
        <CardHeader className="px-4 pb-2 sm:px-6">
          <CardTitle className="flex items-center gap-2 text-base">
            <Users size={16} /> Gasto por persona
          </CardTitle>
          <CardDescription className="text-xs">
            Lo personal (#Mio) y la parte que le toca de lo compartido, este mes
          </CardDescription>
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6">
          <div className="grid gap-2 sm:grid-cols-2">
            {perUser.map(p => (
              <div key={p.user.id} className={`rounded-xl border p-3 ${p.user.id === me?.id ? 'border-emerald-300 bg-emerald-50/40' : 'border-stone-200'}`}>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold text-white"
                      style={{ background: p.user.color || '#0f766e' }}
                    >
                      {initials(p.user)}
                    </span>
                    <span className="text-sm font-semibold text-stone-900">{p.user.name}</span>
                    {p.user.is_active === false && <Badge variant="outline" className="text-[9px]">inactivo</Badge>}
                  </div>
                  <div className="text-right">
                    <div className="text-base font-bold tabular-nums">${fmtNum(p.total_usd)}</div>
                    <div className="text-[10px] text-stone-500">total del mes</div>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2 text-[11px]">
                  <div className="rounded-lg bg-stone-50 px-2 py-1.5">
                    <div className="text-stone-500">#Mio {p.user.short || ''}</div>
                    <div className="font-semibold tabular-nums text-stone-900">${fmtNum(p.mio_usd)}</div>
                  </div>
                  <div className="rounded-lg bg-stone-50 px-2 py-1.5">
                    <div className="text-stone-500">Su parte de #Nos</div>
                    <div className="font-semibold tabular-nums text-stone-900">${fmtNum(p.nos_share_usd)}</div>
                  </div>
                </div>
                <div className="mt-2 flex items-center justify-between text-[11px]">
                  <span className="text-stone-500">Puso este mes: <b className="tabular-nums text-stone-700">${fmtNum(p.paid_usd)}</b></span>
                  <span className={Number(p.net_usd) >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                    {Number(p.net_usd) >= 0 ? 'le deben ' : 'debe '}
                    <b className="tabular-nums">${fmtNum(Math.abs(Number(p.net_usd)))}</b>
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Presupuestos */}
      <Card className="border-stone-200/70">
        <CardHeader className="px-4 pb-2 sm:px-6">
          <CardTitle className="flex items-center gap-2 text-base"><PiggyBank size={16} /> Presupuestos</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6">
          {budgets?.length === 0 && (
            <div className="py-4 text-center text-sm text-stone-500">Aún no hay presupuestos. Crea uno en Ajustes.</div>
          )}
          <div className="space-y-3">
            {budgets?.map(b => {
              const pct = b.pct || 0;
              const color = pct > 90 ? 'bg-rose-500' : pct > 75 ? 'bg-amber-500' : 'bg-emerald-500';
              return (
                <div key={b.id}>
                  <div className="mb-1 flex items-center justify-between text-xs sm:text-sm">
                    <span className="mr-2 truncate font-medium">
                      {b.category_icon} {b.category_name}
                      {!b.is_shared && <span className="text-stone-500"> (personal)</span>}
                    </span>
                    <span className="whitespace-nowrap tabular-nums text-stone-500">
                      ${fmtNum(b.spent_usd)} / ${fmtNum(b.monthly_limit_usd)}
                      <span className={`ml-1 ${pct > 90 ? 'font-semibold text-rose-600' : pct > 75 ? 'font-semibold text-amber-600' : ''}`}>
                        {pct.toFixed(0)}%
                      </span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-stone-100">
                    <div className={`h-full ${color} transition-all`} style={{ width: `${Math.min(100, pct)}%` }} />
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Informe mensual */}
      <a href={`/reporte?month=${month}`} className="block">
        <Card className="border-stone-200/70 transition-colors hover:border-emerald-300">
          <CardContent className="flex items-center justify-between p-4">
            <div className="flex items-center gap-3">
              <div className="rounded-xl bg-emerald-50 p-2 text-emerald-700"><FileText size={18} /></div>
              <div>
                <div className="text-sm font-semibold text-stone-900">Informe mensual</div>
                <div className="text-[11px] text-stone-500">Resumen por categoría y USDT congelado · listo para PDF</div>
              </div>
            </div>
            <ChevronRight size={18} className="text-stone-400" />
          </CardContent>
        </Card>
      </a>

      {/* Tasas */}
      <Card className="border-stone-200/70">
        <CardHeader className="px-4 pb-2 sm:px-6">
          <CardTitle className="flex items-center gap-2 text-base"><TrendingUp size={16} /> Tasas de cambio</CardTitle>
        </CardHeader>
        <CardContent className="px-4 pb-4 sm:px-6">
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3 sm:gap-3">
            <RateCard label="BCV · USD/VES" rate={rates?.bcv_usd?.rate} at={rates?.bcv_usd?.fetched_at} />
            {rates?.bcv_eur?.rate ? (
              <RateCard label="BCV · EUR/VES" rate={rates.bcv_eur.rate} at={rates.bcv_eur.fetched_at} />
            ) : null}
            <RateCard label="Binance P2P · USDT" rate={rates?.binance_usdt?.rate} at={rates?.binance_usdt?.fetched_at} highlight />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ icon, label, value, tone }) {
  const tones = {
    emerald: 'bg-emerald-50 text-emerald-700',
    stone: 'bg-stone-100 text-stone-600',
    teal: 'bg-teal-50 text-teal-700',
    amber: 'bg-amber-50 text-amber-700',
  };
  return (
    <Card className="border-stone-200/70">
      <CardContent className="p-3 sm:p-4">
        <div className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium sm:text-[11px] ${tones[tone]}`}>
          {icon}{label}
        </div>
        <div className="mt-1.5 text-lg font-bold tabular-nums sm:text-2xl">{value}</div>
      </CardContent>
    </Card>
  );
}

function RateCard({ label, rate, at, highlight }) {
  return (
    <div className={`rounded-lg border p-3 ${highlight ? 'border-emerald-200 bg-emerald-50/50' : 'border-stone-200'}`}>
      <div className="text-[10px] text-stone-500 sm:text-xs">{label}</div>
      <div className="mt-0.5 text-lg font-bold tabular-nums sm:text-2xl">{rate ? fmtNum(rate, 4) : '—'}</div>
      {at && <div className="mt-0.5 text-[9px] text-stone-400 sm:text-[10px]">{new Date(at).toLocaleString('es-VE')}</div>}
    </div>
  );
}

function SettleDialog({ transfer, onClose, onDone }) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  if (!transfer) return null;
  const submit = async () => {
    setSaving(true);
    try {
      await api('/settlements', {
        method: 'POST',
        body: JSON.stringify({
          payer_id: transfer.from.id, receiver_id: transfer.to.id, amount_usd: transfer.amount_usd, notes,
        }),
      });
      toast.success('Deuda liquidada');
      onClose(); setNotes('');
      await onDone();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  };
  return (
    <Dialog open={!!transfer} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
        <DialogHeader><DialogTitle>Liquidar deuda</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="rounded-lg border border-stone-200 bg-gradient-to-br from-stone-50 to-emerald-50 p-4 text-center">
            <div className="text-xs text-stone-500">{transfer.from.name} le paga a {transfer.to.name}</div>
            <div className="mt-1 text-3xl font-black tabular-nums">${fmtNum(transfer.amount_usd)}</div>
            {transfer.amount_usdt && <div className="mt-1 text-xs text-emerald-700">≈ {fmtNum(transfer.amount_usdt)} USDT</div>}
          </div>
          <div>
            <Label>Notas (opcional)</Label>
            <Textarea placeholder="Ej: Transferencia Binance" value={notes} onChange={e => setNotes(e.target.value)} rows={2} className="mt-1.5" />
          </div>
        </div>
        <DialogFooter className="flex-col gap-2 sm:flex-row">
          <Button variant="ghost" onClick={onClose}>Cancelar</Button>
          <Button className="bg-emerald-600 hover:bg-emerald-700" disabled={saving} onClick={submit}>
            {saving ? 'Liquidando...' : 'Confirmar pago'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ══════════════════════════════════════════════
   NUEVO GASTO
   ══════════════════════════════════════════════ */
function NewExpenseForm({ me, users, categories, wallets, rates, onSaved, onSwitchTab }) {
  const activeUsers = useMemo(() => users.filter(u => u.is_active !== false), [users]);
  const [type, setType] = useState('NOS');
  const [amount, setAmount] = useState('');
  const [currency, setCurrency] = useState('USD');
  const [owner, setOwner] = useState('');          // #Mio: de quién es el gasto
  const [beneficiary, setBeneficiary] = useState(''); // #Prestamo: para quién
  const [participants, setParticipants] = useState([]); // #Nos: entre quiénes
  const [categoryId, setCategoryId] = useState('');
  const [walletId, setWalletId] = useState('');
  const [description, setDescription] = useState('');
  const [rateOverride, setRateOverride] = useState('');
  const [saving, setSaving] = useState(false);

  const otherUsers = useMemo(() => activeUsers.filter(u => u.id !== me?.id), [activeUsers, me]);
  const myWallets = useMemo(() => wallets.filter(w => w.user_id === me?.id), [wallets, me]);

  useEffect(() => { setParticipants(activeUsers.map(u => u.id)); }, [users]);
  useEffect(() => { if (!owner && me) setOwner(me.id); }, [me]);
  useEffect(() => {
    if (type === 'PRESTAMO' && !beneficiary && otherUsers.length) setBeneficiary(otherUsers[0].id);
  }, [type, otherUsers]);

  const suggestedRate = useMemo(() => {
    if (currency === 'USD' || currency === 'USDT') return 1;
    if (currency === 'BS') return rates?.bcv_usd?.rate || 0;
    if (currency === 'EUR') {
      const bu = rates?.bcv_usd?.rate, be = rates?.bcv_eur?.rate;
      return bu && be ? bu / be : 0;
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
    if (currency === 'USDT') return a;
    const ves = currency === 'BS' ? a : currency === 'USD' ? a * bcvUsd : a * bcvEur;
    return ves / bin;
  }, [amount, currency, type, rates]);

  const selectedWallet = wallets.find(w => w.id === walletId);
  const nParticipants = participants.length || activeUsers.length;

  function toggleParticipant(id) {
    setParticipants(p => p.includes(id) ? p.filter(x => x !== id) : [...p, id]);
  }

  async function submit() {
    if (!me) { toast.error('Selecciona quién eres'); return; }
    if (!amount || parseFloat(amount) <= 0) { toast.error('Monto inválido'); return; }
    if (type === 'PRESTAMO' && !beneficiary) { toast.error('Selecciona a quién le prestas'); return; }
    if (type === 'NOS' && participants.length === 0) { toast.error('Elige al menos un participante'); return; }
    setSaving(true);
    try {
      await api('/transactions', {
        method: 'POST',
        body: JSON.stringify({
          payer_id: me.id, type,
          original_amount: amount, original_currency: currency,
          applied_rate: rateOverride || undefined,
          beneficiary_id: type === 'PRESTAMO' ? beneficiary : (type === 'MIO' && owner !== me.id ? owner : null),
          participant_ids: type === 'NOS' ? participants : undefined,
          category_id: categoryId || null, wallet_id: walletId || null, description,
        }),
      });
      toast.success('Gasto registrado');
      setAmount(''); setDescription(''); setRateOverride('');
      await onSaved();
      onSwitchTab?.();
    } catch (e) { toast.error(e.message); }
    finally { setSaving(false); }
  }

  return (
    <Card className="border-stone-200/70">
      <CardHeader className="px-4 pb-2 sm:px-6">
        <CardTitle className="text-base sm:text-lg">Registrar gasto</CardTitle>
        <CardDescription className="text-xs sm:text-sm">El sistema calcula USD y USDT automáticamente</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 px-4 pb-4 sm:px-6">
        <div>
          <Label className="text-sm">Tipo</Label>
          <div className="mt-2 grid grid-cols-3 gap-1.5 sm:gap-2">
            {TX_TYPES.map(t => (
              <button
                key={t.code}
                onClick={() => setType(t.code)}
                className={`rounded-xl border p-2.5 text-center transition-all sm:p-3 ${
                  type === t.code
                    ? 'border-emerald-500 bg-emerald-50/60 ring-2 ring-emerald-500/20'
                    : 'border-stone-200 hover:border-stone-300 active:bg-stone-50'
                }`}
              >
                <div className="text-lg sm:text-xl">{t.icon}</div>
                <div className="mt-0.5 text-[11px] font-semibold sm:text-xs">{t.label}</div>
                <div className="mt-0.5 hidden text-[10px] text-stone-500 sm:block">{t.desc}</div>
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-3 gap-2 sm:gap-3">
          <div className="col-span-2">
            <Label className="text-sm">Monto</Label>
            <Input type="number" step="0.01" inputMode="decimal" placeholder="0.00" value={amount}
              onChange={e => setAmount(e.target.value)} className="mt-1.5 h-12 text-lg" />
          </div>
          <div>
            <Label className="text-sm">Moneda</Label>
            <Select value={currency} onValueChange={setCurrency}>
              <SelectTrigger className="mt-1.5 h-12"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CURRENCIES.map(c => <SelectItem key={c} value={c}>{currencySymbol(c)} {c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* #Mio: de quién es */}
        {type === 'MIO' && activeUsers.length > 1 && (
          <div>
            <Label className="text-sm">¿De quién es este gasto?</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {activeUsers.map(u => (
                <button
                  key={u.id}
                  onClick={() => setOwner(u.id)}
                  className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                    owner === u.id ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-300 text-stone-600 hover:bg-stone-50'
                  }`}
                >
                  #Mio {u.short || u.name}
                </button>
              ))}
            </div>
            {owner && owner !== me?.id && (
              <p className="mt-1.5 text-[11px] text-stone-500">
                Lo pagas tú, pero cuenta como gasto personal de {activeUsers.find(u => u.id === owner)?.name} (te lo debe).
              </p>
            )}
          </div>
        )}

        {/* #Nos: entre quiénes */}
        {type === 'NOS' && activeUsers.length > 1 && (
          <div>
            <Label className="text-sm">Se reparte entre</Label>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {activeUsers.map(u => {
                const on = participants.includes(u.id);
                return (
                  <button
                    key={u.id}
                    onClick={() => toggleParticipant(u.id)}
                    className={`rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                      on ? 'border-emerald-600 bg-emerald-600 text-white' : 'border-stone-300 text-stone-500 hover:bg-stone-50'
                    }`}
                  >
                    {on ? '✓ ' : ''}{u.name}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* #Prestamo */}
        {type === 'PRESTAMO' && (
          <div>
            <Label className="text-sm">¿A quién le prestas?</Label>
            <Select value={beneficiary} onValueChange={setBeneficiary}>
              <SelectTrigger className="mt-1.5 h-11"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
              <SelectContent>
                {otherUsers.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        )}

        {(currency === 'BS' || currency === 'EUR') && (
          <div className="rounded-lg bg-stone-50 p-3">
            <div className="text-xs text-stone-500">Tasa {currency}/USD</div>
            <div className="mt-1 flex flex-col items-start gap-2 sm:flex-row sm:items-center">
              <div className="text-sm text-stone-500">BCV: <b className="text-stone-900">{fmtNum(suggestedRate, 4)}</b></div>
              <Input type="number" step="0.0001" placeholder="Sobrescribir..." value={rateOverride}
                onChange={e => setRateOverride(e.target.value)} className="h-9 max-w-full sm:max-w-[160px]" />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <Label className="text-sm">Categoría <span className="text-[10px] text-stone-500">· auto IA</span></Label>
            <Select value={categoryId} onValueChange={setCategoryId}>
              <SelectTrigger className="mt-1.5 h-11"><SelectValue placeholder="Auto (IA)" /></SelectTrigger>
              <SelectContent>
                {categories.map(c => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Billetera <span className="text-[10px] text-stone-500">· se descuenta el saldo</span></Label>
            <Select value={walletId} onValueChange={setWalletId}>
              <SelectTrigger className="mt-1.5 h-11"><SelectValue placeholder="Automática" /></SelectTrigger>
              <SelectContent>
                {myWallets.map(w => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name} · {fmtNum(w.current_balance)} {w.currency}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div>
          <Label className="text-sm">Descripción</Label>
          <Textarea placeholder="Ej: cena en La Estancia" value={description}
            onChange={e => setDescription(e.target.value)} rows={2} className="mt-1.5" />
        </div>

        <div className="rounded-xl border-2 border-dashed border-emerald-200 bg-emerald-50/40 p-3 sm:p-4">
          <div className="mb-1 text-[10px] text-stone-500 sm:text-xs">Previsualización</div>
          <div className="flex flex-wrap items-baseline gap-3">
            <div>
              <span className="text-xl font-bold tabular-nums sm:text-2xl">${fmtNum(amountUsd)}</span>
              <span className="ml-1 text-[10px] text-stone-500 sm:text-xs">USD</span>
            </div>
            {type === 'PRESTAMO' && (
              <div className="flex items-center gap-1 rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white">
                <Snowflake size={11} /> {fmtNum(amountUsdt)} USDT
              </div>
            )}
          </div>
          {type === 'NOS' && parseFloat(amount) > 0 && (
            <div className="mt-1 text-[10px] text-stone-500 sm:text-xs">
              Cada uno aporta ${fmtNum(amountUsd / nParticipants)} ({nParticipants} personas)
            </div>
          )}
          {selectedWallet && parseFloat(amount) > 0 && (
            <div className="mt-1 text-[10px] text-stone-500 sm:text-xs">
              {selectedWallet.name}: {fmtNum(selectedWallet.current_balance)} → {' '}
              <b className="text-stone-700">
                {fmtNum(Number(selectedWallet.current_balance) - (
                  selectedWallet.currency === currency
                    ? parseFloat(amount || 0)
                    : (selectedWallet.currency === 'BS' ? amountUsd * (rates?.bcv_usd?.rate || 0) : amountUsd)
                ))} {selectedWallet.currency}
              </b>
            </div>
          )}
        </div>

        <Button className="h-12 w-full bg-emerald-600 text-base font-semibold hover:bg-emerald-700" disabled={saving} onClick={submit}>
          {saving ? <><RefreshCw size={16} className="mr-2 animate-spin" /> Guardando...</> : 'Registrar gasto'}
        </Button>
      </CardContent>
    </Card>
  );
}

/* ══════════════════════════════════════════════
   HISTORIAL
   ══════════════════════════════════════════════ */
function HistoryView({ transactions, onDelete }) {
  const [openId, setOpenId] = useState(null);
  const [splits, setSplits] = useState({});
  const typeColor = {
    NOS: 'bg-emerald-100 text-emerald-800',
    MIO: 'bg-stone-100 text-stone-700',
    PRESTAMO: 'bg-teal-100 text-teal-800',
  };

  async function toggle(id) {
    setOpenId(openId === id ? null : id);
    if (!splits[id]) {
      try {
        const rows = await api(`/transactions/${id}/splits`);
        setSplits(s => ({ ...s, [id]: rows }));
      } catch { /* el detalle es opcional */ }
    }
  }

  return (
    <Card className="border-stone-200/70">
      <CardHeader className="px-4 pb-2 sm:px-6">
        <CardTitle className="text-base sm:text-lg">Historial</CardTitle>
        <CardDescription className="text-xs sm:text-sm">Toca un gasto para ver el reparto</CardDescription>
      </CardHeader>
      <CardContent className="px-4 pb-4 sm:px-6">
        {transactions.length === 0 && (
          <div className="py-12 text-center text-sm text-stone-500">
            <Receipt size={32} className="mx-auto mb-2 opacity-30" />
            No hay transacciones aún
          </div>
        )}
        <div className="divide-y divide-stone-100">
          {transactions.map(t => (
            <div key={t.id} className="py-3">
              <div className="flex items-start justify-between gap-2">
                <button className="flex min-w-0 flex-1 items-start gap-2.5 text-left" onClick={() => toggle(t.id)}>
                  <div className="mt-0.5 shrink-0 text-xl sm:text-2xl">{t.category_icon || '💰'}</div>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge className={`${typeColor[t.type]} px-1.5 py-0 text-[10px]`}>#{t.type?.toLowerCase()}</Badge>
                      <span className="truncate text-sm font-semibold">{t.description || t.category_name || 'Sin descripción'}</span>
                    </div>
                    <div className="mt-0.5 text-[10px] text-stone-500 sm:text-xs">
                      <b>{t.payer_name}</b>
                      {t.beneficiary_name ? ` → ${t.beneficiary_name}` : ''}
                      {t.wallet_name ? ` · ${t.wallet_name}` : ''}
                      {' · '}{new Date(t.transaction_date).toLocaleDateString('es-VE')}
                    </div>
                  </div>
                </button>
                <div className="flex shrink-0 items-center gap-1.5">
                  <div className="text-right">
                    <div className="text-sm font-bold tabular-nums">
                      {currencySymbol(t.original_currency)} {fmtNum(t.original_amount)}
                    </div>
                    <div className="text-[10px] tabular-nums text-stone-500">
                      ${fmtNum(t.amount_usd)}{t.amount_usdt ? ` · ${fmtNum(t.amount_usdt)}₮` : ''}
                    </div>
                  </div>
                  <Button size="icon" variant="ghost" className="h-8 w-8 shrink-0" onClick={() => onDelete(t.id)}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
              {openId === t.id && (
                <div className="mt-2 rounded-lg bg-stone-50 p-3 text-xs">
                  <div className="mb-1.5 font-medium text-stone-600">Reparto</div>
                  {(splits[t.id] || []).length === 0 && <div className="text-stone-500">Sin reparto registrado</div>}
                  <div className="space-y-1">
                    {(splits[t.id] || []).map(s => (
                      <div key={s.id} className="flex items-center justify-between">
                        <span className="text-stone-600">{s.user_name}</span>
                        <span className="font-semibold tabular-nums">${fmtNum(s.share_usd)}</span>
                      </div>
                    ))}
                  </div>
                  {t.wallet_amount && (
                    <div className="mt-2 border-t border-stone-200 pt-2 text-stone-500">
                      Descontado de la billetera: <b className="text-stone-700">{fmtNum(t.wallet_amount)}</b>
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
