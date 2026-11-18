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
import { validateAction, validateUsername, confirmationText, isRestrictedUrl, resultStatus, profileHeaderState, buttonLabelMatches, STATES } from './guard.mjs';
import { waitForSingleVisibleDialog, waitForDialogActionText } from './dialog.mjs';

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

async function oneVisibleButton(scope, regex) {
  // Instagram may expose a different accessible name than the rendered label.
  // Match the *same visible button elements* used by the inspector, restricted to
  // the target profile header (or the unfollow confirmation dialog).
  const buttons = scope.getByRole('button');
  const count = Math.min(await buttons.count(), 200);
  const matches = [];
  for (let i = 0; i < count; i++) {
    const candidate = buttons.nth(i);
    if (!await candidate.isVisible()) continue;
    const aria = await candidate.getAttribute('aria-label');
    const text = await candidate.innerText().catch(() => '');
    if (buttonLabelMatches(aria, text, regex)) matches.push(candidate);
  }
  if (matches.length !== 1) {
    console.log(`Seleção inconclusiva: ${matches.length} botão(ões) correspondentes; não haverá clique.`);
    return null;
  }
  return matches[0];
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
  if (extra.length || !rawAction || !rawUsername) throw new Error('Uso: node cli.mjs inspect|inspect-menu|follow|unfollow @usuario');
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
    // Only inspect controls inside the *visited profile header*.
    // Buttons from Suggested accounts elsewhere on Instagram are unrelated.
    const header = page.locator('main header').first();
    const hasHeader = await header.isVisible().catch(() => false);
    const before = hasHeader ? await visibleButtonNames(header) : [];
    const profileState = profileHeaderState(before);
    const stateLabel = {
      following: 'seguindo esse perfil',
      requested: 'solicitação pendente',
      follow_available: 'botão Seguir disponível',
      ambiguous: 'botões conflitantes; inspeção inconclusiva',
      unknown: 'botão não identificado; inspeção inconclusiva',
    }[profileState];
    const alreadyFollowing = profileState === 'following';
    const requested = profileState === 'requested';
    console.log(`Perfil consultado: @${username}; estado: ${stateLabel}`);
    console.log(`Botões identificados no cabeçalho: ${before.slice(0, 12).join(' | ') || '(nenhum)'}`);
    if (!hasHeader) console.log('Cabeçalho do perfil não localizado. Confira a janela do Chrome.');

    if (action === 'inspect') {
      await record({ action, username, status: `inspected_${profileState}`, realActions: 0 });
      console.log('Inspeção concluída. Nenhuma ação executada.');
      return profileState === 'unknown' || profileState === 'ambiguous'
        ? EXIT.NOT_VERIFIED : EXIT.OK;
    }
    if (!hasHeader || profileState === 'unknown' || profileState === 'ambiguous') {
      throw new Error('Não foi possível identificar com segurança o botão do perfil. Nenhuma ação executada.');
    }
    if (action === 'inspect-menu') {
      if (!alreadyFollowing) {
        console.log('O perfil não está marcado como Seguindo. Inspeção do menu cancelada sem cliques.');
        await record({ action, username, status: 'not_following', realActions: 0 });
        return EXIT.NOT_VERIFIED;
      }
      console.log('DIAGNÓSTICO: no Chrome, clique MANUALMENTE no botão "Seguindo", sem selecionar "Deixar de seguir".');
      await rl.question('Com o menu aberto e visível no Chrome, pressione Enter para examinar a estrutura. ');
      const candidates = [];
      const scopeTypes = ['dialog', 'menu', 'listbox'];
      for (const role of scopeTypes) {
        const group = page.getByRole(role);
        const count = Math.min(await group.count(), 30);
        let visibleCount = 0;
        for (let i = 0; i < count; i++) {
          if (await group.nth(i).isVisible()) visibleCount++;
        }
        if (visibleCount) candidates.push(`${role}: ${visibleCount}`);
      }
      console.log('Menus/janelas visíveis:', candidates.join(', ') || 'nenhum elemento com papel dialog/menu/listbox');
      for (const role of ['button', 'menuitem', 'option']) {
        const matches = page.getByRole(role);
        const count = Math.min(await matches.count(), 250);
        const labels = [];
        for (let i = 0; i < count; i++) {
          const item = matches.nth(i);
          if (!await item.isVisible()) continue;
          const aria = await item.getAttribute('aria-label') || '';
          const label = (aria || await item.innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
          // Only report labels relevant to follow/unfollow. Never dump page content or credentials.
          if (/seguir|seguindo|follow|unfollow/i.test(label) && label.length <= 80) labels.push(label);
        }
        console.log(`Controles ${role} pertinentes:`, labels.slice(0, 12).join(' | ') || '(nenhum)');
      }
      const unfollowText = page.getByText(/^(Deixar de seguir|Unfollow)$/i);
      const exactCount = Math.min(await unfollowText.count(), 100);
      let visibleTextCount = 0;
      for (let i = 0; i < exactCount; i++) {
        if (await unfollowText.nth(i).isVisible()) visibleTextCount++;
      }
      console.log(`Textos exatos "Deixar de seguir"/"Unfollow" visíveis: ${visibleTextCount}`);
      console.log('Nenhum clique de unfollow foi executado pelo programa. Tire um print da janela do Chrome com o menu aberto.');
      await record({ action, username, status: 'menu_inspected', realActions: 'not_verified' });
      await rl.question('Depois de tirar o print, pressione Enter para fechar o Chrome. ');
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
      ? await oneVisibleButton(header, STATES.follow)
      : await oneVisibleButton(header, STATES.following);
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
      // The menu is rendered asynchronously. Wait for exactly one visible dialog;
      // do not attempt a second click if confirmation is absent or ambiguous.
      const dialog = await waitForSingleVisibleDialog(page);
      // The modal container may appear before its "Deixar de seguir" row is rendered.
      // Merely seeing the dialog is not sufficient; wait for the exact label,
      // then ensure a unique visible button inside that dialog before clicking.
      const actionReady = dialog
        ? await waitForDialogActionText(dialog, STATES.unfollow) : false;
      const confirmButton = actionReady
        ? await oneVisibleButton(dialog, STATES.unfollow) : null;
      if (!confirmButton) {
        await record({ action, username, status: 'unverified_confirmation_dialog', realActions: 'unknown' });
        console.log('A opção de unfollow não ficou visível no diálogo esperado. Nada foi confirmado; confira manualmente antes de tentar de novo.');
        return EXIT.NOT_VERIFIED;
      }
      await confirmButton.click({ timeout: 8000 });
    }
    // Observation-only polling after the single click: allow the page to update,
    // without repeating a follow/unfollow when the result is uncertain.
    let status = 'unverified';
    for (let check = 0; check < 20; check++) {
      await page.waitForTimeout(350);
      const restrictionAfter = await restrictedOrWarn(page);
      if (restrictionAfter) {
        status = 'restriction_detected';
        break;
      }
      status = resultStatus(action, await visibleButtonNames(header));
      if (status !== 'unverified') break;
    }
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
