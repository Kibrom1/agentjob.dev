// Local test doubles for the two external HTTP APIs the app calls:
//   Stripe  (checkout.sessions.create / retrieve)  on STUB_STRIPE_PORT
//   Resend  (POST /emails, POST /emails/batch)     on STUB_RESEND_PORT
// Each exposes /__test/* endpoints so the scenario can inspect and steer state.
import http from "node:http";
import { randomBytes } from "node:crypto";

const STRIPE_PORT = Number(process.env.STUB_STRIPE_PORT ?? 12111);
const RESEND_PORT = Number(process.env.STUB_RESEND_PORT ?? 12112);

const sessions = new Map();
const emails = [];

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", () => resolve(body));
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function createSession(form) {
  const id = `cs_test_${randomBytes(12).toString("hex")}`;
  let subtotal = 0;
  for (const [key, value] of form) {
    const match = /^line_items\[(\d+)\]\[price_data\]\[unit_amount\]$/.exec(key);
    if (match) subtotal += Number(value) * Number(form.get(`line_items[${match[1]}][quantity]`) ?? 1);
  }
  const metadata = {};
  for (const [key, value] of form) {
    const match = /^metadata\[(.+)\]$/.exec(key);
    if (match) metadata[match[1]] = value;
  }
  const session = {
    id,
    object: "checkout.session",
    url: `http://127.0.0.1:${STRIPE_PORT}/pay/${id}`,
    mode: form.get("mode"),
    currency: form.get("line_items[0][price_data][currency]"),
    amount_subtotal: subtotal,
    amount_total: subtotal,
    payment_status: "unpaid",
    status: "open",
    customer: null,
    customer_email: form.get("customer_email"),
    customer_details: null,
    client_reference_id: form.get("client_reference_id"),
    metadata,
    success_url: form.get("success_url"),
    cancel_url: form.get("cancel_url"),
    expires_at: Number(form.get("expires_at")),
  };
  sessions.set(id, session);
  return session;
}

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const body = await readBody(req);

    if (req.method === "POST" && url.pathname === "/v1/checkout/sessions") {
      if (!req.headers.authorization?.startsWith("Bearer sk_test_")) return json(res, 401, { error: { message: "bad key" } });
      return json(res, 200, createSession(new URLSearchParams(body)));
    }
    const retrieve = /^\/v1\/checkout\/sessions\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && retrieve) {
      const session = sessions.get(retrieve[1]);
      return session ? json(res, 200, session) : json(res, 404, { error: { type: "invalid_request_error", message: "No such session" } });
    }
    const pay = /^\/__test\/sessions\/([^/]+)\/pay$/.exec(url.pathname);
    if (req.method === "POST" && pay) {
      const session = sessions.get(pay[1]);
      if (!session) return json(res, 404, {});
      Object.assign(session, {
        payment_status: "paid",
        status: "complete",
        customer: "cus_TestE2e0001",
        customer_details: { email: session.customer_email },
      });
      return json(res, 200, session);
    }
    if (req.method === "GET" && url.pathname === "/__test/sessions") {
      return json(res, 200, [...sessions.values()]);
    }
    const page = /^\/pay\/([^/]+)$/.exec(url.pathname);
    if (req.method === "GET" && page) {
      res.writeHead(200, { "Content-Type": "text/html" });
      return res.end(`<!doctype html><title>Stub checkout</title><h1>Stub checkout ${page[1]}</h1>`);
    }
    json(res, 404, { error: { message: `stripe stub: ${req.method} ${url.pathname}` } });
  })
  .listen(STRIPE_PORT, "127.0.0.1");

http
  .createServer(async (req, res) => {
    const url = new URL(req.url, "http://stub");
    const body = await readBody(req);
    const auth = req.headers.authorization ?? "";
    if (url.pathname.startsWith("/emails") && !auth.startsWith("Bearer re_")) return json(res, 401, { message: "bad key" });

    if (req.method === "POST" && url.pathname === "/emails") {
      const message = JSON.parse(body);
      const id = `email_${emails.length + 1}`;
      emails.push({ id, idempotencyKey: req.headers["idempotency-key"] ?? null, ...message });
      return json(res, 200, { id });
    }
    if (req.method === "POST" && url.pathname === "/emails/batch") {
      const batch = JSON.parse(body);
      const ids = batch.map((message) => {
        const id = `email_${emails.length + 1}`;
        emails.push({ id, idempotencyKey: req.headers["idempotency-key"] ?? null, ...message });
        return { id };
      });
      return json(res, 200, { data: ids });
    }
    if (req.method === "GET" && url.pathname === "/__test/emails") return json(res, 200, emails);
    json(res, 404, { message: `resend stub: ${req.method} ${url.pathname}` });
  })
  .listen(RESEND_PORT, "127.0.0.1", () => console.log(`stubs listening on ${STRIPE_PORT} (stripe) and ${RESEND_PORT} (resend)`));
