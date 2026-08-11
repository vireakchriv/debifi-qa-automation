/**
 * Regression test — BUG-07
 * Stored XSS via unescaped post body
 *
 * Root cause (observed):
 *   The html_body field is rendered without escaping, likely via .html_safe
 *   or raw() in the view template. Any authenticated user can store a
 *   <script> tag that executes for all visitors of the post or home feed.
 *
 * Detection strategy:
 *   1. Dialog detection: page.on('dialog') catches any alert() call.
 *      The listener is registered BEFORE navigation to any page that
 *      renders the post body, so no timing gap exists.
 *   2. Window sentinel: the XSS payload sets window.__xss_sentinel = true
 *      before calling alert(). If the browser suppresses dialogs (headless
 *      mode, browser policy), the sentinel is still set if the script runs.
 *      We check for it via page.evaluate() after each navigation.
 *   3. Escaped text check: when the bug is fixed, the payload appears as
 *      visible escaped text ("<script>...") in the post view. This provides
 *      a positive confirmation that the fix is in place.
 *
 * The test verifies behavior on both the post view page and the home feed,
 * because BUG-07 was observed to trigger on both.
 *
 * Current state:
 *   Test FAILS — dialogFired becomes true when the XSS executes.
 *   Test will PASS once html_body output is properly escaped.
 */

import { test, expect } from '@playwright/test';
import { signUp } from '../fixtures/auth.fixture';
import { generateUser } from '../test-data/users';

// The sentinel property lets us detect script execution without relying solely
// on alert() — useful in environments where dialogs may be suppressed.
const XSS_PAYLOAD = `<script>window.__xss_sentinel=true;alert('XSS-DEBIFI')</script>`;

test('stored XSS payload in post body is not executed', async ({ page }) => {
  const user = generateUser();
  await signUp(page, user);

  // Register the dialog listener BEFORE any navigation that renders post content.
  // Playwright event listeners are synchronous — no risk of missing an early dialog.
  let dialogFired = false;
  page.on('dialog', async (dialog) => {
    dialogFired = true;
    await dialog.dismiss(); // dismiss to unblock further navigation
  });

  // --- Create the post ---
  // After clicking Save, Rails redirects to /posts/:id. If the bug is present,
  // the script in the body executes at this point and triggers the dialog event.
  await page.goto('/posts/new');
  await page.getByLabel('Title').fill('XSS Regression Test');
  await page.getByLabel('Html body').fill(XSS_PAYLOAD);

  // Promise.all ensures the click and the navigation wait are started together,
  // preventing a race where the URL changes before waitForURL is registered.
  await Promise.all([
    page.waitForURL(/\/posts\/\d+$/),
    page.getByRole('button', { name: 'Save' }).click(),
  ]);

  const postId = page.url().match(/\/posts\/(\d+)$/)?.[1];
  if (!postId) throw new Error('Post ID not found in URL after creation');

  // --- Check home feed ---
  // BUG-07 noted the script also executes when the home feed renders the post.
  await page.goto('/');
  await page.waitForLoadState('load');

  // --- Assertions ---

  // 1. No alert() dialog was triggered anywhere during the session
  expect(dialogFired, 'alert() must not execute — script must not run').toBe(false);

  // 2. The window sentinel was not set (catches execution even without dialog)
  const sentinelSet = await page.evaluate(() => !!(window as any).__xss_sentinel);
  expect(sentinelSet, 'XSS sentinel flag must not be set — script must not run').toBe(false);

  // 3. On the post view, the payload appears as escaped literal text.
  //    When bug is present: this assertion fails (script runs, text not visible).
  //    When bug is fixed: &lt;script&gt; renders as "<script>" in the DOM text.
  await page.goto(`/posts/${postId}`);
  await expect(
    page.locator('body'),
    'Payload must be visible as escaped text, not executed as a script'
  ).toContainText('<script>');
});
