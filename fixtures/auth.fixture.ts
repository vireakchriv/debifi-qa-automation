/**
 * Authentication helpers — sign-up, sign-in, and post creation.
 *
 * These are plain async functions, not Playwright test fixtures.
 * A full test.extend() fixture was considered but not needed here:
 * the IDOR test requires two separate browser contexts (one per user),
 * which a single fixture cannot provide cleanly. Plain functions are
 * easier to understand and work uniformly across all three test files.
 *
 * Note on BUG-01: After sign-up, Devise redirects to /plans. That page
 * crashes with an SSLError (ExchangeRateFetcherService cannot reach the ECB
 * API in Docker). The session cookie IS set before the redirect, so we
 * navigate explicitly to '/' to reach a stable authenticated state.
 */
import { expect, type Page } from '@playwright/test';
import type { TestUser } from '../test-data/users';

export async function signUp(page: Page, user: TestUser): Promise<void> {
  await page.goto('/users/sign_up');
  await page.getByLabel('Email').fill(user.email);
  // exact: true distinguishes "Password" from "Password confirmation"
  await page.getByLabel('Password', { exact: true }).fill(user.password);
  await page.getByLabel('Password confirmation').fill(user.password);
  await page.getByRole('button', { name: 'Sign up' }).click();

  // Navigate to home — session is active despite the /plans crash (BUG-01)
  await page.goto('/');
  await expect(page.locator('body')).toContainText('Logged in as');
}

export async function signIn(page: Page, user: TestUser): Promise<void> {
  await page.goto('/users/sign_in');
  await page.getByLabel('Email').fill(user.email);
  await page.getByLabel('Password').fill(user.password);
  // Devise labels the submit button "Log in" (note: nav bar says "Sign in" — BUG-06-A)
  await page.getByRole('button', { name: 'Log in' }).click();
  await page.goto('/');
  await expect(page.locator('body')).toContainText('Logged in as');
}

/**
 * Creates a post as the currently authenticated user.
 * Returns the numeric post ID extracted from the redirect URL.
 */
export async function createPost(
  page: Page,
  title: string,
  body: string
): Promise<string> {
  await page.goto('/posts/new');
  await page.getByLabel('Title').fill(title);
  await page.getByLabel('Html body').fill(body);
  await page.getByRole('button', { name: 'Save' }).click();
  await page.waitForURL(/\/posts\/\d+$/);
  await expect(page.locator('body')).toContainText('Post was created');
  const match = page.url().match(/\/posts\/(\d+)$/);
  if (!match) throw new Error('Could not determine post ID after creation');
  return match[1];
}
