'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import {
  Wallet, Users, Trash2, Plus, Send, PiggyBank, RefreshCw, Lock,
  UserPlus, UserMinus, Calculator, Link2, ScanLine, ShieldCheck,
} from 'lucide-react';
import { api, CURRENCIES, fmtNum, initials } from '@/lib/ui';

export default function ConfigView({ users, wallets, categories, budgets, authStatus, reload }) {
  return (
    <div className="space-y-3 sm:space-y-4">
      <MembersSection users={users} wallets={wallets} reload={reload} />
      <WalletsSection users={users} wallets={wallets} reload={reload} />
      <ReconciliationSection wallets={wallets} reload={reload} />
      <TelegramSection users={users} reload={reload} />
      <div className="grid grid-cols-1 gap-3 sm:gap-4 md:grid-cols-2">
        <BudgetsSection categories={categories} users={users} budgets={budgets} reload={reload} />
        <SecuritySection authStatus={authStatus} />
      </div>
    </div>
  );
}

/* ─── MIEMBROS (Modo Familia) ─────────────────────────────────────── */
function MembersSection({ users, wallets, reload }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [short, setShort] = useState('');
  const [color, setColor] = useState('#0f766e');
  const [busy, setBusy] = useState(false);

  const active = users.filter(u => u.is_active !== false);
  const inactive = users.filter(u => u.is_active === false);

  async function add() {
    if (!name.trim()) { toast.error('Escribe un nombre'); return; }
    setBusy(true);
    try {
      await api('/users', { method: 'POST', body: JSON.stringify({ name, short: short || name[0], color }) });
      toast.success(`${name} se sumó al grupo`);
      setOpen(false); setName(''); setShort('');
      await reload();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function setActive(u, is_active) {
    try {
      await api('/users/' + u.id, { method: 'PATCH', body: JSON.stringify({ is_active }) });
      toast.success(is_active ? `${u.name} vuelve a participar` : `${u.name} ya no participa en los gastos nuevos`);
      await reload();
    } catch (e) { toast.error(e.message); }
  }

  async function remove(u) {
    if (!confirm(`¿Quitar a ${u.name}? Si ya tiene gastos, se conservará su historial y solo dejará de participar.`)) return;
    try {
      const r = await api('/users/' + u.id, { method: 'DELETE' });
      toast.success(r.deactivated ? `${u.name} quedó fuera (se conservó su historial)` : `${u.name} eliminado`);
      await reload();
    } catch (e) { toast.error(e.message); }
  }

  async function setDefaultWallet(u, walletId) {
    try {
      await api('/users/' + u.id, { method: 'PATCH', body: JSON.stringify({ default_wallet_id: walletId === 'none' ? null : walletId }) });
      toast.success('Billetera por defecto actualizada');
      await reload();
    } catch (e) { toast.error(e.message); }
  }

  return (
    <Card className="border-stone-200/70">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-6">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Users size={16} /> Miembros</CardTitle>
          <CardDescription className="text-xs">
            Los gastos #Nos se dividen en partes iguales entre los miembros activos
          </CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700"><UserPlus size={14} className="mr-1" /> Sumar</Button>
          </DialogTrigger>
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
            <DialogHeader><DialogTitle>Sumar miembro</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-sm">Nombre</Label>
                <Input value={name} onChange={e => setName(e.target.value)} placeholder="Ej: Sofía" className="mt-1 h-11" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-sm">Iniciales</Label>
                  <Input value={short} onChange={e => setShort(e.target.value)} placeholder="S" maxLength={3} className="mt-1 h-11" />
                </div>
                <div>
                  <Label className="text-sm">Color</Label>
                  <Input type="color" value={color} onChange={e => setColor(e.target.value)} className="mt-1 h-11" />
                </div>
              </div>
              <p className="text-[11px] text-stone-500">
                A partir de ese momento, cada gasto #Nos se reparte entre todos los miembros activos.
              </p>
            </div>
            <DialogFooter>
              <Button className="h-11 bg-emerald-600 hover:bg-emerald-700" onClick={add} disabled={busy}>
                {busy ? 'Agregando...' : 'Agregar'}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="px-4 pb-4 sm:px-6">
        <div className="space-y-2">
          {active.map(u => (
            <div key={u.id} className="rounded-lg border border-stone-200 p-3">
              <div className="flex items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-white"
                    style={{ background: u.color || '#0f766e' }}>
                    {initials(u)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{u.name}</div>
                    <div className="text-[10px] text-stone-500">
                      {u.telegram_chat_id ? 'Telegram vinculado' : 'Sin Telegram'}
                      {u.email ? ` · ${u.email}` : ''}
                    </div>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={() => setActive(u, false)}>
                    <UserMinus size={13} className="mr-1" /> Pausar
                  </Button>
                  <Button size="icon" variant="ghost" className="h-8 w-8 text-rose-600" onClick={() => remove(u)}>
                    <Trash2 size={13} />
                  </Button>
                </div>
              </div>
              <div className="mt-2">
                <Label className="text-[11px] text-stone-500">Billetera por defecto (para gastos por Telegram)</Label>
                <Select value={u.default_wallet_id || 'none'} onValueChange={v => setDefaultWallet(u, v)}>
                  <SelectTrigger className="mt-1 h-9 text-xs"><SelectValue placeholder="Automática" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Automática (por moneda)</SelectItem>
                    {wallets.filter(w => w.user_id === u.id).map(w => (
                      <SelectItem key={w.id} value={w.id}>{w.name} · {w.currency}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          ))}

          {inactive.length > 0 && (
            <div className="pt-2">
              <div className="mb-1.5 text-[11px] font-medium text-stone-500">Fuera del reparto</div>
              {inactive.map(u => (
                <div key={u.id} className="flex items-center justify-between rounded-lg border border-dashed border-stone-300 px-3 py-2">
                  <span className="text-sm text-stone-500">{u.name}</span>
                  <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => setActive(u, true)}>
                    Reactivar
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── BILLETERAS ──────────────────────────────────────────────────── */
function WalletsSection({ users, wallets, reload }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
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
    if (!confirm('¿Eliminar la billetera? Los gastos se conservan, solo dejan de estar asociados.')) return;
    await api('/wallets/' + id, { method: 'DELETE' });
    toast.success('Eliminada');
    await reload();
  }

  async function adjust(w) {
    const raw = prompt(`Ajustar saldo de ${w.name} (${w.currency}).\nEscribe cuánto sumar (ej: 5000) o restar (ej: -1200):`);
    if (raw === null) return;
    const delta = Number(raw.replace(',', '.'));
    if (!isFinite(delta) || delta === 0) { toast.error('Valor inválido'); return; }
    try {
      await api(`/wallets/${w.id}/adjust`, { method: 'POST', body: JSON.stringify({ delta }) });
      toast.success('Saldo ajustado');
      await reload();
    } catch (e) { toast.error(e.message); }
  }

  async function recalcPreview() {
    setBusy(true);
    try { setPreview(await api('/wallets/recalculate', { method: 'POST', body: JSON.stringify({ dry_run: true }) })); }
    catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function recalcApply() {
    setBusy(true);
    try {
      const r = await api('/wallets/recalculate', { method: 'POST', body: JSON.stringify({}) });
      toast.success(`Saldos recalculados · ${r.linked_transactions} gasto(s) asociados`);
      setPreview(null);
      await reload();
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Card className="border-stone-200/70">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-6">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><Wallet size={16} /> Billeteras</CardTitle>
          <CardDescription className="text-xs">Cada gasto descuenta el saldo de su billetera</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700"><Plus size={14} className="mr-1" /> Nueva</Button>
          </DialogTrigger>
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
            <DialogHeader><DialogTitle>Nueva billetera</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-sm">Dueño</Label>
                <Select value={form.user_id} onValueChange={v => setForm({ ...form, user_id: v })}>
                  <SelectTrigger className="mt-1 h-11"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                  <SelectContent>{users.filter(u => u.is_active !== false).map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">Nombre</Label>
                <Input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })} placeholder="Ej: Banesco" className="mt-1 h-11" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-sm">Tipo</Label>
                  <Select value={form.account_type} onValueChange={v => setForm({ ...form, account_type: v })}>
                    <SelectTrigger className="mt-1 h-11"><SelectValue /></SelectTrigger>
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
                    <SelectTrigger className="mt-1 h-11"><SelectValue /></SelectTrigger>
                    <SelectContent>{CURRENCIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <div>
                <Label className="text-sm">Saldo actual</Label>
                <Input type="number" step="0.01" value={form.current_balance}
                  onChange={e => setForm({ ...form, current_balance: e.target.value })} className="mt-1 h-11" />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={submit} className="h-11 bg-emerald-600 hover:bg-emerald-700">Crear</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="px-4 pb-4 sm:px-6">
        {wallets.length === 0 && <div className="py-4 text-center text-xs text-stone-500">Aún no hay billeteras</div>}
        <div className="divide-y divide-stone-100">
          {wallets.map(w => (
            <div key={w.id} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">
                  {w.name} <Badge variant="secondary" className="ml-1 text-[10px]">{w.currency}</Badge>
                </div>
                <div className="text-[10px] text-stone-500 sm:text-xs">
                  {w.user_name || users.find(u => u.id === w.user_id)?.name} · {w.account_type}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">{fmtNum(w.current_balance)}</div>
                  {w.initial_balance !== undefined && w.initial_balance !== null && (
                    <div className="text-[10px] text-stone-400">inicial {fmtNum(w.initial_balance)}</div>
                  )}
                </div>
                <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={() => adjust(w)}>Ajustar</Button>
                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => del(w.id)}><Trash2 size={13} /></Button>
              </div>
            </div>
          ))}
        </div>

        <Separator className="my-3" />
        <div className="rounded-lg bg-stone-50 p-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="flex items-center gap-1.5 text-xs font-medium"><Calculator size={13} /> Recalcular saldos</div>
              <div className="mt-0.5 text-[11px] text-stone-500">
                Reconstruye cada saldo desde el inicial y asocia gastos antiguos sin billetera
              </div>
            </div>
            <Button size="sm" variant="outline" className="h-8 shrink-0 text-[11px]" onClick={recalcPreview} disabled={busy}>
              {busy ? <RefreshCw size={12} className="animate-spin" /> : 'Previsualizar'}
            </Button>
          </div>
          {preview && (
            <div className="mt-3 space-y-2 text-[11px]">
              <div className="text-stone-600">
                Se asociarán <b>{preview.linked_transactions}</b> gasto(s) y se valorarán <b>{preview.priced_transactions}</b>.
              </div>
              {preview.wallets.map(w => (
                <div key={w.id} className="flex items-center justify-between rounded border border-stone-200 bg-white px-2 py-1.5">
                  <span className="text-stone-600">{w.name}</span>
                  <span className="tabular-nums">
                    {fmtNum(w.previous_balance)} → <b className="text-emerald-700">{fmtNum(w.current_balance)}</b> {w.currency}
                  </span>
                </div>
              ))}
              <div className="flex gap-2 pt-1">
                <Button size="sm" className="h-8 bg-emerald-600 text-[11px] hover:bg-emerald-700" onClick={recalcApply} disabled={busy}>
                  Aplicar
                </Button>
                <Button size="sm" variant="ghost" className="h-8 text-[11px]" onClick={() => setPreview(null)}>Cancelar</Button>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── CONCILIACIÓN BANCARIA ───────────────────────────────────────── */
function ReconciliationSection({ wallets, reload }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [walletId, setWalletId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  async function analyze() {
    if (!text.trim()) { toast.error('Pega el texto del estado de cuenta'); return; }
    setBusy(true);
    try {
      setResult(await api('/reconciliation/analyze', {
        method: 'POST',
        body: JSON.stringify({ text, wallet_id: walletId || null }),
      }));
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  async function createMissing(line) {
    try {
      await api('/reconciliation/create', { method: 'POST', body: JSON.stringify({ line, wallet_id: walletId || null }) });
      toast.success('Gasto creado desde el movimiento');
      await analyze();
      await reload();
    } catch (e) { toast.error(e.message); }
  }

  return (
    <Card className="border-stone-200/70">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-6">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><ScanLine size={16} /> Conciliación bancaria</CardTitle>
          <CardDescription className="text-xs">Pega tu estado de cuenta y cruza los movimientos con lo registrado</CardDescription>
        </div>
        <Button size="sm" variant="outline" className="h-8" onClick={() => setOpen(!open)}>
          {open ? 'Cerrar' : 'Abrir'}
        </Button>
      </CardHeader>
      {open && (
        <CardContent className="space-y-3 px-4 pb-4 sm:px-6">
          <div>
            <Label className="text-sm">Billetera del estado de cuenta</Label>
            <Select value={walletId} onValueChange={setWalletId}>
              <SelectTrigger className="mt-1 h-10"><SelectValue placeholder="Sin especificar" /></SelectTrigger>
              <SelectContent>
                {wallets.map(w => <SelectItem key={w.id} value={w.id}>{w.name} · {w.currency}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-sm">Movimientos</Label>
            <Textarea
              rows={6}
              className="mt-1 font-mono text-[11px]"
              placeholder={'06/09/2026  COMPRA POS 1234  -16.073,00\n05/09/2026  PAGO MOVIL 5678  -11.392,36'}
              value={text}
              onChange={e => setText(e.target.value)}
            />
          </div>
          <Button className="h-10 w-full bg-emerald-600 hover:bg-emerald-700" onClick={analyze} disabled={busy}>
            {busy ? <RefreshCw size={14} className="mr-2 animate-spin" /> : <Link2 size={14} className="mr-2" />}
            Cruzar movimientos
          </Button>

          {result && (
            <div className="space-y-2 text-xs">
              <div className="flex flex-wrap gap-2">
                <Badge className="bg-emerald-100 text-emerald-800">{result.matched.length} conciliados</Badge>
                <Badge className="bg-amber-100 text-amber-800">{result.missing.length} sin registrar</Badge>
                <Badge variant="outline">{result.unparsed} líneas no entendidas</Badge>
              </div>

              {result.matched.length > 0 && (
                <div>
                  <div className="mb-1 mt-2 font-medium text-stone-600">Coinciden con gastos ya registrados</div>
                  <div className="space-y-1">
                    {result.matched.map((m, i) => (
                      <div key={i} className="flex items-center justify-between rounded border border-emerald-200 bg-emerald-50/50 px-2 py-1.5">
                        <span className="mr-2 truncate text-stone-600">{m.line.description || m.line.raw}</span>
                        <span className="shrink-0 tabular-nums">{fmtNum(m.line.amount)} → {m.transaction.description || 'gasto'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {result.missing.length > 0 && (
                <div>
                  <div className="mb-1 mt-2 font-medium text-stone-600">En el banco pero no en la app</div>
                  <div className="space-y-1">
                    {result.missing.map((line, i) => (
                      <div key={i} className="flex items-center justify-between rounded border border-amber-200 bg-amber-50/50 px-2 py-1.5">
                        <span className="mr-2 truncate text-stone-600">
                          {line.date ? `${line.date} · ` : ''}{line.description || line.raw}
                        </span>
                        <span className="flex shrink-0 items-center gap-2">
                          <b className="tabular-nums">{fmtNum(line.amount)}</b>
                          <Button size="sm" variant="outline" className="h-7 text-[10px]" onClick={() => createMissing(line)}>
                            Registrar
                          </Button>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}

/* ─── TELEGRAM ────────────────────────────────────────────────────── */
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
      setStatus(await api('/telegram/status'));
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  };
  const unbind = async (uid) => {
    await api('/telegram/unbind', { method: 'POST', body: JSON.stringify({ user_id: uid }) });
    toast.success('Desvinculado');
    await reload();
  };

  return (
    <Card className="border-stone-200/70">
      <CardHeader className="px-4 sm:px-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <CardTitle className="flex items-center gap-2 text-base"><Send size={16} /> Bot de Telegram</CardTitle>
            <CardDescription className="mt-1 text-xs sm:text-sm">Registra gastos por chat, voz o foto de la factura</CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {status?.info?.url
              ? <Badge className="bg-emerald-100 text-[10px] text-emerald-800">Webhook activo</Badge>
              : <Badge variant="outline" className="text-[10px]">Sin webhook</Badge>}
            <Button size="sm" variant="outline" onClick={setupWebhook} disabled={busy} className="h-8 text-xs">
              {busy ? 'Configurando...' : 'Activar'}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4 sm:px-6">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50/50 p-3">
          <div className="mb-1 text-xs font-semibold">Cómo vincularse</div>
          <ol className="list-inside list-decimal space-y-0.5 text-xs text-stone-700">
            <li>Abrir <a href={botLink} target="_blank" rel="noreferrer" className="font-medium text-emerald-700 underline">@Finanzas_ParejaJM_Bot</a></li>
            <li>Enviar <code className="rounded bg-white px-1 py-0.5 text-[10px]">/start</code></li>
            <li>Tocar tu nombre</li>
          </ol>
        </div>

        <div className="rounded-lg border border-stone-200 p-3 text-xs">
          <div className="mb-1.5 font-medium">Sintaxis rápida</div>
          <div className="space-y-0.5 font-mono text-[11px] text-stone-600">
            <div><b>30$ cena #Nos</b> — se reparte entre todos</div>
            <div><b>5000 bs comida #Mio</b> — tuyo</div>
            <div><b>2$ mototaxi #Mio A</b> — personal de Aliexis</div>
            <div><b>15 usd hotel #Prestamo J</b> — préstamo a José</div>
            <div>Nota de voz · Foto de factura (eliges quién paga cada producto)</div>
          </div>
        </div>

        <div>
          <div className="mb-1.5 text-xs font-medium">Vinculaciones</div>
          {bound.length === 0 && <div className="text-[11px] text-stone-500">Nadie vinculado. Envía /start al bot.</div>}
          <div className="space-y-1">
            {bound.map(u => (
              <div key={u.id} className="flex items-center justify-between rounded border border-stone-200 px-3 py-2 text-xs">
                <span><b>{u.name}</b></span>
                <Button size="sm" variant="ghost" className="h-7 text-[11px]" onClick={() => unbind(u.id)}>Desvincular</Button>
              </div>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/* ─── PRESUPUESTOS ────────────────────────────────────────────────── */
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
    <Card className="border-stone-200/70">
      <CardHeader className="flex flex-row items-center justify-between px-4 sm:px-6">
        <div>
          <CardTitle className="flex items-center gap-2 text-base"><PiggyBank size={16} /> Presupuestos</CardTitle>
          <CardDescription className="text-xs">Límites mensuales</CardDescription>
        </div>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm" className="h-8 bg-emerald-600 hover:bg-emerald-700"><Plus size={14} className="mr-1" /> Nuevo</Button>
          </DialogTrigger>
          <DialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
            <DialogHeader><DialogTitle>Nuevo presupuesto</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-sm">Categoría</Label>
                <Select value={form.category_id} onValueChange={v => setForm({ ...form, category_id: v })}>
                  <SelectTrigger className="mt-1 h-11"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                  <SelectContent>{categories.map(c => <SelectItem key={c.id} value={c.id}>{c.icon} {c.name}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-sm">Límite mensual (USD)</Label>
                <Input type="number" step="0.01" value={form.monthly_limit_usd}
                  onChange={e => setForm({ ...form, monthly_limit_usd: e.target.value })} placeholder="300" className="mt-1 h-11" />
              </div>
              <div>
                <Label className="text-sm">Alcance</Label>
                <Select value={form.is_shared ? 'shared' : 'personal'}
                  onValueChange={v => setForm({ ...form, is_shared: v === 'shared', user_id: v === 'shared' ? '' : form.user_id })}>
                  <SelectTrigger className="mt-1 h-11"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="shared">Compartido (#Nos)</SelectItem>
                    <SelectItem value="personal">Personal (#Mio)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {!form.is_shared && (
                <div>
                  <Label className="text-sm">Miembro</Label>
                  <Select value={form.user_id} onValueChange={v => setForm({ ...form, user_id: v })}>
                    <SelectTrigger className="mt-1 h-11"><SelectValue placeholder="Selecciona..." /></SelectTrigger>
                    <SelectContent>{users.map(u => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button onClick={submit} className="h-11 bg-emerald-600 hover:bg-emerald-700">Guardar</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="px-4 pb-4 sm:px-6">
        {budgets.length === 0 && <div className="py-4 text-center text-xs text-stone-500">Aún no hay presupuestos</div>}
        <div className="divide-y divide-stone-100">
          {budgets.map(b => (
            <div key={b.id} className="flex items-center justify-between py-2.5">
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{b.category_icon} {b.category_name}{!b.is_shared && ` · ${b.user_name}`}</div>
                <div className="text-[10px] text-stone-500 sm:text-xs">{b.is_shared ? 'Compartido' : 'Personal'}</div>
              </div>
              <div className="flex shrink-0 items-center gap-1.5">
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

/* ─── SEGURIDAD ───────────────────────────────────────────────────── */
function SecuritySection({ authStatus }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  async function changePin() {
    if (next.length < 4) { toast.error('El nuevo PIN debe tener al menos 4 caracteres'); return; }
    if (next !== confirm) { toast.error('Los PIN nuevos no coinciden'); return; }
    setBusy(true);
    try {
      await api('/auth/change-pin', { method: 'POST', body: JSON.stringify({ current_pin: current, new_pin: next }) });
      toast.success('PIN actualizado. Las demás sesiones se cerraron.');
      setCurrent(''); setNext(''); setConfirm('');
    } catch (e) { toast.error(e.message); }
    finally { setBusy(false); }
  }

  return (
    <Card className="border-stone-200/70">
      <CardHeader className="px-4 sm:px-6">
        <CardTitle className="flex items-center gap-2 text-base"><ShieldCheck size={16} /> Seguridad</CardTitle>
        <CardDescription className="text-xs">
          {authStatus?.method === 'GOOGLE' ? 'Sesión iniciada con Google' : 'Sesión iniciada con PIN'}
          {authStatus?.google_enabled ? ' · Google disponible' : ''}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4 sm:px-6">
        <div className="flex items-center gap-1.5 text-xs font-medium"><Lock size={13} /> Cambiar PIN</div>
        <div className="space-y-2">
          <Input type="password" inputMode="numeric" placeholder="PIN actual" value={current}
            onChange={e => setCurrent(e.target.value)} className="h-10" />
          <Input type="password" inputMode="numeric" placeholder="Nuevo PIN" value={next}
            onChange={e => setNext(e.target.value)} className="h-10" />
          <Input type="password" inputMode="numeric" placeholder="Repite el nuevo PIN" value={confirm}
            onChange={e => setConfirm(e.target.value)} className="h-10" />
          <Button className="h-10 w-full bg-emerald-600 hover:bg-emerald-700" onClick={changePin} disabled={busy}>
            {busy ? 'Actualizando...' : 'Actualizar PIN'}
          </Button>
          <p className="text-[11px] text-stone-500">
            Al cambiarlo se cierran todas las sesiones abiertas, incluida la de este dispositivo.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
