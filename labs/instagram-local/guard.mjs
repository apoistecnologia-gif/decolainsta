/** Pure rules for the local one-action Instagram test. No network requests. */
export const USERNAME_RE = /^[A-Za-z0-9._]{1,30}$/;
export const STATES = Object.freeze({
  follow: /^(seguir|follow|seguir de volta|follow back)$/i,
  following: /^(seguindo|following)$/i,
  requested: /^(solicitado|solicitada|requested)$/i,
  unfollow: /^(deixar de seguir|unfollow)$/i,
});

export function validateUsername(input) {
  if (typeof input !== 'string') throw new Error('Informe um @usuário do Instagram.');
  const username = input.trim().replace(/^@/, '');
  if (!USERNAME_RE.test(username) || username.includes('..') || username.startsWith('.') || username.endsWith('.')) {
    throw new Error('Nome de usuário inválido. Use somente o @usuário, sem links.');
  }
  return username;
}

export function validateAction(input) {
  if (!['inspect', 'follow', 'unfollow'].includes(input)) {
    throw new Error('Use inspect, follow ou unfollow.');
  }
  return input;
}

export function confirmationText(action, username) {
  if (action === 'follow') return `SEGUIR @${username}`;
  if (action === 'unfollow') return `DEIXAR @${username}`;
  return null;
}

export function isRestrictedUrl(input) {
  try {
    const url = new URL(input);
    return url.hostname !== 'www.instagram.com' && url.hostname !== 'instagram.com' ||
      /^\/(accounts\/login|challenge|checkpoint|suspended)(\/|$)/i.test(url.pathname);
  } catch { return true; }
}

export function resultStatus(action, visibleLabels) {
  // Never assume success from a click response. Require an observed UI state.
  if (action === 'follow') {
    if (visibleLabels.some(label => STATES.following.test(label))) return 'following_confirmed';
    if (visibleLabels.some(label => STATES.requested.test(label))) return 'request_submitted';
  }
  if (action === 'unfollow' && visibleLabels.some(label => STATES.follow.test(label))) return 'unfollow_confirmed';
  return 'unverified';
}
