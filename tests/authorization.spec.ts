/**
 * Regression test — POST-11 and POST-12
 * Cross-user post access (IDOR protection)
 *
 * Observed behavior during the Chrome campaign:
 *   Authorization is currently enforced via `current_user.posts.find(id)`.
 *   If User B tries to PATCH or DELETE a post owned by User A, the server
 *   raises ActiveRecord::RecordNotFound and returns an error page (BUG-10).
 *   The post is NOT modified or deleted — authorization is effective.
 *
 * Why this matters as a regression test:
 *   Authorization was PASSING during the campaign (POST-11/12 = PASS).
 *   A regression test ensures the protection stays in place as the codebase
 *   evolves — especially important for a financial application like Debifi.
 *
 * What this test does NOT do:
 *   - It does not test UI button visibility (Edit/Delete buttons not shown for
 *     other users' posts). UI-only checks are insufficient — a hidden button
 *     does not prove the server rejects the request.
 *   - It does not test every possible IDOR path (e.g., accessing raw show page).
 *     It targets the write operations (PATCH and DELETE) where data integrity matters.
 *
 * How server-side authorization is tested:
 *   We use fetch() within the browser context to send PATCH and DELETE
 *   requests directly to the server, bypassing any UI restrictions. We then
 *   verify that the post content is unchanged from User A's perspective.
 *
 * Current state:
 *   Tests PASS — server correctly rejects cross-user write operations.
 *   Tests will FAIL if the authorization check is removed or bypassed.
 */

import { test, expect, type Browser } from '@playwright/test';
import { signUp, createPost } from '../fixtures/auth.fixture';
import { generateUser } from '../test-data/users';

test('user cannot edit or delete another user\'s post (IDOR protection)', async ({ browser }: { browser: Browser }) => {
  // --- User A: create a post ---
  // Each context has its own isolated cookie jar — a separate "browser session"
  const contextA = await browser.newContext();
  const pageA = await contextA.newPage();
  const userA = generateUser();
  await signUp(pageA, userA);

  const originalTitle = 'User A Private Post';
  const originalBody = 'This content belongs exclusively to User A.';
  const postId = await createPost(pageA, originalTitle, originalBody);

  // --- User B: register in a separate browser context ---
  const contextB = await browser.newContext();
  const pageB = await contextB.newPage();
  const userB = generateUser();
  await signUp(pageB, userB);

  // Navigate to home to get a valid session-bound CSRF token for User B
  await pageB.goto('/');
  const csrfToken = await pageB.evaluate(
    () => document.querySelector<HTMLMetaElement>('meta[name="csrf-token"]')?.content ?? ''
  );
  expect(csrfToken, 'CSRF token must be available in User B session').not.toBe('');

  // --- POST-11: attempt to edit User A's post as User B ---
  // We use fetch() in the browser context so the request carries User B's session
  // cookies — identical to a real browser form submission from User B.
  const editAttempt = await pageB.evaluate(
    async ({ postId, csrfToken }: { postId: string; csrfToken: string }) => {
      const body = new URLSearchParams({
        _method: 'patch',
        authenticity_token: csrfToken,
        'post[title]': 'HACKED BY USER B',
        'post[html_body]': 'Content replaced by an unauthorized user',
      });
      const response = await fetch(`/posts/${postId}`, {
        method: 'POST', // Rails tunnels PATCH via _method hidden field
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'follow',
      });
      return { status: response.status };
    },
    { postId, csrfToken }
  );

  // A successful edit in Rails returns a redirect (302 → followed → 200).
  // The server must reject the request — any non-200 status indicates rejection.
  expect(
    editAttempt.status,
    `Server must reject unauthorized PATCH — got HTTP ${editAttempt.status}`
  ).not.toBe(200);

  // --- POST-12: attempt to delete User A's post as User B ---
  const deleteAttempt = await pageB.evaluate(
    async ({ postId, csrfToken }: { postId: string; csrfToken: string }) => {
      const body = new URLSearchParams({
        _method: 'delete',
        authenticity_token: csrfToken,
      });
      const response = await fetch(`/posts/${postId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString(),
        redirect: 'follow',
      });
      return { status: response.status };
    },
    { postId, csrfToken }
  );

  // A successful delete in Rails redirects to the post list (302 → followed → 200).
  expect(
    deleteAttempt.status,
    `Server must reject unauthorized DELETE — got HTTP ${deleteAttempt.status}`
  ).not.toBe(200);

  // --- Critical assertion: User A's post is unchanged ---
  // This is the definitive check. Regardless of HTTP status codes, the data
  // must be intact. If either operation above succeeded, these assertions fail.
  await pageA.goto(`/posts/${postId}`);
  await expect(
    pageA.getByRole('heading', { name: originalTitle }),
    'Post title must be unchanged after unauthorized edit attempt'
  ).toBeVisible();
  await expect(
    pageA.locator('body'),
    'Post body must be unchanged after unauthorized edit attempt'
  ).toContainText(originalBody);
  await expect(
    pageA.locator('body'),
    'Injected content must not appear in the post'
  ).not.toContainText('HACKED');

  // --- Cleanup ---
  await contextA.close();
  await contextB.close();
});
