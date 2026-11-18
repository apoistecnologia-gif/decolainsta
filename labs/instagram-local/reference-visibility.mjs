/** Pure visibility classification for a user-driven inspection, no usernames. */
export function referenceFollowerVisibility(headerText, dialogVisible, restricted) {
  if (restricted) return 'restricted';
  if (!/seguidores|followers/i.test(headerText)) return 'follower_label_missing';
  return dialogVisible ? 'dialog_visible_manual' : 'dialog_not_visible';
}
