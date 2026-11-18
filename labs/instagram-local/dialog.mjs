/**
 * Wait for Instagram's confirmation modal to become visible before looking for
 * its controls. This is only observation: it never clicks or retries actions.
 * Fail closed on missing or multiple visible dialogs.
 */
export async function waitForSingleVisibleDialog(page, timeout = 8000) {
  const dialogs = page.getByRole('dialog');
  try {
    await dialogs.first().waitFor({ state: 'visible', timeout });
  } catch {
    return null;
  }
  const count = await dialogs.count();
  if (count < 1 || count > 20) return null;
  let onlyVisible = null;
  for (let i = 0; i < count; i++) {
    const dialog = dialogs.nth(i);
    if (!await dialog.isVisible()) continue;
    if (onlyVisible) return null;
    onlyVisible = dialog;
  }
  return onlyVisible;
}

/**
 * The dialog itself can become visible before Instagram renders its actions.
 * Wait for exact visible text, without clicking anything. The caller must
 * subsequently enforce a unique visible button within this same dialog.
 */
export async function waitForDialogActionText(dialog, label, timeout = 8000) {
  if (!dialog || !(label instanceof RegExp)) return false;
  try {
    await dialog.getByText(label).first().waitFor({ state: 'visible', timeout });
    return await dialog.isVisible();
  } catch {
    return false;
  }
}
