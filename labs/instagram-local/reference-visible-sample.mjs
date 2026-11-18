import { validateUsername } from './guard.mjs';

/**
 * Select a SMALL, on-screen sample of Instagram user links from the follower
 * dialog only. No scrolling, scraping beyond opened dialog, persistence or action.
 * The caller supplies only the anchors present in the manually opened modal.
 */
export function visibleFollowerSample(anchors, referenceUsername, max = 5) {
  const reference = validateUsername(referenceUsername).toLowerCase();
  if (!Array.isArray(anchors)) throw new Error('Links inválidos.');
  if (!Number.isInteger(max) || max < 1 || max > 5) throw new Error('Limite inválido.');
  const seen = new Set();
  const usernames = [];
  for (const anchor of anchors) {
    if (usernames.length >= max) break;
    if (!anchor || anchor.visible !== true || typeof anchor.href !== 'string') continue;
    let path;
    try {
      // Never derive a candidate from external or non-profile links.
      const parsed = new URL(anchor.href, 'https://www.instagram.com/');
      if (parsed.hostname !== 'www.instagram.com' || parsed.search || parsed.hash) continue;
      path = parsed.pathname;
    } catch { continue; }
    const match = path.match(/^\/([A-Za-z0-9._]{1,30})\/?$/);
    if (!match) continue;
    let username;
    try { username = validateUsername(match[1]).toLowerCase(); }
    catch { continue; }
    if (username === reference || seen.has(username) ||
        ['explore', 'direct', 'accounts', 'reels', 'stories', 'p', 'about', 'legal'].includes(username)) continue;
    seen.add(username);
    usernames.push(username);
  }
  return usernames;
}
