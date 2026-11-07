// Usage: node scripts/http-sweep.mjs [--base http://localhost:3000] [--log dev.log]
import { readFileSync } from "node:fs";

const args = process.argv.slice(2);
const arg = (name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = arg("--base", "http://localhost:3000");
const LOG = arg("--log", null);
const ALICE = { email: "alice@example.com", password: "password123" };
const tag = Date.now().toString(36);
const CANARY = `CANARY-http-${tag}`;
const MASK = "••••••••";

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${!ok && detail ? `   -> ${detail}` : ""}`);
}

async function call(cookie, method, path, body, headers = {}, redirect = "manual") {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect,
    headers: {
      ...(cookie ? { Cookie: cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    body: body !== undefined ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined,
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  return { status: res.status, headers: res.headers, text, json, res };
}

async function login(creds) {
  const r = await call(null, "POST", "/api/auth/login", creds);
  if (r.status !== 200 && r.status !== 201) {
    throw new Error(`login failed for ${creds.email} (${r.status}). Is the dev server running and the demo data seeded?`);
  }
  const setCookies = r.res.headers.getSetCookie();
  const cookie = setCookies.map((c) => c.split(";")[0]).join("; ");
  if (!cookie) throw new Error("login returned no cookie");
  return { cookie, setCookies };
}

function fatal(msg) {
  console.error(`\nFATAL: ${msg}`);
  process.exit(2);
}

// ---- Setup ----
const alice = await login(ALICE);

const dash = await call(alice.cookie, "GET", "/dashboard");
const projectId = dash.text.match(/\/projects\/([a-z0-9]{20,})/)?.[1];
if (!projectId) fatal("could not find a project link on /dashboard for alice. Run `npm run db:seed` first.");

const projectPage = await call(alice.cookie, "GET", `/projects/${projectId}`);
const envId = projectPage.text.match(/env=([a-z0-9]{20,})/)?.[1];
if (!envId) fatal("could not find an environment on the project page. Make sure the project has environments.");

const outsiderCreds = { name: "Sweep Outsider", email: `sweep-${tag}@example.com`, password: "sweep-password-1" };
const signup = await call(null, "POST", "/api/auth/signup", outsiderCreds);
if (signup.status >= 400) fatal(`could not create the outsider account (${signup.status}).`);
const outsider = await login({ email: outsiderCreds.email, password: outsiderCreds.password });

const KEY = `SWEEP_${tag.toUpperCase()}`;
const created = await call(alice.cookie, "POST", `/api/environments/${envId}/variables`, {
  key: KEY,
  value: CANARY,
  isSensitive: true,
});
const varId = created.json?.variable?.id;
check("create sensitive variable returns 201", created.status === 201 && !!varId, `status ${created.status}`);
if (!varId) fatal("cannot continue without a created variable.");
check("create response does not echo the secret", !created.text.includes(CANARY));

// ---- Page and payload leaks ----
for (const [label, pagePath, headers] of [
  ["project page HTML", `/projects/${projectId}?env=${envId}`, {}],
  ["project page data payload (RSC)", `/projects/${projectId}?env=${envId}`, { RSC: "1" }],
  ["history page HTML", `/projects/${projectId}/history?env=${envId}`, {}],
  ["history page data payload (RSC)", `/projects/${projectId}/history?env=${envId}`, { RSC: "1" }],
]) {
  const isRsc = Boolean(headers.RSC);
  // Next may redirect a data request to add its cache-busting parameter, so follow it
  const r = await call(alice.cookie, "GET", pagePath, undefined, headers, isRsc ? "follow" : "manual");
  check(`${label}: loads`, r.status === 200, `status ${r.status} ${r.headers.get("location") ?? ""}`);
  if (isRsc) {
    const type = r.headers.get("content-type") ?? "none";
    check(`${label}: is a real RSC payload`, /text\/x-component/.test(type), type);
  }
  check(`${label}: lists the variable (so the next check is meaningful)`, r.text.includes(KEY));
  check(`${label}: contains no plaintext secret`, !r.text.includes(CANARY));
}

// ---- History API ----
const hist = await call(alice.cookie, "GET", `/api/environments/${envId}/history`);
check("history API: 200 with Cache-Control: no-store", hist.status === 200 && /no-store/i.test(hist.headers.get("cache-control") ?? ""));
check("history API: no plaintext secret", !hist.text.includes(CANARY));
const entry = hist.json?.items?.find((i) => i.key === KEY && i.action === "CREATE");
check("history API: shows the CREATE entry as masked", entry?.new?.masked === true && entry?.new?.value === MASK);
check("history API: unauthenticated gets 401", (await call(null, "GET", `/api/environments/${envId}/history`)).status === 401);
check("history API: outsider gets 404", (await call(outsider.cookie, "GET", `/api/environments/${envId}/history`)).status === 404);
for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
  const r = await call(alice.cookie, method, `/api/environments/${envId}/history`, method === "DELETE" ? undefined : {});
  check(`history API: ${method} is not allowed (405)`, r.status === 405, `status ${r.status}`);
}

// ---- Variable reveal ----
const revealPath = `/api/variables/${varId}/reveal`;
const rev = await call(alice.cookie, "POST", revealPath);
check("reveal: member gets the exact secret", rev.status === 200 && rev.json?.value === CANARY, `status ${rev.status}`);
check("reveal: response is Cache-Control: no-store", /no-store/i.test(rev.headers.get("cache-control") ?? ""));
check("reveal: unauthenticated gets 401", (await call(null, "POST", revealPath)).status === 401);
const revOut = await call(outsider.cookie, "POST", revealPath);
check("reveal: outsider gets 404 and no secret", revOut.status === 404 && !revOut.text.includes(CANARY), `status ${revOut.status}`);
check("reveal: GET is not allowed (405)", (await call(alice.cookie, "GET", revealPath)).status === 405);

// ---- History reveal ----
if (entry) {
  const hp = `/api/history/${entry.id}/reveal`;
  const hr = await call(alice.cookie, "POST", hp, { which: "new" });
  check("history reveal: member gets the exact secret, no-store", hr.status === 200 && hr.json?.value === CANARY && /no-store/i.test(hr.headers.get("cache-control") ?? ""));
  check("history reveal: no old value on a CREATE row (400)", (await call(alice.cookie, "POST", hp, { which: "old" })).status === 400);
  check("history reveal: unauthenticated gets 401", (await call(null, "POST", hp, { which: "new" })).status === 401);
  const ho = await call(outsider.cookie, "POST", hp, { which: "new" });
  check("history reveal: outsider gets 404 and no secret", ho.status === 404 && !ho.text.includes(CANARY));
  check("history reveal: GET is not allowed (405)", (await call(alice.cookie, "GET", hp)).status === 405);
  check("history reveal: invalid body is rejected (400)", (await call(alice.cookie, "POST", hp, { which: "both" })).status === 400);
} else {
  check("history reveal: found a CREATE entry to test", false);
}

// ---- Writes: guards, outsider, errors ----
const maskPatch = await call(alice.cookie, "PATCH", `/api/variables/${varId}`, { value: MASK, version: 1 });
check("mask placeholder is rejected as a value (400)", maskPatch.status === 400 && !maskPatch.text.includes(CANARY));
check("outsider cannot edit (404)", (await call(outsider.cookie, "PATCH", `/api/variables/${varId}`, { value: "x", version: 1 })).status === 404);
check("outsider cannot delete (404)", (await call(outsider.cookie, "DELETE", `/api/variables/${varId}`)).status === 404);
check("unauthenticated cannot edit (401)", (await call(null, "PATCH", `/api/variables/${varId}`, { value: "x", version: 1 })).status === 401);
check("outsider cannot create in this environment (404)", (await call(outsider.cookie, "POST", `/api/environments/${envId}/variables`, { key: "NOPE", value: "1" })).status === 404);

const bad = await call(alice.cookie, "POST", `/api/environments/${envId}/variables`, { key: "bad key", value: CANARY, isSensitive: true });
check("validation error is 400 and never echoes the submitted value", bad.status === 400 && !bad.text.includes(CANARY));
const malformed = await call(alice.cookie, "POST", `/api/environments/${envId}/variables`, "{not json");
check("malformed JSON returns a clean 4xx without a stack trace", malformed.status >= 400 && malformed.status < 500 && !/node_modules|\.tsx?:\d+/.test(malformed.text), `status ${malformed.status}`);

// ---- Login behaviour ----
const wrongPw = await call(null, "POST", "/api/auth/login", { email: ALICE.email, password: "definitely-wrong" });
const noUser = await call(null, "POST", "/api/auth/login", { email: `nobody-${tag}@example.com`, password: "definitely-wrong" });
check("login: wrong password and unknown email give the same error", !!wrongPw.json?.error && wrongPw.json.error === noUser.json?.error, `${wrongPw.json?.error} vs ${noUser.json?.error}`);
const cookieText = alice.setCookies.join(";");
check("login cookie is HttpOnly and SameSite=Lax", /HttpOnly/i.test(cookieText) && /SameSite=Lax/i.test(cookieText));

// ---- Optional: dev server log ----
if (LOG) {
  try {
    const log = readFileSync(LOG, "utf8");
    check("dev server log contains no plaintext secret", !log.includes(CANARY));
    check("dev server log contains no passwords", !log.includes(ALICE.password) && !log.includes(outsiderCreds.password));
  } catch {
    check(`could read the log file ${LOG}`, false);
  }
}

// ---- Cleanup ----
const del = await call(alice.cookie, "DELETE", `/api/variables/${varId}`);
check("cleanup: sweep variable deleted", del.status === 200);

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length) {
  console.log("Failed:");
  for (const f of failed) console.log(`  - ${f.name}`);
  process.exit(1);
}