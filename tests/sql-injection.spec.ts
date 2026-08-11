/**
 * Regression test — BUG-08
 * SQL injection via unparameterized ILIKE query in search
 *
 * Root cause (observed):
 *   The search query is built with string interpolation:
 *     WHERE title ILIKE '%#{params[:q]}%'
 *   Any input containing a single quote breaks SQL syntax, causing a
 *   PG::SyntaxError and crashing the application. The Rails debug page
 *   then exposes full source code and the raw SQL query (BUG-02).
 *
 * Expected behavior after fix:
 *   Parameterized query: WHERE title ILIKE ? with value "%payload%"
 *   User input is treated as data, never injected into the query string.
 *
 * Scope of this test:
 *   This test verifies the specific crash behavior observed in BUG-08.
 *   It does not attempt to prove complete protection against all forms of
 *   SQL injection — that would require access to database internals or a
 *   dedicated security audit. It is scoped to what is directly observable
 *   from the browser.
 *
 * Current state:
 *   Tests FAIL — the application crashes on single-quote input.
 *   Tests will PASS once the query is properly parameterized.
 */

import { test, expect } from '@playwright/test';

const CRASH_INDICATORS = [
  'PG::SyntaxError',
  'ActiveRecord::',
  'Rails.root:',
  'Extracted source',
  'Application Trace',
];

// Representative payloads that include a single quote — sufficient to trigger BUG-08.
// All three crash the application identically in its current state.
const SQL_PAYLOADS: Array<{ label: string; input: string }> = [
  {
    label: 'classic OR injection',
    input: "' OR '1'='1",
  },
  {
    label: 'statement termination',
    input: "'; DROP TABLE posts; --",
  },
  {
    label: 'UNION-based pattern',
    input: "' UNION SELECT email FROM users--",
  },
];

for (const { label, input } of SQL_PAYLOADS) {
  test(`search input (${label}) does not crash the application`, async ({ page }) => {
    await page.goto('/');

    await page.getByLabel('Search').fill(input);
    await page.getByRole('button', { name: 'Go' }).click();
    await page.waitForLoadState('load');

    // Assert: no Rails crash page or debug information is rendered
    for (const indicator of CRASH_INDICATORS) {
      await expect(
        page.locator('body'),
        `Response must not contain "${indicator}"`
      ).not.toContainText(indicator);
    }

    // Assert: the application is still functional — search form is rendered
    // This confirms the app survived the request and is not in an error state
    await expect(
      page.getByLabel('Search'),
      'Search form must remain usable after the request'
    ).toBeVisible();
  });
}
