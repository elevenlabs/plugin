# Code tool examples

Full patterns referenced from [SKILL.md](SKILL.md). Prefer projecting return fields; use `ctx.args` / `ctx.secrets` / `ctx.config` / `ctx.auth_connections` only.

---

## 1. Field-minimizing REST lookup

Lookup a wide customer row; return only what the agent needs.

```ts
export default async (ctx) => {
  const customerRef = String(ctx.args?.customerRef ?? "").trim();
  const { SUPABASE_URL } = ctx.config;
  const { SUPABASE_ANON_KEY } = ctx.secrets;

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/demo_customer_records?customer_ref=eq.${encodeURIComponent(customerRef)}&select=full_name,loyalty_tier,loyalty_points,billing_city`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
  );
  if (!res.ok) return { error: "lookup_failed", status: res.status };

  const [record] = await res.json();
  if (!record) return { error: "not_found" };

  // `record` may have 20+ columns (internal notes, risk score, audit log, addresses…).
  // Everything returned is read by the LLM — pick only the fields the agent needs.
  return {
    name: record.full_name,
    loyaltyTier: record.loyalty_tier,
    loyaltyPoints: record.loyalty_points,
    city: record.billing_city,
  };
};
```

**Context:** `ctx.config.SUPABASE_URL`, `ctx.secrets.SUPABASE_ANON_KEY`

**Domains:** host from `SUPABASE_URL` (e.g. `*.supabase.co`)

---

## 2. Bounded poll / long-running job

Start async work, poll with a hard attempt cap so the run stays under the tool timeout.

```ts
export default async (ctx) => {
  const videoTitle = String(ctx.args?.videoTitle ?? "Untitled").trim();
  const { SUPABASE_URL } = ctx.config;
  const { SUPABASE_ANON_KEY } = ctx.secrets;
  const headers = {
    apikey: SUPABASE_ANON_KEY,
    Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    "Content-Type": "application/json",
  };

  const startRes = await fetch(`${SUPABASE_URL}/rest/v1/demo_render_jobs`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({ video_title: videoTitle }),
  });
  if (!startRes.ok) {
    throw new Error(`Failed to start render: ${startRes.status}`);
  }

  const [job] = await startRes.json();
  if (!job?.id) throw new Error("Render API returned no job id");

  for (let attempt = 0; attempt < 5; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const checkRes = await fetch(
      `${SUPABASE_URL}/rest/v1/demo_render_jobs_status?id=eq.${job.id}&select=status,download_url`,
      { headers },
    );
    if (!checkRes.ok) {
      throw new Error(`Failed to check render: ${checkRes.status}`);
    }

    const [status] = await checkRes.json();

    if (status?.status === "done") {
      return { status: "done", downloadUrl: status.download_url };
    }
  }

  return { status: "still_rendering", jobId: job.id };
};
```

**Context:** `ctx.config.SUPABASE_URL`, `ctx.secrets.SUPABASE_ANON_KEY`

**Note:** 5 × 2s = 10s of waits alone — keep caps inside the 1–30s tool timeout.

---

## 3. Parallel fan-out (`Promise.all`)

Independent lookups in parallel; finish when the slower one completes.

```ts
export default async (ctx) => {
  const city = String(ctx.args?.city ?? "").trim();
  const ticker = String(ctx.args?.ticker ?? "").trim().toUpperCase();
  const { SUPABASE_URL } = ctx.config;
  const { SUPABASE_ANON_KEY } = ctx.secrets;
  const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` };

  const [weatherRes, stockRes] = await Promise.all([
    fetch(
      `${SUPABASE_URL}/rest/v1/demo_weather_by_city?city=eq.${encodeURIComponent(city)}&select=condition,temp_c`,
      { headers },
    ),
    fetch(
      `${SUPABASE_URL}/rest/v1/demo_stock_prices?ticker=eq.${encodeURIComponent(ticker)}&select=price_usd,change_pct`,
      { headers },
    ),
  ]);
  if (!weatherRes.ok || !stockRes.ok) {
    throw new Error(
      `Lookup failed: weather=${weatherRes.status}, stock=${stockRes.status}`,
    );
  }

  const [weather] = await weatherRes.json();
  const [stock] = await stockRes.json();

  return {
    weather: weather ? `${weather.condition}, ${weather.temp_c}°C` : "unknown city",
    stock: stock
      ? `$${stock.price_usd} (${stock.change_pct > 0 ? "+" : ""}${stock.change_pct}%)`
      : "unknown ticker",
  };
};
```

---

## 4. Best-effort side-effect via auth connection

`ctx.auth_connections.*` is a gateway reference, not the raw OAuth token. Attach it with `X-With-Auth-Connection`. Swallow log failures so they never break the tool.

```ts
export default async (ctx) => {
  const logEntry = {
    received: new Date().toISOString(),
    event: String(ctx.args?.event ?? ""),
    result: String(ctx.args?.result ?? ""),
    reason: String(ctx.args?.reason ?? ""),
    trackingNumber: String(ctx.args?.trackingNumber ?? ""),
  };

  let logged = false;
  try {
    const response = await fetch(`${ctx.config.LOG_SERVER}/logs`, {
      method: "POST",
      headers: {
        "X-With-Auth-Connection": ctx.auth_connections.EXAMPLE_OAUTH,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(logEntry),
    });
    logged = response.ok;
  } catch (e) {
    // Swallowed on purpose — logging must not fail the tool call.
  }

  return { logged };
};
```

**Context:** `ctx.config.LOG_SERVER`, `ctx.auth_connections.EXAMPLE_OAUTH`

**Domains:** host from `LOG_SERVER`

---

## 5. Secret-based API key call

Simple trusted-code path: use the real key from `ctx.secrets`.

```ts
export default async (ctx) => {
  const sku = String(ctx.args?.sku ?? "").trim();
  if (!sku) return { error: "sku is required" };

  const { SUPABASE_URL } = ctx.config;
  const { SUPABASE_ANON_KEY } = ctx.secrets;

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/demo_products?sku=eq.${encodeURIComponent(sku)}&select=name,price_cents,stock_qty`,
    { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${SUPABASE_ANON_KEY}` } },
  );
  if (!res.ok) return { error: "lookup_failed", status: res.status };

  const [product] = await res.json();
  if (!product) return { error: "not_found" };

  return {
    name: product.name,
    price: `$${(product.price_cents / 100).toFixed(2)}`,
    inStock: product.stock_qty > 0,
  };
};
```
