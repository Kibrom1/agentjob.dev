// Minimal PostgREST-compatible HTTP layer over a real PostgreSQL database.
//
// It implements exactly the subset of the PostgREST API that the app and
// supabase-js use (RPC calls, filtered selects with many-to-one embeds,
// counts, updates), and executes every request under the Supabase role that
// the API key maps to. That keeps RLS, column grants and function privileges
// in force during end-to-end tests, without Docker or the Supabase CLI.
import http from "node:http";
import pg from "pg";

const DATABASE_URL = process.env.SHIM_DATABASE_URL;
const PORT = Number(process.env.SHIM_PORT ?? 54321);
const ANON_KEY = process.env.SHIM_ANON_KEY;
const SERVICE_KEY = process.env.SHIM_SERVICE_KEY;

if (!DATABASE_URL || !ANON_KEY || !SERVICE_KEY) {
  console.error("SHIM_DATABASE_URL, SHIM_ANON_KEY and SHIM_SERVICE_KEY are required");
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 8 });
const ident = (name) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(name)) throw httpError(400, "PGRST100", `invalid identifier ${name}`);
  return `"${name}"`;
};

function httpError(status, code, message) {
  return Object.assign(new Error(message), { status, code });
}

function roleFor(req) {
  const key = req.headers.apikey;
  if (key === SERVICE_KEY) return "service_role";
  if (key === ANON_KEY) return "anon";
  throw httpError(401, "PGRST301", "invalid api key");
}

