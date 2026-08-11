# Interview Notes — Debifi QA Automation

Answers to likely questions on the technical approach. Keep these concise — the goal is to have clear, grounded answers ready, not to memorize scripts.

---

## 1. Pourquoi Playwright plutôt que Selenium ou Cypress ?

**Selenium:** requires WebDriver, verbose setup, no native multi-context support. For this assignment the extra boilerplate would have been overhead without benefit.

**Cypress:** single-origin model — it can't run two separate authenticated sessions in the same test. The IDOR test (User A creates a post, User B tries to tamper with it) is impossible in Cypress without significant workarounds.

**Playwright:** `browser.newContext()` gives each user their own isolated cookie jar within a single test process. Auto-wait API means no `sleep()` calls. TypeScript support is first-class. It was the right tool for the job, not a default choice.

---

## 2. Pourquoi TypeScript plutôt que JavaScript ?

Type safety catches mistakes at compile time. In the authorization test, `page.evaluate()` passes a structured object from Node context into browser context — TypeScript ensures both ends have matching types. The `HTMLMetaElement` type for CSRF token extraction is another example: without `lib: ["ES2020", "DOM"]` in `tsconfig.json`, the code will refuse to compile rather than failing silently at runtime. For a security-sensitive test suite, catching those kinds of errors before the tests even run matters.

---

## 3. Pourquoi pas de Page Object Model (POM) ?

POM is valuable when many test files interact with the same pages and you want a single place to update selectors. With three test files, a POM layer would add abstraction without benefit. The shared logic — sign-up, sign-in, post creation — lives in `fixtures/auth.fixture.ts` as plain async functions. They provide the same selector centralization as POM classes, without the class inheritance overhead.

If the suite grew to 20+ tests, adding a `pages/` directory with `HomePage`, `PostPage`, and `AuthPage` classes would be the natural next step.

---

## 4. Pourquoi des fixtures plutôt que des before/after hooks ?

`beforeEach` hooks run invisibly before each test. When a test fails, you have to trace back through the hook to understand the preconditions. Helper functions called explicitly inside each test (`await signUp(page, user)`) are part of the test's own code — any reader can follow the full flow top to bottom. They also compose freely: the IDOR test calls `signUp` twice with different users on different contexts, which a shared hook can't express cleanly.

---

## 5. Comment l'authentification est-elle gérée ?

Each test calls `generateUser()` to create a unique email address (timestamp + random suffix) and then signs up via the UI. No pre-seeded credentials, no shared users. The `signUp()` helper also works around BUG-01: after sign-up, Devise redirects to `/plans` which crashes with an SSL error. The session cookie is already set before the crash, so navigating to `/` immediately after is enough to land in a stable authenticated state.

---

## 6. Pourquoi les tests sont-ils indépendants les uns des autres ?

Shared state between tests is the #1 cause of flaky test suites. If test 1 fails mid-way and leaves dirty state that test 2 depends on, test 2 will fail for the wrong reason. Here, every test creates its own users and posts from scratch. `fullyParallel: false, workers: 1` ensures tests run sequentially so there are no DB race conditions — a reasonable trade-off for a five-test suite.

---

## 7. Comment les données de test sont-elles isolées ?

`generateUser()` combines `Date.now()` with a random 4-digit number: `qa_auto_1723374821234_4729@test.com`. Even if two test runs overlap (e.g., retry + re-run), the probability of collision is effectively zero. No database cleanup is performed between runs — test accounts and posts accumulate. For a local assignment context this is acceptable; a team suite would add a teardown step or use database transactions rolled back after each test.

---

## 8. Comment les tests flaky ont-ils été évités ?

- **No `waitForTimeout()`** anywhere in the suite. Every wait is event-driven: `waitForURL()`, `waitForLoadState()`, `toBeVisible()`, `toContainText()`.
- **`Promise.all([page.waitForURL(...), element.click()])`** in the XSS test: the `waitForURL` listener must be registered before the click fires to avoid the race where the navigation completes before the listener is attached.
- **Dialog listener registered before navigation**: `page.on('dialog', ...)` is set up before any page that renders post content, so even an instant alert is caught.
- **Sequential execution** (`workers: 1`): eliminates DB race conditions between tests.

---

## 9. Pourquoi `getByLabel` et `getByRole` plutôt que des sélecteurs CSS ?

