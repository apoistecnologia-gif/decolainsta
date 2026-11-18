import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateUsername, validateAction, confirmationText, resultStatus, isRestrictedUrl, profileHeaderState, buttonLabelMatches, STATES } from '../guard.mjs';

test('aceita um único usuário com sintaxe válida e normaliza @', () => {
  assert.equal(validateUsername(' @perfil.teste_1 '), 'perfil.teste_1');
  for (const input of ['https://instagram.com/a', 'a..b', '.a', 'a.', 'nome/../outro', '', 'a'.repeat(31)]) {
    assert.throws(() => validateUsername(input));
  }
});

test('somente inspect, follow e unfollow; confirmação específica e obrigatória', () => {
  for (const action of ['inspect','inspect-menu','follow','unfollow']) assert.equal(validateAction(action), action);
  assert.throws(() => validateAction('bulk-follow'));
  assert.equal(confirmationText('follow', 'test'), 'SEGUIR @test');
  assert.equal(confirmationText('unfollow', 'test'), 'DEIXAR @test');
  assert.equal(confirmationText('inspect', 'test'), null);
});

test('somente mudanças realmente observadas no botão geram confirmação', () => {
  assert.equal(resultStatus('follow', ['Seguindo']), 'following_confirmed');
  assert.equal(resultStatus('follow', ['Requested']), 'request_submitted');
  assert.equal(resultStatus('unfollow', ['Seguir']), 'unfollow_confirmed');
  assert.equal(resultStatus('follow', ['Seguir']), 'unverified');
  assert.equal(resultStatus('unfollow', ['Seguindo']), 'unverified');
  assert.equal(STATES.follow.test('Seguir de volta'), true);
});

test('redirecionamentos suspeitos, login e desafios bloqueiam o fluxo', () => {
  assert.equal(isRestrictedUrl('https://www.instagram.com/challenge/123'), true);
  assert.equal(isRestrictedUrl('https://www.instagram.com/accounts/login/'), true);
  assert.equal(isRestrictedUrl('https://www.instagram.com/checkpoint/'), true);
  assert.equal(isRestrictedUrl('https://evil.example.com/test/'), true);
  assert.equal(isRestrictedUrl('https://www.instagram.com/perfil/'), false);
});

import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

test('CLI rejeita operação de lote e usernames malformados antes de abrir navegador', () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const cli = path.join(dir, '../cli.mjs');
  for (const args of [['bulk-follow', 'alvo'], ['follow', 'https://instagram.com/alvo'], ['inspect', 'alvo', 'segundo']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', timeout: 5000 });
    assert.equal(result.status, 3);
    assert.match(result.stderr, /Interrompido:/);
  }
});

test('inspeção diferencia Seguir de Seguindo e Solicitação, sem inventar estado', () => {
  assert.equal(profileHeaderState(['Seguir']), 'follow_available');
  assert.equal(profileHeaderState(['Seguir de volta']), 'follow_available');
  assert.equal(profileHeaderState(['Seguindo']), 'following');
  assert.equal(profileHeaderState(['Solicitado']), 'requested');
  assert.equal(profileHeaderState(['Requested']), 'requested');
  assert.equal(profileHeaderState([]), 'unknown');
  assert.equal(profileHeaderState(['Mensagem', 'Opções']), 'unknown');
  assert.equal(profileHeaderState(['Seguir', 'Seguindo']), 'ambiguous');
  assert.equal(profileHeaderState(['Editar perfil']), 'unknown');
});

test('botão Seguindo reconhecido pelo texto mesmo com nome acessível diferente', () => {
  assert.equal(buttonLabelMatches('Outras ações', 'Seguindo', STATES.following), true);
  assert.equal(buttonLabelMatches(null, '  Seguindo  ', STATES.following), true);
  assert.equal(buttonLabelMatches(null, 'Deixar de seguir', STATES.unfollow), true);
  assert.equal(buttonLabelMatches(null, 'Seguir', STATES.following), false);
  assert.equal(buttonLabelMatches(null, 'Seguindo o perfil errado', STATES.following), false);
  assert.equal(buttonLabelMatches(null, 'Seguir', STATES.follow), true);
  assert.equal(buttonLabelMatches(null, 'Seguindo', STATES.follow), false);
});

test('inspect-menu é somente diagnóstico; não aceita ações em lote', () => {
  assert.equal(validateAction('inspect-menu'), 'inspect-menu');
  assert.equal(confirmationText('inspect-menu', 'perfil'), null);
  assert.throws(() => validateAction('inspect-menu-all'));
});

import { waitForSingleVisibleDialog } from '../dialog.mjs';

test('aguarda modal de unfollow antes de examinar o botão (corrige condição de corrida)', async () => {
  let appeared = false;
  let waited = false;
  const dialog = { isVisible: async () => appeared };
  const page = {
    getByRole(role) {
      assert.equal(role, 'dialog');
      return {
        first: () => ({
          waitFor: async ({ state, timeout }) => {
            assert.equal(state, 'visible');
            assert.equal(timeout, 8000);
            waited = true;
            appeared = true;
          },
        }),
        count: async () => appeared ? 1 : 0,
        nth: i => { assert.equal(i, 0); return dialog; },
      };
    },
  };
  assert.equal(await waitForSingleVisibleDialog(page), dialog);
  assert.equal(waited, true);
});

test('não confirma se modal atrasar além do limite ou houver múltiplos', async () => {
  const late = {
    getByRole: () => ({ first: () => ({ waitFor: async () => { throw new Error('Timeout'); } }) }),
  };
  assert.equal(await waitForSingleVisibleDialog(late), null);

  const dialog1 = { isVisible: async () => true };
  const dialog2 = { isVisible: async () => true };
  const multiple = {
    getByRole: () => ({
      first: () => ({ waitFor: async () => {} }),
      count: async () => 2,
      nth: i => [dialog1, dialog2][i],
    }),
  };
  assert.equal(await waitForSingleVisibleDialog(multiple), null);
});