async function withRole(role, fn) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`set local role ${role}`);
    const result = await fn(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

// ---------------------------------------------------------------------------
// Catalog helpers (cached)
// ---------------------------------------------------------------------------
const functionCache = new Map();
async function functionInfo(name) {
  if (functionCache.has(name)) return functionCache.get(name);
  const { rows } = await pool.query(
    `select p.proretset as returns_set,
            t.typtype as return_kind,
            t.typname as return_type,
            coalesce(p.proargnames, '{}') as arg_names,
            coalesce(p.proargmodes::text[], '{}') as arg_modes,
            array(select format_type(x, null) from unnest(p.proargtypes) x) as arg_types
       from pg_proc p
       join pg_namespace n on n.oid = p.pronamespace
       join pg_type t on t.oid = p.prorettype
      where n.nspname = 'public' and p.proname = $1`,
    [name],
  );
  if (rows.length !== 1) throw httpError(404, "PGRST202", `function ${name} not found`);
  const row = rows[0];
  const inputNames = row.arg_names.filter((_, i) => !row.arg_modes[i] || row.arg_modes[i] === "i");
  const info = {
    returnsSet: row.returns_set,
    isComposite: row.return_kind === "c",
    isVoid: row.return_type === "void",
    args: Object.fromEntries(inputNames.map((argName, i) => [argName, row.arg_types[i]])),
  };
  functionCache.set(name, info);
  return info;
}

const fkCache = new Map();
async function manyToOne(table, related) {
  const key = `${table}->${related}`;
  if (fkCache.has(key)) return fkCache.get(key);
  const { rows } = await pool.query(
    `select a.attname as column, fa.attname as foreign_column
       from pg_constraint c
       join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
       join pg_attribute fa on fa.attrelid = c.confrelid and fa.attnum = c.confkey[1]
      where c.contype = 'f'
        and c.conrelid = ('public.' || $1)::regclass
        and c.confrelid = ('public.' || $2)::regclass`,
    [table, related],
  );
  if (rows.length !== 1) throw httpError(400, "PGRST200", `no relationship ${table} -> ${related}`);
  fkCache.set(key, rows[0]);
  return rows[0];
}

// ---------------------------------------------------------------------------
// Query string → SQL
// ---------------------------------------------------------------------------
function splitTopLevel(text, separator = ",") {
  const parts = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (!quoted && char === "(") depth++;
    if (!quoted && char === ")") depth--;
    if (!quoted && depth === 0 && char === separator) {
      parts.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  if (current) parts.push(current);
  return parts.map((part) => part.trim()).filter(Boolean);
}

async function selectList(table, select, alias) {
  const items = splitTopLevel(select.replace(/\s+/g, ""));
  const columns = [];
  for (const item of items) {
    const embed = /^(?:([a-z_]+):)?([a-z_]+)\((.*)\)$/.exec(item);
    if (embed) {
      const [, as, related, inner] = embed;
      const fk = await manyToOne(table, related);
      const innerColumns = splitTopLevel(inner).map((column) => `'${column}', r.${ident(column)}`).join(", ");
      columns.push(
        `(select jsonb_build_object(${innerColumns}) from public.${ident(related)} r where r.${ident(fk.foreign_column)} = ${alias}.${ident(fk.column)}) as ${ident(as ?? related)}`,
      );
    } else if (item === "*") {
      columns.push(`${alias}.*`);
    } else {
      columns.push(`${alias}.${ident(item)}`);
    }
  }
  return columns.join(", ");
}

function unquote(value) {
  return value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1).replace(/\\"/g, '"') : value;
}

function condition(column, expression, params, alias) {
  const dot = expression.indexOf(".");
  const operator = expression.slice(0, dot);
  const raw = unquote(expression.slice(dot + 1));
  const target = `${alias}.${ident(column)}`;
  const push = (value) => {
    params.push(value);
    return `$${params.length}`;
  };
  switch (operator) {
    case "eq":
      return `${target} = ${push(raw)}`;
    case "neq":
      return `${target} <> ${push(raw)}`;
    case "gt":
      return `${target} > ${push(raw)}`;
    case "gte":
      return `${target} >= ${push(raw)}`;
    case "lt":
      return `${target} < ${push(raw)}`;
    case "lte":
      return `${target} <= ${push(raw)}`;
    case "ilike":
      return `${target}::text ilike ${push(raw.replace(/\*/g, "%"))}`;
    case "is":
      if (!["null", "true", "false"].includes(raw)) throw httpError(400, "PGRST100", `bad is value ${raw}`);
      return `${target} is ${raw}`;
    case "in": {
      const values = splitTopLevel(raw.replace(/^\(|\)$/g, "")).map(unquote);
      return `${target}::text = any(${push(values)}::text[])`;
    }
    default:
      throw httpError(400, "PGRST100", `unsupported operator ${operator}`);
  }
}

function whereClause(searchParams, params, alias) {
  const conditions = [];
  for (const [key, value] of searchParams) {
    if (["select", "order", "limit", "offset", "columns"].includes(key)) continue;
    if (key === "or") {
      const inner = splitTopLevel(value.replace(/^\(|\)$/g, "")).map((part) => {
        const dot = part.indexOf(".");
        return condition(part.slice(0, dot), part.slice(dot + 1), params, alias);
      });
      conditions.push(`(${inner.join(" or ")})`);
    } else {
      conditions.push(condition(key, value, params, alias));
    }
  }
  return conditions.length ? `where ${conditions.join(" and ")}` : "";
}

function orderClause(order, alias) {
  if (!order) return "";
  const parts = order.split(",").map((part) => {
    const [column, direction = "asc"] = part.split(".");
    if (!["asc", "desc"].includes(direction)) throw httpError(400, "PGRST100", `bad order ${part}`);
    return `${alias}.${ident(column)} ${direction}`;
  });
  return `order by ${parts.join(", ")}`;
}

// ---------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------
async function handleRpc(req, res, fnName, body) {
  const info = await functionInfo(fnName);
  const args = body ? JSON.parse(body) : {};
  const params = [];
  const named = Object.entries(args).map(([name, value]) => {
    const type = info.args[name];
    if (!type) throw httpError(400, "PGRST202", `unknown argument ${name} for ${fnName}`);
    params.push(value === null ? null : type === "jsonb" || type === "json" ? JSON.stringify(value) : String(value));
    return `${ident(name)} => $${params.length}::${type}`;
  });
  const call = `public.${ident(fnName)}(${named.join(", ")})`;
  const sql = info.returnsSet
    ? `select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) as body from ${call} t`
    : `select to_jsonb(${call}) as body`;

  const role = roleFor(req);
  const body_ = await withRole(role, async (client) => (await client.query(sql, params)).rows[0].body);
  if (info.isVoid) {
    res.writeHead(204).end();
    return;
  }
  send(res, 200, body_);
}

async function handleSelect(req, res, table, url) {
  const role = roleFor(req);
  const params = [];
  const alias = "t";
  const columns = await selectList(table, url.searchParams.get("select") ?? "*", alias);
  const where = whereClause(url.searchParams, params, alias);
  const order = orderClause(url.searchParams.get("order"), alias);
  const limit = url.searchParams.get("limit");
  const offset = url.searchParams.get("offset");
  const paging = `${limit ? `limit ${Number(limit)}` : ""} ${offset ? `offset ${Number(offset)}` : ""}`;
  const wantsCount = /count=exact/.test(req.headers.prefer ?? "");

  const { rows, total } = await withRole(role, async (client) => {
    const data = await client.query(
      `select coalesce(jsonb_agg(x), '[]'::jsonb) as rows from (select ${columns} from public.${ident(table)} ${alias} ${where} ${order} ${paging}) x`,
      params,
    );
    let count = null;
    if (wantsCount) {
      count = (await client.query(`select count(*)::int as n from public.${ident(table)} ${alias} ${where}`, params)).rows[0].n;
    }
    return { rows: data.rows[0].rows, total: count };
  });

  const headers = {};
  if (wantsCount) headers["Content-Range"] = `${rows.length ? `0-${rows.length - 1}` : "*"}/${total}`;

  if (req.method === "HEAD") {
    res.writeHead(200, headers).end();
    return;
  }
  if ((req.headers.accept ?? "").includes("application/vnd.pgrst.object+json")) {
    if (rows.length !== 1) {
      send(res, 406, { code: "PGRST116", message: `JSON object requested, multiple (or no) rows returned`, details: `${rows.length} rows`, hint: null });
      return;
    }
    send(res, 200, rows[0], headers);
    return;
  }
  send(res, 200, rows, headers);
}

async function handleUpdate(req, res, table, url, body) {
  const role = roleFor(req);
  const values = JSON.parse(body);
  const params = [];
  const sets = Object.entries(values).map(([column, value]) => {
    params.push(value);
    return `${ident(column)} = $${params.length}`;
  });
  const where = whereClause(url.searchParams, params, "t");
  const count = await withRole(role, async (client) => (await client.query(`update public.${ident(table)} t set ${sets.join(", ")} ${where}`, params)).rowCount);
  res.writeHead(204, { "Content-Range": `*/${count}` }).end();
}

function send(res, status, body, headers = {}) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(body));
}