User-facing locators (`getByLabel`, `getByRole`) target what a real user interacts with — the label text or the ARIA role. A CSS selector like `#search-input-3f2a` breaks the moment the class name changes. A label like `'Email'` stays stable as long as the field is still called "Email" in the UI. This also aligns tests with accessibility: if the label isn't correct, the locator fails and flags an accessibility issue at the same time.

---

## 10. Comment les assertions sont-elles rédigées pour être utiles ?

Each `expect()` call includes a descriptive message as its second argument:

```typescript
expect(editAttempt.status, `Server must reject unauthorized PATCH — got HTTP ${editAttempt.status}`).not.toBe(200);
```

When a test fails, the error message tells you *what was expected and why*, not just the raw values. This matters when reading a CI report without access to the full test code.

---

## 11. Comment la détection du XSS fonctionne-t-elle ?

Two independent signals:

1. **Dialog listener** (`page.on('dialog', ...)`): catches any `alert()` call. Registered before navigation — no timing gap.
2. **Window sentinel** (`window.__xss_sentinel`): the XSS payload sets a property on `window` before calling `alert()`. Checked via `page.evaluate()` after each navigation. If the browser suppresses dialogs (headless mode, enterprise policy), the sentinel is still set if the script actually ran.

A third assertion checks that `<script>` appears as *escaped text* in the post view after the fix — positive confirmation that output escaping is active, not just absence of execution.

---

## 12. Pourquoi le test SQL injection vérifie seulement le crash, pas l'injection complète ?

The crash (PG::SyntaxError on a single quote) is reproducible, observable from the browser, and has a clear fix: parameterize the query. Verifying that a full SQL injection payload actually exfiltrates data would require database-level inspection — reading query logs or comparing database state before and after — which is out of scope for a browser automation test. The test verifies: "does the application crash? Is the form still usable?" That is what a parameterization fix changes.

---

## 13. Pourquoi l'IDOR est-il testé côté serveur plutôt que via l'UI ?

Checking that the Edit and Delete buttons are hidden for other users' posts is a UI test, not an authorization test. The server endpoint could be completely unprotected while the buttons are simply not rendered — a malicious user would just call the endpoint directly, bypassing the UI entirely. The test sends a `fetch()` request from User B's session cookie directly to the Rails route, the same way an attacker would. The HTTP status and the post's unchanged content are the assertions that matter.

---

## 14. Comment la suite peut-elle évoluer avec le temps ?

Natural next steps, in priority order:

1. **API-level tests**: faster, cheaper to maintain, and catch backend regressions independently of UI changes.
2. **Page Object Model**: once there are 15+ test files hitting the same pages, centralizing selectors in page classes becomes worth it.
3. **Test database reset**: a `beforeAll` hook or a teardown API call to restore a known DB state between runs.
4. **Cross-browser in CI**: add Firefox and WebKit to `playwright.config.ts` projects once the application is stable.
5. **Visual regression**: Playwright's `expect(page).toHaveScreenshot()` for layout-sensitive UI.

---

## 15. Qu'est-ce que tu ferais différemment pour une équipe ?

- Add a shared test data factory with typed builders (`buildPost()`, `buildUser()`) instead of inline strings.
- Add linting (ESLint + `@typescript-eslint`) to enforce consistent patterns across contributors.
- Configure database teardown so tests leave no residue.
- Write a `CONTRIBUTING.md` that defines naming conventions, fixture patterns, and the "no `waitForTimeout()`" rule.
- Add a pre-commit hook (`husky` + `tsc --noEmit`) so TypeScript errors are caught before push.

---

## 16. Quelles sont les limites connues de cette suite ?

- **No database cleanup**: test users and posts accumulate. Fine locally, a problem in long-running staging environments.
- **BUG-01 workaround**: `signUp()` navigates to `/` after sign-up to work around the Devise redirect crash. If BUG-01 is fixed, the extra navigation is harmless but redundant.
- **Single-quote crash only**: the SQL injection test detects the crash symptom. It does not verify the root cause or confirm that a fix closes all injection vectors.
- **`<script>` payload only**: the XSS test uses the most common payload. Event-based XSS (`<img onerror=...>`) and CSS injection are not covered.
- **No negative IDOR path**: the test confirms that cross-user PATCH/DELETE is rejected. It does not test that the *owner* can still edit and delete their own posts — a separate test would cover that.
- **`workers: 1`**: sequential execution is safe but slow. A suite of 50+ tests would need database isolation to run in parallel safely.
