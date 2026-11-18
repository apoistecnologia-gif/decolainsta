#!/usr/bin/env node
/**
 * Read-only manual visibility diagnostic for a registered reference account.
 * Never selects followers, extracts usernames, scrolls a list or acts on accounts.
 * Reuses the local Chrome session created by the single-action laboratory.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { mkdir } from 'node:fs/promises';
import { validateUsername, isRestrictedUrl } from './guard.mjs';
import { referenceFollowerVisibility } from './reference-visibility.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const sessionDir = path.join(here, '.session');
const FOLLOWER_LABEL = /seguidores|followers/i;

async function run() {
  const [rawUsername, ...extra] = process.argv.slice(2);
  if (extra.length || !rawUsername) throw new Error('Uso: node references-inspect.mjs usuario_referencia');
  const username = validateUsername(rawUsername);
  const { chromium } = await import('playwright').catch(() => {
    throw new Error('Playwright não instalado. Execute npm install nesta pasta.');
  });
  await mkdir(sessionDir, { recursive: true, mode: 0o700 });
  const browser = await chromium.launchPersistentContext(sessionDir, {
    channel: 'chrome', headless: false,
    viewport: { width: 1100, height: 860 }, locale: 'pt-BR',
  });
  const rl = createInterface({ input, output });
  const page = browser.pages()[0] ?? await browser.newPage();

  try {
    console.log('INSPEÇÃO DE REFERÊNCIA — apenas visualização. NÃO coleta seguidores nem executa ações.');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await rl.question('Entre na conta de teste no Chrome, se preciso. Depois pressione Enter aqui. ');
    const expectedPath = '/' + username.toLowerCase() + '/';
    await page.goto('https://www.instagram.com/' + username + '/', {
      waitUntil: 'domcontentloaded', timeout: 30000,
    });
    if (isRestrictedUrl(page.url()) || new URL(page.url()).pathname.toLowerCase() !== expectedPath) {
      console.log('A conta foi redirecionada para login/desafio ou outra página. Não inspecionar listas.');
      await rl.question('Confira o Chrome e pressione Enter para fechar. ');
      return;
    }
    const header = page.locator('main header').first();
    try { await header.waitFor({ state: 'visible', timeout: 20000 }); }
    catch {
      console.log('Cabeçalho da referência não carregou; não podemos afirmar que a lista esteja acessível.');
      await rl.question('Confira o Chrome e pressione Enter para fechar. ');
      return;
    }
    const headerText = await header.innerText().catch(() => '');
    console.log('Perfil de referência aberto: @' + username);
    console.log('Indicador de seguidores no cabeçalho:', FOLLOWER_LABEL.test(headerText) ? 'visível' : 'não identificado');
    console.log('Agora, no Chrome, clique MANUALMENTE em "seguidores" para verificar a visualização.');
    console.log('NÃO clique em Seguir/Deixar de seguir e não envie mensagens.');
    await rl.question('Com a lista/janela aberta (ou após observar uma restrição), pressione Enter para diagnosticar. ');

    const dialogs = page.getByRole('dialog');
    const n = Math.min(await dialogs.count(), 20);
    let visible = 0;
    for (let i = 0; i < n; i++) {
      if (await dialogs.nth(i).isVisible().catch(() => false)) visible++;
    }
    const text = (await page.locator('body').innerText().catch(() => '')).slice(0, 6000);
    const restriction = /limitamos certas coisas|restringimos certas atividades|we limit certain things|we restrict certain activity|ação bloqueada|action blocked|tente novamente mais tarde|try again later/i.test(text);
    console.log('Janelas visíveis:', visible);
    console.log('Status:', referenceFollowerVisibility(headerText, visible > 0, restriction));
    console.log('Nenhum usuário da lista foi coletado. Nenhuma ação foi executada.');
    await rl.question('Confira a janela e pressione Enter para fechar o Chrome. ');
  } finally {
    rl.close();
    await browser.close();
  }
}

run().catch(error => {
  console.error('Inspeção interrompida:', error instanceof Error ? error.message : String(error));
  process.exitCode = 2;
});
