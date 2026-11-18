#!/usr/bin/env node
/**
 * LOCAL, ONE-ACTION Instagram UI test (not a server worker or public bot).
 * Uses a dedicated Chrome profile. User signs in in Instagram's own browser UI.
 * Runs at most ONE mutating action after explicit terminal confirmation.
 * No scraping, proxies, CAPTCHA bypass, credential collection, bulk loops or retries.
 */
import { mkdir, appendFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { validateAction, validateUsername, confirmationText, isRestrictedUrl, resultStatus, STATES } from './guard.mjs';

const directory = path.dirname(fileURLToPath(import.meta.url));
const profileDir = path.join(directory, '.session');
const reportsDir = path.join(directory, 'results');
const EXIT = { OK: 0, NOT_VERIFIED: 2, NOT_ALLOWED: 3 };

async function record(event) {
  await mkdir(reportsDir, { recursive: true, mode: 0o700 });
  const line = JSON.stringify({ timestamp: new Date().toISOString(), ...event }) + '\n';
  await appendFile(path.join(reportsDir, 'activity.jsonl'), line, { mode: 0o600 });
}

async function visibleButtonNames(page) {
  const buttons = page.getByRole('button');
  const count = Math.min(await buttons.count(), 200);
  const names = [];
  for (let index = 0; index < count; index++) {
    const button = buttons.nth(index);
    if (!await button.isVisible()) continue;
    const label = (await button.getAttribute('aria-label') || await button.innerText().catch(() => '')).trim();
    if (label) names.push(label);
  }
  return names;
}

async function oneVisibleButton(page, regex) {
  const matching = page.getByRole('button', { name: regex });
  const count = await matching.count();
  if (count !== 1 || !await matching.first().isVisible()) return null;
  return matching.first();
}

async function restrictedOrWarn(page) {
  if (isRestrictedUrl(page.url())) return 'Tela de login/desafio ou domínio inesperado';
  const body = (await page.locator('body').innerText().catch(() => '')).slice(0, 5000);
  if (/tente novamente mais tarde|try again later|ação bloqueada|action blocked|confirme que você é|confirm it's you|suspensa|suspended/i.test(body)) {
    return 'Aviso de bloqueio/verificação encontrado; não tentar contornar';
  }
  return null;
}

async function run() {
  const [rawAction, rawUsername, ...extra] = process.argv.slice(2);
  if (extra.length || !rawAction || !rawUsername) throw new Error('Uso: node cli.mjs inspect|follow|unfollow @usuario');
  const action = validateAction(rawAction);
  const username = validateUsername(rawUsername);
  const expectedUrl = `https://www.instagram.com/${username}/`;
  const { chromium } = await import('playwright').catch(() => { throw new Error('Instale o Playwright nesta pasta: npm install'); });
  await mkdir(profileDir, { recursive: true, mode: 0o700 });
  const browser = await chromium.launchPersistentContext(profileDir, { channel: 'chrome', headless: false, viewport: { width: 1100, height: 860 }, locale: 'pt-BR' });
  const rl = createInterface({ input, output });
  const page = browser.pages()[0] ?? await browser.newPage();
  try {
    console.log('LABORATÓRIO LOCAL: uma ação por execução. Nenhuma senha é recebida pelo DecolaInsta.');
    console.log('Use apenas sua conta de teste. A automação pode violar as regras do Instagram e provocar restrições.');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('Faça login diretamente na janela do Instagram, caso seja solicitado.');
    await rl.question('Quando a conta de teste estiver aberta, pressione Enter para inspecionar o perfil. ');
    await page.goto(expectedUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await page.waitForTimeout(1800);
    const restriction = await restrictedOrWarn(page);
    if (restriction) throw new Error(restriction);
    if (!new URL(page.url()).pathname.toLowerCase().startsWith(`/${username.toLowerCase()}/`)) {
      throw new Error('Não foi possível confirmar o perfil de destino. Não houve clique.');
    }
    const before = await visibleButtonNames(page);
    const alreadyFollowing = before.some(label => STATES.following.test(label));
    const requested = before.some(label => STATES.requested.test(label));
    console.log(`Perfil: @${username}; estado observado: ${alreadyFollowing ? 'seguindo' : requested ? 'solicitação pendente' : 'não confirmado'}`);

    if (action === 'inspect') {
      await record({ action, username, status: 'inspected_only', realActions: 0 });
      console.log('Inspeção concluída. Nenhuma ação executada.');
      return EXIT.OK;
    }
    if (action === 'follow' && (alreadyFollowing || requested)) {
      await record({ action, username, status: 'already_following_or_requested', realActions: 0 });
      console.log('Nada feito: já segue ou possui solicitação pendente.');
      return EXIT.OK;
    }
    if (action === 'unfollow' && !alreadyFollowing) {
      await record({ action, username, status: 'not_confirmed_following', realActions: 0 });
      console.log('Nada feito: o perfil não está marcado como Seguindo.');
      return EXIT.NOT_VERIFIED;
    }

    const button = action === 'follow'
      ? await oneVisibleButton(page, STATES.follow)
      : await oneVisibleButton(page, STATES.following);
    if (!button) throw new Error('Botão único e visível não encontrado; interface mudou ou acesso restrito. Nenhuma ação executada.');

    const phrase = confirmationText(action, username);
    const confirmation = await rl.question(`Para executar UMA ação real, digite exatamente "${phrase}": `);
    if (confirmation.trim() !== phrase) {
      console.log('Cancelado sem ação.');
      await record({ action, username, status: 'cancelled', realActions: 0 });
      return EXIT.OK;
    }

    // No retry on timeout or unknown result: the action might already have happened.
    await button.click({ timeout: 8000 });
    if (action === 'unfollow') {
      // Instagram shows a confirmation dialog for unfollow in many UI versions.
      const confirmButton = await oneVisibleButton(page, STATES.unfollow);
      if (!confirmButton) {
        await record({ action, username, status: 'unverified_confirmation_dialog', realActions: 'unknown' });
        console.log('Confirmação de unfollow não identificada. Verifique manualmente; não tente novamente automaticamente.');
        return EXIT.NOT_VERIFIED;
      }
      await confirmButton.click({ timeout: 8000 });
    }
    await page.waitForTimeout(1200);
    const restrictionAfter = await restrictedOrWarn(page);
    const status = restrictionAfter ? 'restriction_detected' : resultStatus(action, await visibleButtonNames(page));
    await record({ action, username, status, realActions: status.endsWith('_confirmed') ? 1 : 'unknown' });
    console.log(`Resultado observado: ${status}. Verifique também no Instagram.`);
    return status.endsWith('_confirmed') || status === 'request_submitted' ? EXIT.OK : EXIT.NOT_VERIFIED;
  } finally {
    rl.close();
    await browser.close();
  }
}

run().then(code => { process.exitCode = code; }).catch(err => {
  console.error('Interrompido:', err instanceof Error ? err.message : String(err));
  process.exitCode = EXIT.NOT_ALLOWED;
});
