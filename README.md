# Debifi QA — Automated Regression Tests

Playwright regression tests for the Debifi web application, developed as part of a QA technical assignment. The suite covers three confirmed defects: a SQL injection vulnerability in the search feature, a stored XSS vulnerability in the post body, and an authorization (IDOR) protection on post write operations.

---

## Tech stack

| Tool | Version | Role |
|------|---------|------|
| [Playwright](https://playwright.dev) | ^1.46 | Browser automation and test runner |
| TypeScript | 7.x | Type safety across test and helper code |
| Node.js | 20+ | Runtime |
| dotenv | ^16 | Local environment variable loading |

---

## Test coverage

| File | Defect | Campaign result | Test purpose |
|------|--------|-----------------|-------------|
| `tests/sql-injection.spec.ts` | BUG-08 | FAIL | Verifies search does not crash on single-quote input (3 payloads) |
| `tests/stored-xss.spec.ts` | BUG-07 | FAIL | Verifies XSS payload in post body is not executed |
| `tests/authorization.spec.ts` | POST-11 / POST-12 | PASS | Verifies server rejects cross-user PATCH and DELETE requests |

**Current state:** SQL injection and XSS tests fail — these bugs are confirmed open.
The authorization test passes — it is a regression guard to ensure protection is not accidentally removed.

---

## Project structure

```
debifi-qa-automation/
├── tests/
│   ├── sql-injection.spec.ts    # BUG-08 — crash on single-quote search input
│   ├── stored-xss.spec.ts       # BUG-07 — <script> in post body executes for all users
│   └── authorization.spec.ts   # POST-11/12 — cross-user PATCH/DELETE rejected server-side
├── fixtures/
│   └── auth.fixture.ts          # sign-up, sign-in, and createPost helper functions
├── test-data/
│   └── users.ts                 # generates unique test users per run
├── .github/
│   └── workflows/
│       └── playwright.yml       # GitHub Actions CI workflow
├── playwright.config.ts
├── tsconfig.json
├── package.json
├── .env.example
├── .gitignore
├── README.md
└── INTERVIEW_NOTES.md
```

No `pages/` directory: Page Object Model was intentionally omitted for a suite of this size. See [Test design decisions](#test-design-decisions).

---

## Prerequisites

- **Node.js 20+** — `node --version`
- **npm 9+** — included with Node.js
- **Docker + Docker Compose** — to run the Debifi application
- **The Debifi application repository** — these tests run against a live instance

---

## Installation

```bash
# 1. Clone this repository
git clone https://github.com/vireakchriv/debifi-qa-automation.git
cd debifi-qa-automation

# 2. Install Node dependencies
npm ci

# 3. Install Playwright browser (Chromium only)
npx playwright install chromium
```

---

## Environment variables

Copy `.env.example` to `.env` and adjust if needed:

```bash
cp .env.example .env
```

| Variable | Default | Description |
|----------|---------|-------------|
| `BASE_URL` | `http://localhost:3000` | URL of the running Debifi application |

The `.env` file is git-ignored. Never commit credentials.

---

## How to run the application

The Debifi application must be running before executing the tests.

```bash
# From the Debifi application directory:
docker compose up
```

Wait until you see Rails startup output and the server is listening on port 3000.
The application is ready when `curl http://localhost:3000` returns HTML.

---

## How to run the tests

```bash
# Run all tests (headless, sequential)
npm test

# Run with a visible browser window
npm run test:headed

# Run in debug mode (pauses at each step)
npm run test:debug
```

---

## How to run a specific test file

```bash
npx playwright test tests/sql-injection.spec.ts
npx playwright test tests/stored-xss.spec.ts
npx playwright test tests/authorization.spec.ts
```

---

## How to generate and view the HTML report

```bash
# Run tests (report is generated automatically)
npm test

# Open the report in your browser
npm run test:report
```

The report is saved to `playwright-report/`. It is git-ignored.

---

## CI/CD

A GitHub Actions workflow is provided at `.github/workflows/playwright.yml`.
It installs Node dependencies, installs the Playwright Chromium browser, and runs the test suite.

**Important:** the workflow requires a running Debifi instance to execute against. The workflow itself does not start the application. To use it:
- Set the `BASE_URL` repository secret in GitHub to point to a pre-deployed staging environment.
- The Debifi application must be accessible at that URL before the test step runs.

See the comments in `.github/workflows/playwright.yml` for options on how to integrate application startup into the CI pipeline.

---

## Test design decisions

### Why Playwright?

Playwright offers native support for multiple browser contexts in a single test process, which is essential for the IDOR test (two simultaneous authenticated sessions). It also provides a robust auto-wait API that eliminates the need for arbitrary `sleep()` calls, and first-class TypeScript support. Compared to Selenium, Playwright requires significantly less boilerplate. Compared to Cypress, it handles multi-context scenarios natively.

### Why these three tests?

- **BUG-08 (SQL injection):** The most reliable signal — any single-quote input reproducibly crashes the app. A parameterization fix has a clear, verifiable outcome: no crash, form still functional.
- **BUG-07 (Stored XSS):** Critical security defect; end-to-end reproducible from post creation to post view. A two-signal detection strategy (dialog + window property) makes the test robust.
- **POST-11/12 (IDOR):** Authorization was PASSING during the campaign. A regression test is the right tool here: it locks in the current correct behavior and will alert the team if a future refactor accidentally removes the protection.

### Why no Page Object Model?

POM is most valuable when the same pages and interactions are reused across many test files in a large suite. With three tests, the overhead of maintaining a layer of page classes would exceed the benefit. Instead, plain helper functions in `fixtures/auth.fixture.ts` provide the necessary reuse (sign-up, sign-in, post creation) without the structural overhead.

If the suite grows to 20+ tests, a `pages/` directory with classes for `HomePage`, `PostPage`, and `AuthPage` would be the natural next step.

### How authentication is handled

Each test creates its own unique user at runtime using `generateUser()` (timestamp + random suffix). This means:
- No shared credentials between tests
- No pre-seeded database state required
- No cleanup needed — each run creates fresh users

The `signUp()` and `signIn()` functions in `fixtures/auth.fixture.ts` are plain async helper functions called directly in each test — not Playwright fixtures in the `test.extend()` sense. The IDOR test uses two separate `browser.newContext()` calls — each context has its own isolated cookie jar, providing truly independent sessions for User A and User B.

### How test data is isolated

Each test creates all the data it needs at runtime. There are no shared users, no shared posts, and no dependencies on the database state from a previous test run. Because user emails include a timestamp and random suffix, repeated runs do not collide.

### How stability is ensured

- No `waitForTimeout()` or `sleep()` calls anywhere in the suite.
- Playwright's built-in auto-wait handles element visibility and navigation settling.
- `Promise.all([page.waitForURL(...), element.click()])` is used in the XSS test to avoid a race between click and URL-change registration.
- The dialog listener for XSS detection is registered before navigation — no timing gap.
- Tests are fully independent: no test relies on state left by another.

### Why tests are regression tests, not just bug reproductions

A "bug reproduction" test is only useful until the bug is fixed — then it passes and has no ongoing value. A regression test documents the *expected* behavior (no crash, no XSS execution, authorization enforced) and remains valuable indefinitely. When a future change inadvertently breaks a previously-passing feature, the regression test will detect it immediately.

---

## Limitations

- **No database cleanup.** Test users and posts accumulate in the database across runs. This is acceptable for a local assignment context; a production suite would use database transactions or a teardown API.
- **Single browser.** Tests run on Chromium only. Cross-browser coverage was provided separately via manual smoke testing on Brave.
- **SQL injection scope.** The SQL injection test verifies the crash behavior (single-quote input → PG::SyntaxError). It does not prove that a fix prevents *all* forms of SQL injection — that would require database-level inspection.
- **XSS scope.** The XSS test uses a `<script>alert('XSS')</script>` payload. Attribute-based XSS or CSS injection are not covered.
- **No API testing.** The application's routes are tested through the browser only. No HTTP-level testing of response headers, CORS, or authentication tokens was performed.
