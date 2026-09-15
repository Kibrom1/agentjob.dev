// End-to-end scenario against a production build, the real schema (via the
// PostgREST shim) and local Stripe/Resend doubles. Run through
// scripts/test-e2e.sh, which starts every process and sets the environment.
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import pg from "pg";
import Stripe from "stripe";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");

const APP = process.env.E2E_APP_URL;
const STRIPE_STUB = process.env.E2E_STRIPE_URL;
const RESEND_STUB = process.env.E2E_RESEND_URL;
const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;
const CRON_SECRET = process.env.CRON_SECRET;
const ADMIN = { username: process.env.ADMIN_USERNAME ?? "admin", password: process.env.ADMIN_PASSWORD };

const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
const stripe = new Stripe("sk_test_signing_only");
const results = [];
const ARTIFACTS = process.env.E2E_ARTIFACTS_DIR;
let activePage = null;

async function snapshot(page, name) {
  if (ARTIFACTS && process.env.E2E_SCREENSHOTS === "1") {
    await page.screenshot({ path: `${ARTIFACTS}/view-${name}.png`, fullPage: true });
  }
}

async function step(name, fn) {
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`  ✓ ${name}`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(`  ✗ ${name}\n    ${error.stack ?? error}`);
    if (ARTIFACTS && activePage) {
      const file = `${ARTIFACTS}/${name.replace(/[^a-z0-9]+/gi, "-").slice(0, 60)}.png`;
      await activePage.screenshot({ path: file, fullPage: true }).catch(() => {});
      console.log(`    screenshot: ${file}`);
    }
  }
}

const getJson = async (url, init) => (await fetch(url, init)).json();
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0];

function webhookRequest(type, session) {
  const payload = JSON.stringify({
    id: `evt_${Date.now()}${Math.random().toString(16).slice(2)}`,
    object: "event",
    type,
    created: Math.floor(Date.now() / 1000),
    livemode: false,
    data: { object: session },
  });
  const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: WEBHOOK_SECRET });
  return fetch(`${APP}/api/stripe/webhook`, {
    method: "POST",
    headers: { "stripe-signature": signature, "content-type": "application/json" },
    body: payload,
  });
}

async function postJob(page, { title, email, featured }) {
  await page.goto(`${APP}/post-a-job`);
  const next = () => page.getByRole("button", { name: "Continue →" }).click();

  await next();
  assert.ok(await page.getByText("Company name is required").isVisible(), "step 1 validation shown");
  await snapshot(page, "post-step1-errors");
  await page.getByLabel("Company name").fill("Orbit Labs");
  await page.getByLabel("Company website").fill("https://orbit.example");
  await page.getByLabel("Your email").fill(email);
  await next();

  await page.getByLabel("Job title").fill(title);
  await page.getByLabel("Category").selectOption("agent-orchestration");
  await page.getByLabel("Workplace").selectOption("remote");
  await page.getByLabel("Location").fill("Remote (EU)");
  await page.getByLabel("Tags").fill("LangGraph, Python, MCP");
  await next();

  await page.locator("textarea[name=description]").fill(
    "## About the role\n\nBuild the planner, memory and **tool-calling runtime** for production agents.\n\n- LangGraph\n- MCP",
  );
  await page.getByRole("button", { name: "Preview" }).click();
  assert.ok(await page.getByRole("heading", { name: "About the role" }).isVisible(), "markdown preview renders");
  await page.getByRole("button", { name: "Write" }).click();
  await next();

  await page.getByLabel("Salary from").fill("150000");
  await page.getByLabel("Salary to").fill("120000");
  await next();
  assert.ok(await page.getByText("Maximum salary must be greater").isVisible(), "salary range validated");
  await page.getByLabel("Salary to").fill("190000");
  await page.getByLabel("How to apply").fill("jobs@orbit.example");
  await next();

  if (featured) await page.getByLabel(/Feature this listing/).check();
  await snapshot(page, "post-review");
  const cta = page.getByRole("button", { name: /Continue to payment/ });
  assert.match(await cta.innerText(), featured ? /\$248/ : /\$149/);
  await Promise.all([page.waitForURL(/\/pay\/cs_test_/), cta.click()]);
  return new URL(page.url()).pathname.split("/").pop();
}

