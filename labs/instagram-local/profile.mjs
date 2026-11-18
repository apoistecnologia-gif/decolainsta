import { profileHeaderState } from './guard.mjs';

/**
 * Wait until the requested Instagram profile has a visible header and an
 * observable follow state. Inspect only: never clicks, reloads, or retries an action.
 *
 * A profile can be slow to hydrate after DOMContentLoaded; a fixed 1.8s delay
 * is not evidence that its controls have finished loading.
 */
export async function waitForProfileReady(
  page, username, readButtons, timeout = 16000, interval = 400,
) {
  const expected = `/${username.toLowerCase()}/`;
  let header = null;
  const deadline = Date.now() + Math.max(timeout, 0);
  let headerSeen = false;
  let lastButtons = [];

  while (true) {
    let path;
    try {
      const url = new URL(page.url());
      path = url.pathname.toLowerCase();
      if (!['instagram.com', 'www.instagram.com'].includes(url.hostname) || path !== expected) {
        return { header: null, buttons: [], state: 'unknown', reason: 'unexpected_page', path };
      }
    } catch {
      return { header: null, buttons: [], state: 'unknown', reason: 'invalid_page', path: '(invalid)' };
    }

    // Resolve the profile selector only after confirming we are on its exact URL.
    if (!header) header = page.locator('main header').first();
    if (await header.isVisible().catch(() => false)) {
      headerSeen = true;
      lastButtons = await readButtons(header).catch(() => []);
      const state = profileHeaderState(lastButtons);
      if (state !== 'unknown') {
        return { header, buttons: lastButtons, state, reason: 'ready', path };
      }
    }

    if (Date.now() >= deadline) {
      return {
        header: headerSeen ? header : null,
        buttons: lastButtons,
        state: 'unknown',
        reason: headerSeen ? 'profile_buttons_missing' : 'profile_header_missing',
        path,
      };
    }
    await page.waitForTimeout(Math.min(interval, Math.max(deadline - Date.now(), 1)));
  }
}