const STATUS_FOR_SQLSTATE = { 42501: 401, P0002: 404, 23505: 409, 23503: 409, 23514: 400, 22023: 400, "22P02": 400 };

const server = http.createServer((req, res) => {
  let body = "";
  req.on("data", (chunk) => (body += chunk));
  req.on("end", async () => {
    const url = new URL(req.url, `http://${req.headers.host}`);
    try {
      const rpc = /^\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname);
      const table = /^\/rest\/v1\/([a-z_]+)$/.exec(url.pathname);
      if (rpc && req.method === "POST") await handleRpc(req, res, rpc[1], body);
      else if (table && (req.method === "GET" || req.method === "HEAD")) await handleSelect(req, res, table[1], url);
      else if (table && req.method === "PATCH") await handleUpdate(req, res, table[1], url, body);
      else send(res, 404, { code: "PGRST000", message: `unsupported ${req.method} ${url.pathname}` });
    } catch (error) {
      const status = error.status ?? STATUS_FOR_SQLSTATE[error.code] ?? 400;
      if (process.env.SHIM_DEBUG) console.error(req.method, req.url, error.message);
      send(res, status, { code: error.code ?? "PGRST000", message: error.message, details: error.detail ?? null, hint: error.hint ?? null });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => console.log(`postgrest-shim listening on ${PORT}`));

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    server.close();
    pool.end().finally(() => process.exit(0));
  });
}