async function main() {
  await db.connect();
  const browser = await chromium.launch();
  const context = await browser.newContext({ reducedMotion: "reduce" });
  const page = await context.newPage();
  activePage = page;
  const consoleErrors = [];
  page.on("pageerror", (error) => consoleErrors.push(String(error)));

  console.log("E2E scenario");

  let featuredSession;
  let featuredJob;
  await step("employer completes the multi-step form and is sent to Stripe Checkout", async () => {
    featuredSession = await postJob(page, { title: "Staff Agent Runtime Engineer", email: "Founder@Orbit.example", featured: true });
    featuredJob = await one("select * from jobs where stripe_checkout_session_id = $1", [featuredSession]);
    assert.equal(featuredJob.status, "pending_payment");
    assert.equal(featuredJob.apply_url, "mailto:jobs@orbit.example");
    assert.deepEqual(featuredJob.tags, ["LangGraph", "Python", "MCP"]);
    const employer = await one("select * from employers where id = $1", [featuredJob.employer_id]);
    assert.equal(employer.email, "founder@orbit.example");
    const sessions = await getJson(`${STRIPE_STUB}/__test/sessions`);
    const session = sessions.find((s) => s.id === featuredSession);
    assert.equal(session.amount_subtotal, 24_800);
    assert.deepEqual(session.metadata, { job_id: featuredJob.id, plan: "featured" });
    assert.ok((await one("select count(*)::int as n from rate_limits where key like 'post-job:%'")).n >= 1);
  });

  await step("unpaid job is not public", async () => {
    const response = await fetch(`${APP}/jobs/${featuredJob.slug}`);
    assert.equal(response.status, 404);
  });

  await step("forged and tampered webhooks are rejected", async () => {
    const forged = await fetch(`${APP}/api/stripe/webhook`, {
      method: "POST",
      headers: { "stripe-signature": "t=1,v1=00", "content-type": "application/json" },
      body: JSON.stringify({ type: "checkout.session.completed" }),
    });
    assert.equal(forged.status, 400);
    const session = (await getJson(`${STRIPE_STUB}/__test/sessions`)).find((s) => s.id === featuredSession);
    const underpaid = await webhookRequest("checkout.session.completed", {
      ...session,
      payment_status: "paid",
      amount_subtotal: 14_900,
    });
    assert.equal((await underpaid.json()).outcome, "amount_mismatch");
    assert.equal((await one("select status from jobs where id = $1", [featuredJob.id])).status, "pending_payment");
  });

  await step("verified payment webhook publishes the job and emails the employer", async () => {
    const paid = await getJson(`${STRIPE_STUB}/__test/sessions/${featuredSession}/pay`, { method: "POST" });
    const response = await webhookRequest("checkout.session.completed", paid);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).outcome, "activated");
    const job = await one("select * from jobs where id = $1", [featuredJob.id]);
    assert.equal(job.status, "active");
    assert.equal(job.is_featured, true);
    const employer = await one("select stripe_customer_id from employers where id = $1", [job.employer_id]);
    assert.equal(employer.stripe_customer_id, "cus_TestE2e0001");
    const emails = await getJson(`${RESEND_STUB}/__test/emails`);
    const confirmation = emails.find((e) => e.subject === "Your listing is live: Staff Agent Runtime Engineer");
    assert.ok(confirmation, "confirmation email sent");
    assert.deepEqual(confirmation.to, ["founder@orbit.example"]);
    assert.equal(confirmation.idempotencyKey, `posting-confirmation/${job.id}`);

    const replay = await webhookRequest("checkout.session.completed", paid);
    assert.equal((await replay.json()).outcome, "already_active");
  });

  await step("success page confirms the live listing", async () => {
    await page.goto(`${APP}/post-a-job/success?session_id=${featuredSession}`);
    assert.ok(await page.getByRole("heading", { name: /Your listing is live/ }).isVisible());
    await snapshot(page, "success");
    await page.getByRole("link", { name: "View your listing" }).click();
    await page.waitForURL(/\/jobs\//);
    assert.ok(await page.getByRole("heading", { level: 1, name: "Staff Agent Runtime Engineer" }).isVisible());
  });

  await step("success page confirms payment directly when the webhook is late", async () => {
    const sessionId = await postJob(page, { title: "Senior MCP Integrations Engineer", email: "hiring@orbit.example", featured: false });
    await getJson(`${STRIPE_STUB}/__test/sessions/${sessionId}/pay`, { method: "POST" });
    await page.goto(`${APP}/post-a-job/success?session_id=${sessionId}`);
    assert.ok(await page.getByRole("heading", { name: /Your listing is live/ }).isVisible());
    const job = await one("select status, is_featured from jobs where stripe_checkout_session_id = $1", [sessionId]);
    assert.deepEqual(job, { status: "active", is_featured: false });
  });

  await step("cancelled checkout restores the draft and expired sessions are recorded", async () => {
    const sessionId = await postJob(page, { title: "Agent Evals Engineer", email: "evals@orbit.example", featured: false });
    await page.goto(`${APP}/post-a-job?canceled=1`);
    await page.getByText("Checkout was cancelled").waitFor();
    await page.getByText("We restored the details").waitFor();
    assert.equal(await page.getByLabel("Company name").inputValue(), "Orbit Labs");
    const session = (await getJson(`${STRIPE_STUB}/__test/sessions`)).find((s) => s.id === sessionId);
    const response = await webhookRequest("checkout.session.expired", { ...session, status: "expired" });
    assert.equal((await response.json()).outcome, "expired");
    assert.equal((await one("select status from jobs where stripe_checkout_session_id = $1", [sessionId])).status, "payment_expired");
    await page.goto(`${APP}/post-a-job/success?session_id=${sessionId}`);
    assert.ok(await page.getByRole("heading", { name: "This checkout is no longer active" }).isVisible());
  });

  await step("feed pins the featured job and search finds it", async () => {
    await page.goto(`${APP}/`);
    const first = page.locator("article").first();
    assert.match(await first.innerText(), /Staff Agent Runtime Engineer/);
    assert.match(await first.innerText(), /Featured/);
    await page.fill("#job-search", "mcp integrations");
    await page.waitForURL(/q=mcp/);
    await page.waitForFunction(() => document.querySelectorAll("article").length === 1);
    assert.match(await page.locator("article").first().innerText(), /Senior MCP Integrations Engineer/);
  });

  let subscriber;
  await step("visitor subscribes to the digest", async () => {
    await db.query("delete from rate_limits where key like 'subscribe:%'");
    await page.goto(`${APP}/`);
    await page.fill("#home-digest-email", "  Reader@Example.com ");
    await page.locator("#subscribe button[type=submit]").click();
    await page.locator("#subscribe [role=status]").waitFor();
    subscriber = await one("select * from subscribers where email = 'reader@example.com'");
    assert.ok(subscriber);
    await db.query("update subscribers set created_at = now() - interval '1 day' where id = $1", [subscriber.id]);
  });

  await step("cron endpoints require the secret", async () => {
    assert.equal((await fetch(`${APP}/api/cron/digest`)).status, 401);
    assert.equal((await fetch(`${APP}/api/cron/maintenance`, { headers: { authorization: "Bearer wrong" } })).status, 401);
  });

  await step("weekly digest is sent once, with one-click unsubscribe", async () => {
    const auth = { headers: { authorization: `Bearer ${CRON_SECRET}` } };
    const first = await getJson(`${APP}/api/cron/digest?force=1`, auth);
    assert.equal(first.status, "completed", JSON.stringify(first));
    assert.equal(first.sent, 1);
    assert.ok(first.jobs >= 2);
    const again = await getJson(`${APP}/api/cron/digest?force=1`, auth);
    assert.equal(again.status, "already_finished");

    const digest = (await getJson(`${RESEND_STUB}/__test/emails`)).filter((e) => e.tags?.[0]?.value === "weekly_digest");
    assert.equal(digest.length, 1);
    assert.deepEqual(digest[0].to, ["reader@example.com"]);
    assert.match(digest[0].html, /Staff Agent Runtime Engineer/);
    const listUnsubscribe = digest[0].headers["List-Unsubscribe"].slice(1, -1);
    assert.equal(listUnsubscribe, `${process.env.NEXT_PUBLIC_SITE_URL}/api/unsubscribe/${subscriber.unsubscribe_token}`);

    const oneClick = await fetch(`${APP}/api/unsubscribe/${subscriber.unsubscribe_token}`, { method: "POST" });
    assert.equal(oneClick.status, 200);
    assert.ok((await one("select unsubscribed_at from subscribers where id = $1", [subscriber.id])).unsubscribed_at);
  });

  await step("unsubscribe page requires confirmation and handles bad tokens", async () => {
    await db.query("insert into subscribers (email) values ('second@example.com')");
    const second = await one("select unsubscribe_token from subscribers where email = 'second@example.com'");
    await page.goto(`${APP}/unsubscribe/${second.unsubscribe_token}`);
    assert.equal((await one("select unsubscribed_at from subscribers where email = 'second@example.com'")).unsubscribed_at, null);
    await snapshot(page, "unsubscribe");
    await page.getByRole("button", { name: "Confirm unsubscribe" }).click();
    await page.getByRole("heading", { name: "You're unsubscribed" }).waitFor();
    assert.ok((await one("select unsubscribed_at from subscribers where email = 'second@example.com'")).unsubscribed_at);
    assert.equal((await fetch(`${APP}/unsubscribe/not-a-token`)).status, 404);
    const unknown = await fetch(`${APP}/api/unsubscribe/00000000-0000-4000-8000-000000000000`, { method: "POST" });
    assert.equal((await unknown.json()).result, "unknown_token");
  });

  await step("maintenance cron runs", async () => {
    const response = await getJson(`${APP}/api/cron/maintenance`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    assert.equal(response.ok, true);
    assert.ok("expired_jobs" in response.result);
  });

  await step("admin console is protected and can moderate listings", async () => {
    assert.equal((await fetch(`${APP}/admin`)).status, 401);
    const wrong = Buffer.from(`${ADMIN.username}:nope`).toString("base64");
    assert.equal((await fetch(`${APP}/admin`, { headers: { authorization: `Basic ${wrong}` } })).status, 401);

    const admin = await browser.newContext({ httpCredentials: ADMIN, reducedMotion: "reduce" });
    const adminPage = await admin.newPage();
    await adminPage.goto(`${APP}/admin?status=active`);
    await adminPage.getByRole("heading", { name: /Jobs/ }).waitFor();
    await snapshot(adminPage, "admin");
    const row = adminPage.locator("tr", { hasText: "Senior MCP Integrations Engineer" });
    await row.getByRole("button", { name: "Reject" }).click();
    await adminPage.waitForLoadState("networkidle");
    const job = await one("select slug, status from jobs where title = 'Senior MCP Integrations Engineer'");
    assert.equal(job.status, "rejected");
    assert.equal((await fetch(`${APP}/jobs/${job.slug}`)).status, 404);

    await adminPage.goto(`${APP}/admin/jobs/new`);
    await adminPage.getByRole("button", { name: "Publish listing" }).click();
    await adminPage.getByText("Please fix the highlighted fields.").waitFor();
    await adminPage.getByLabel("Job title").fill("Curated Multi-Agent Researcher");
    await adminPage.getByLabel("Company", { exact: true }).fill("Curated Co");
    await adminPage.getByLabel("Location").fill("London, UK");
    await adminPage.getByLabel("Apply URL or email").fill("https://curated.example/apply");
    await adminPage.getByLabel("Category").selectOption("multi-agent-systems");
    await adminPage.getByLabel("Description (Markdown)").fill("Research and ship multi-agent coordination for enterprise automation.");
    await Promise.all([adminPage.waitForURL(/\/admin\?created=/), adminPage.getByRole("button", { name: "Publish listing" }).click()]);
    const curated = await one("select status, source from jobs where title = 'Curated Multi-Agent Researcher'");
    assert.deepEqual(curated, { status: "active", source: "admin" });
    await admin.close();
  });

  await step("ops report requires the cron secret and reflects live state", async () => {
    assert.equal((await fetch(`${APP}/api/ops/report`)).status, 401);

    const report = await getJson(`${APP}/api/ops/report`, { headers: { authorization: `Bearer ${CRON_SECRET}` } });
    assert.equal(typeof report.generatedAt, "string");
    assert.ok(Array.isArray(report.flags));
    assert.ok(Array.isArray(report.stats.ingestion_last_runs));
    assert.equal(typeof report.summary, "string");
    // The just-rejected job and the newly curated one should already be reflected.
    assert.ok(report.stats.live_jobs >= 1);
    assert.ok(report.summary.includes("Live jobs:"));
  });

  await step("public recent-jobs feed powers marketing drafts", async () => {
    const recent = await getJson(`${APP}/api/jobs/recent?days=14`);
    assert.ok(Array.isArray(recent.jobs));
    assert.ok(recent.jobs.some((job) => job.title === "Curated Multi-Agent Researcher"));
    // Rejected jobs must never leak into a public feed.
    assert.ok(!recent.jobs.some((job) => job.title === "Senior MCP Integrations Engineer"));
  });

  await step("public endpoints stay healthy", async () => {
    const health = await getJson(`${APP}/api/health`);
    assert.equal(health.status, "ok");
    assert.equal(health.database, "ok");
    const sitemap = await (await fetch(`${APP}/sitemap.xml`)).text();
    assert.match(sitemap, /post-a-job/);
    assert.match(sitemap, /staff-agent-runtime-engineer/);
  });

  await step("no uncaught browser errors", async () => {
    assert.deepEqual(consoleErrors, []);
  });

  await browser.close();
  await db.end();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} steps passed`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (error) => {
  console.error(error);
  await db.end().catch(() => {});
  process.exit(1);
});
