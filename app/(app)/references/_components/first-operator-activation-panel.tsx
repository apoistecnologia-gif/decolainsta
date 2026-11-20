'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { FIRST_OPERATOR_CONFIRMATION } from '@/lib/first-operator-bootstrap';

export function FirstOperatorActivationPanel() {
  const [password, setPassword] = useState('');
  const [approved, setApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function activate(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!approved || !password || busy) return;
    const currentPassword = password;
    setPassword('');
    setBusy(true);
    setError('');
    try {
      const response = await fetch('/api/operator/activate-first-admin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        redirect: 'error',
        cache: 'no-store',
        body: JSON.stringify({
          password: currentPassword,
          confirm: FIRST_OPERATOR_CONFIRMATION,
        }),
      });
      if (!response.ok) throw Error('Senha incorreta ou conta não elegível.');
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== 'object' ||
          !('status' in payload) || payload.status !== 'activated')
        throw Error('Ativação não confirmada.');
      window.location.assign('/references/diagnostics');
    } catch {
      setError('Não foi possível ativar o operador. Confirme a senha da sua conta.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={event => void activate(event)}
      className="rounded-lg border p-4 space-y-3">
      <h2 className="text-sm font-semibold">Habilitar o primeiro administrador</h2>
      <p className="text-xs text-muted-foreground">
        Somente a conta já autenticada pode assumir a administração inicial.
        Confirme sua senha atual. A mudança de permissão pode ser visível em
        outros ambientes que compartilham este banco. Não insira a senha no chat.
      </p>
      <label className="block text-sm font-medium" htmlFor="operator-password">
        Senha atual do DECOLA INSTA
      </label>
      <Input id="operator-password" type="password"
        autoComplete="current-password" required value={password}
        onChange={event => setPassword(event.target.value)}
        maxLength={1024} disabled={busy} />
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" className="mt-1" checked={approved}
          disabled={busy} onChange={event => setApproved(event.target.checked)} />
        <span>Autorizo ativar esta conta como primeiro administrador,
          inclusive no banco compartilhado entre ambientes.</span>
      </label>
      <Button type="submit" variant="outline" disabled={busy || !approved || !password}>
        {busy ? 'Verificando...' : 'Confirmar e habilitar administrador'}
      </Button>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </form>
  );
}
