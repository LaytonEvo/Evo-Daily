#!/usr/bin/env node
// Post-deploy smoke test. Run against a deployed environment:
//
//   SMOKE_URL=https://… npm run smoke
//   SMOKE_URL=https://… SMOKE_EMAIL=… SMOKE_PASSWORD=… npm run smoke   # also signs in
//
// Read-only: it loads pages and checks guards, and never runs a job. Exits
// non-zero on the first failure, so it can gate a pipeline.

const base = (process.env.SMOKE_URL ?? "").replace(/\/$/, "");
if (!base) {
  console.error("Set SMOKE_URL");
  process.exit(2);
}

let failures = 0;
async function check(name, fn) {
  try {
    await fn();
    console.log(`ok   ${name}`);
  } catch (error) {
    failures += 1;
    console.log(`FAIL ${name}: ${error.message}`);
  }
}
function expect(cond, message) {
  if (!cond) throw new Error(message);
}

await check("health endpoint", async () => {
  const r = await fetch(`${base}/api/health`);
  const body = await r.json();
  expect(r.status === 200 && body.ok === true, `status ${r.status} ${JSON.stringify(body)}`);
});

await check("login page renders", async () => {
  const r = await fetch(`${base}/login`);
  expect(r.status === 200 && (await r.text()).includes("Sign in"), `status ${r.status}`);
});

for (const path of ["/my-day", "/approvals", "/admin/health"]) {
  await check(`${path} needs a session`, async () => {
    const r = await fetch(`${base}${path}`, { redirect: "manual" });
    expect(r.status >= 300 && r.status < 400 && (r.headers.get("location") ?? "").includes("/login"), `status ${r.status}`);
  });
}

for (const path of ["/api/cron/generate", "/api/cron/run/hub.monitor"]) {
  await check(`${path} refuses no secret`, async () => {
    const r = await fetch(`${base}${path}`, { method: "POST" });
    expect(r.status === 401, `status ${r.status}`);
  });
}

if (process.env.SMOKE_EMAIL && process.env.SMOKE_PASSWORD) {
  const jar = new Map();
  const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const keep = (r) => {
    for (const c of r.headers.getSetCookie?.() ?? []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };

  await check("signs in", async () => {
    const csrf = await fetch(`${base}/api/auth/csrf`);
    keep(csrf);
    const { csrfToken } = await csrf.json();
    const r = await fetch(`${base}/api/auth/callback/credentials`, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookieHeader() },
      body: new URLSearchParams({ csrfToken, email: process.env.SMOKE_EMAIL, password: process.env.SMOKE_PASSWORD }),
    });
    keep(r);
    expect([...jar.keys()].some((k) => k.includes("session-token")), `no session cookie (status ${r.status})`);
  });

  for (const path of ["/my-day", "/approvals", "/admin/activity", "/admin/health"]) {
    await check(`${path} loads signed in`, async () => {
      const r = await fetch(`${base}${path}`, { headers: { cookie: cookieHeader() }, redirect: "manual" });
      expect(r.status === 200, `status ${r.status}`);
    });
  }
}

console.log(failures ? `\n${failures} check(s) failed` : "\nAll smoke checks passed");
process.exit(failures ? 1 : 0);
