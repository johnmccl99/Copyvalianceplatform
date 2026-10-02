import { getDropboxAccessToken } from "./_dropbox-token.js";

const MOCK_ADAPTER = {
  vendor: "mock",
  resources: ["properties", "gl", "cash_accounts"],
  async sync({ resourceType }) {
    const plannedRead =
      { properties: 3, gl: 12, cash_accounts: 2 }[resourceType] || 0;
    await new Promise((r) => setTimeout(r, 25));
    return {
      rowsRead: plannedRead,
      rowsWritten: 0,
      partial: false,
      payload: {
        note: "Mock adapter — plumbing only; no rows written to business tables.",
      },
    };
  },
};

const INTUIT_TOKEN_URL =
  "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";

async function getQbAccessToken({ bearer, orgId, pgImpl }) {
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  if (!SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY not set — QB adapter cannot decrypt tokens",
    );
  }
  const pgSr = (opts) => pgImpl({ ...opts, bearer: SERVICE_ROLE_KEY });

  const rowRes = await pgSr({
    path:
      `/org_qb_integrations?org_id=eq.${encodeURIComponent(orgId)}` +
      `&select=id,refresh_token_encrypted,realm_id,environment,revoked_at&limit=1`,
  });
  if (!rowRes.ok || !Array.isArray(rowRes.body) || !rowRes.body.length) {
    throw new Error("QB not connected for this org");
  }
  const row = rowRes.body[0];
  if (row.revoked_at) throw new Error("QB connection revoked");
  if (!row.refresh_token_encrypted) throw new Error("QB refresh token missing");

  const decRes = await pgSr({
    path: "/rpc/qb_decrypt_refresh_token",
    method: "POST",
    body: { ciphertext: row.refresh_token_encrypted },
  });
  if (!decRes.ok || typeof decRes.body !== "string" || !decRes.body.length) {
    throw new Error("QB refresh token decrypt failed");
  }

  const clientId = process.env.VITE_QB_CLIENT_ID;
  const clientSecret = process.env.QB_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("QB adapter: VITE_QB_CLIENT_ID / QB_CLIENT_SECRET not set");
  }
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString(
    "base64",
  );
  const params = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: decRes.body,
  });
  const tokenRes = await fetch(INTUIT_TOKEN_URL, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: params.toString(),
  });
  const tokenData = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok) {
    throw new Error(
      `QB token refresh failed: ${tokenData?.error || tokenRes.status}`,
    );
  }

  if (tokenData.refresh_token) {
    const encRes = await pgSr({
      path: "/rpc/qb_encrypt_refresh_token",
      method: "POST",
      body: { plaintext: tokenData.refresh_token },
    });
    if (encRes.ok) {
      const accessExpiresAt = new Date(
        Date.now() + Number(tokenData.expires_in || 3600) * 1000,
      ).toISOString();
      const refreshExpiresAt = new Date(
        Date.now() +
          Number(tokenData.x_refresh_token_expires_in || 8726400) * 1000,
      ).toISOString();
      await pgSr({
        path: `/org_qb_integrations?id=eq.${encodeURIComponent(row.id)}`,
        method: "PATCH",
        body: {
          refresh_token_encrypted: encRes.body,
          access_token_expires_at: accessExpiresAt,
          refresh_token_expires_at: refreshExpiresAt,
          last_refreshed_at: new Date().toISOString(),
          last_refresh_error: null,
          last_error_at: null,
        },
      });
    }
  }

  return {
    accessToken: tokenData.access_token,
    realmId: row.realm_id,
    environment: row.environment || "production",
  };
}

async function qbApiGet({ accessToken, realmId, environment, path, query }) {
  const host =
    environment === "sandbox"
      ? "sandbox-quickbooks.api.intuit.com"
      : "quickbooks.api.intuit.com";
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  const url = `https://${host}/v3/company/${realmId}/${path.replace(/^\/+/, "")}${qs}`;
  const res = await fetch(url, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${accessToken}`,
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`QB API ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json();
}

async function* qbQueryPages(ctx, qlFormatter) {
  const PAGE = 1000;
  let startPosition = 1;
  for (;;) {
    const ql = qlFormatter({ startPosition, maxResults: PAGE });
    const page = await qbApiGet({
      ...ctx,
      path: "query",
      query: { query: ql },
    });
    const qr = page?.QueryResponse || {};
    const key = Object.keys(qr).find((k) => Array.isArray(qr[k]));
    const rows = key ? qr[key] : [];
    yield rows;
    if (rows.length < PAGE) return;
    startPosition += PAGE;
  }
}

function mapQbAccountType(classification) {
  const s = String(classification || "").toLowerCase();
  if (
    [
      "bank",
      "other current asset",
      "fixed asset",
      "other asset",
      "accounts receivable",
    ].some((t) => s.includes(t))
  )
    return "Asset";
  if (
    [
      "accounts payable",
      "credit card",
      "other current liability",
      "long term liability",
    ].some((t) => s.includes(t))
  )
    return "Liability";
  if (s.includes("equity")) return "Equity";
  if (s.includes("income") || s.includes("revenue")) return "Revenue";
  if (s.includes("expense") || s.includes("cost of goods")) return "Expense";
  return classification || "Asset";
}

async function upsertByQbId({ bearer, table, rows, pgImpl }) {
  if (!rows.length) return 0;
  const res = await pgImpl({
    bearer,
    path: `/${table}?on_conflict=org_id,qb_id`,
    method: "POST",
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  if (!res.ok) {
    console.error(
      `[QB adapter] upsert ${table} failed:`,
      res.status,
      res.raw?.slice(0, 200),
    );
    throw new Error(`Upsert ${table} failed (${res.status})`);
  }
  return rows.length;
}

const QUICKBOOKS_ADAPTER = {
  vendor: "quickbooks",
  resources: ["chart_of_accounts", "vendors", "journal_entries"],
  async sync({ connector, resourceType, bearer, pgImpl }) {
    const pgFn = pgImpl || pg;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    const writeBearer = SERVICE_ROLE_KEY || bearer;
    const { accessToken, realmId, environment } = await getQbAccessToken({
      bearer,
      orgId: connector.org_id,
      pgImpl: pgFn,
    });
    const ctx = { accessToken, realmId, environment };
    const nowIso = new Date().toISOString();

    if (resourceType === "chart_of_accounts") {
      const iter = qbQueryPages(
        ctx,
        ({ startPosition, maxResults }) =>
          `SELECT * FROM Account STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`,
      );
      let totalRead = 0,
        totalWritten = 0;
      for await (const page of iter) {
        totalRead += page.length;
        const batch = page.map((a) => {
          const code = String(a.AcctNum || a.Id || "").slice(0, 20);
          const mappedType = mapQbAccountType(
            a.Classification || a.AccountType,
          );
          return {
            org_id: connector.org_id,
            qb_id: String(a.Id),
            account_code: code || String(a.Id).slice(0, 20),
            account_name: String(a.Name || "Unnamed").slice(0, 255),
            account_type: String(mappedType || "Asset").slice(0, 50),
            category: a.AccountSubType
              ? String(a.AccountSubType).slice(0, 100)
              : a.AccountType
                ? String(a.AccountType).slice(0, 100)
                : null,
            balance: Number(a.CurrentBalance || 0),
            is_active: a.Active !== false,
            qb_last_synced_at: nowIso,
          };
        });
        totalWritten += await upsertByQbId({
          bearer: writeBearer,
          table: "chart_of_accounts",
          rows: batch,
          pgImpl: pgFn,
        });
      }
      return {
        rowsRead: totalRead,
        rowsWritten: totalWritten,
        payload: { environment },
      };
    }

    if (resourceType === "vendors") {
      const iter = qbQueryPages(
        ctx,
        ({ startPosition, maxResults }) =>
          `SELECT * FROM Vendor STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`,
      );
      let totalRead = 0,
        totalWritten = 0;
      for await (const page of iter) {
        totalRead += page.length;
        const batch = page.map((v) => ({
          org_id: connector.org_id,
          qb_id: String(v.Id),
          company: String(v.CompanyName || v.DisplayName || "Unnamed").slice(
            0,
            255,
          ),
          contact_name:
            v.GivenName && v.FamilyName
              ? `${v.GivenName} ${v.FamilyName}`
              : null,
          phone: v.PrimaryPhone?.FreeFormNumber || null,
          email: v.PrimaryEmailAddr?.Address || null,
          status: v.Active === false ? "inactive" : "active",
          qb_last_synced_at: nowIso,
        }));
        totalWritten += await upsertByQbId({
          bearer: writeBearer,
          table: "vendors",
          rows: batch,
          pgImpl: pgFn,
        });
      }
      return {
        rowsRead: totalRead,
        rowsWritten: totalWritten,
        payload: { environment },
      };
    }

    if (resourceType === "journal_entries") {
      const iter = qbQueryPages(
        ctx,
        ({ startPosition, maxResults }) =>
          `SELECT * FROM JournalEntry STARTPOSITION ${startPosition} MAXRESULTS ${maxResults}`,
      );
      let totalRead = 0,
        totalWritten = 0;
      for await (const page of iter) {
        totalRead += page.length;
        let skippedNoTxnDate = 0;
        const batch = page
          .map((j) => {
            const lines = Array.isArray(j.Line) ? j.Line : [];
            const debits = lines.filter(
              (l) => l.JournalEntryLineDetail?.PostingType === "Debit",
            );
            const credits = lines.filter(
              (l) => l.JournalEntryLineDetail?.PostingType === "Credit",
            );
            const sum = (arr) =>
              arr.reduce((s, l) => s + Number(l.Amount || 0), 0);
            const docNumber = String(j.DocNumber ?? "").trim();
            const txnDate = String(j.TxnDate ?? "").trim();
            if (!txnDate) {
              skippedNoTxnDate += 1;
              return null;
            }
            return {
              org_id: connector.org_id,
              qb_id: String(j.Id),
              document_number: docNumber || null,
              entry_date: txnDate,
              period: txnDate.slice(0, 7),
              description: (
                j.PrivateNote ||
                j.Line?.[0]?.Description ||
                "(no description)"
              ).slice(0, 500),
              entry_type: "standard",
              source: "quickbooks",
              status: "posted",
              total_debits: sum(debits),
              total_credits: sum(credits),
              qb_last_synced_at: nowIso,
            };
          })
          .filter(Boolean);
        if (skippedNoTxnDate > 0) {
          console.error(
            `[QB adapter] journal_entries: skipped ${skippedNoTxnDate} entr(ies) with no TxnDate`,
          );
        }
        totalWritten += await upsertByQbId({
          bearer: writeBearer,
          table: "journal_entries",
          rows: batch,
          pgImpl: pgFn,
        });
      }
      return {
        rowsRead: totalRead,
        rowsWritten: totalWritten,
        payload: { environment },
      };
    }

    return {
      rowsRead: 0,
      rowsWritten: 0,
      error: `Unknown QB resource: ${resourceType}`,
    };
  },
};

const PLAID_HOST_BY_ENV = {
  sandbox: "https://sandbox.plaid.com",
  development: "https://development.plaid.com",
  production: "https://production.plaid.com",
};

async function plaidApi({ env, path, body }) {
  const host = PLAID_HOST_BY_ENV[env] || PLAID_HOST_BY_ENV.sandbox;
  const res = await fetch(`${host}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const code = data?.error_code || "unknown";
    const msg = data?.error_message || "";
    throw new Error(`Plaid ${path} ${res.status}: ${code} ${msg}`.trim());
  }
  return data;
}

async function getPlaidAccessToken({ pgSr, itemRow }) {
  const decRes = await pgSr({
    path: "/rpc/plaid_decrypt_access_token",
    method: "POST",
    body: { ciphertext: itemRow.access_token_encrypted },
  });
  if (!decRes.ok || typeof decRes.body !== "string" || !decRes.body.length) {
    throw new Error("Plaid access_token decrypt failed");
  }
  return decRes.body;
}

async function fetchActivePlaidItems({ pgSr, orgId }) {
  const res = await pgSr({
    path:
      `/org_plaid_items?org_id=eq.${encodeURIComponent(orgId)}&status=eq.active` +
      `&select=id,access_token_encrypted,item_id,institution_id,institution_name,environment,status,revoked_at`,
  });
  if (!res.ok || !Array.isArray(res.body)) {
    throw new Error(`Failed to load plaid items: ${res.status}`);
  }
  return res.body.filter((r) => !r.revoked_at && r.access_token_encrypted);
}

async function markPlaidItemError({
  pgSr,
  itemRowId,
  errorCode,
  errorMessage,
  needsReauth,
}) {
  await pgSr({
    path: `/org_plaid_items?id=eq.${encodeURIComponent(itemRowId)}`,
    method: "PATCH",
    body: {
      last_error_code: errorCode || "unknown",
      last_error_message: (errorMessage || "").slice(0, 500),
      last_error_at: new Date().toISOString(),
      ...(needsReauth ? { status: "needs_reauth" } : {}),
    },
  });
}

async function markPlaidItemSynced({ pgSr, itemRowId, accountsCount }) {
  await pgSr({
    path: `/org_plaid_items?id=eq.${encodeURIComponent(itemRowId)}`,
    method: "PATCH",
    body: {
      last_synced_at: new Date().toISOString(),
      last_error_code: null,
      last_error_message: null,
      last_error_at: null,
      accounts_count: accountsCount,
    },
  });
}

async function upsertCashAccounts({ pgSr, orgId, plaidItemRowId, accounts }) {
  if (!accounts.length) return 0;
  const nowIso = new Date().toISOString();
  const rows = accounts.map((a) => ({
    org_id: orgId,
    plaid_item_id: plaidItemRowId,
    plaid_account_id: a.account_id,
    account_name: (
      a.name ||
      a.official_name ||
      `Account ${a.mask || a.account_id.slice(0, 6)}`
    ).slice(0, 255),
    account_type: a.type || "depository",
    account_subtype: a.subtype || null,
    mask: a.mask || null,
    currency:
      a.balances?.iso_currency_code ||
      a.balances?.unofficial_currency_code ||
      null,
    balance: Number(a.balances?.current ?? a.balances?.available ?? 0),
    last_updated: nowIso.slice(0, 10),
    plaid_last_synced_at: nowIso,
  }));
  const res = await pgSr({
    path: "/cash_accounts?on_conflict=org_id,plaid_account_id",
    method: "POST",
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
  if (!res.ok) {
    throw new Error(
      `Upsert cash_accounts failed (${res.status}): ${res.raw?.slice(0, 200)}`,
    );
  }
  return rows.length;
}

async function upsertBankTransactions({
  pgSr,
  orgId,
  plaidItemRowId,
  transactions,
  accountIdByPlaidId,
}) {
  if (!transactions.length) return 0;
  const rows = transactions.map((t) => ({
    org_id: orgId,
    plaid_item_id: plaidItemRowId,
    plaid_transaction_id: t.transaction_id,
    plaid_account_id: t.account_id,
    cash_account_id: accountIdByPlaidId[t.account_id] || null,
    date: t.date,
    authorized_date: t.authorized_date || null,
    name: t.name || null,
    merchant_name: t.merchant_name || null,
    amount: Number(t.amount || 0),
    currency: t.iso_currency_code || t.unofficial_currency_code || null,
    category: t.category || null,
    pending: !!t.pending,
    payment_channel: t.payment_channel || null,
    transaction_type: t.transaction_type || null,
    raw_payload: null,
  }));
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const slice = rows.slice(i, i + CHUNK);
    const res = await pgSr({
      path: "/bank_transactions?on_conflict=org_id,plaid_transaction_id",
      method: "POST",
      body: slice,
      prefer: "resolution=merge-duplicates,return=minimal",
    });
    if (!res.ok) {
      throw new Error(
        `Upsert bank_transactions failed (${res.status}): ${res.raw?.slice(0, 200)}`,
      );
    }
  }
  return rows.length;
}

const PLAID_ADAPTER = {
  vendor: "plaid",
  resources: ["cash_accounts", "transactions"],
  async sync({ connector, resourceType, bearer, pgImpl }) {
    const pgFn = pgImpl || pg;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!SERVICE_ROLE_KEY) {
      throw new Error(
        "SUPABASE_SERVICE_ROLE_KEY not set — Plaid adapter cannot decrypt tokens",
      );
    }
    const pgSr = (opts) => pgFn({ ...opts, bearer: SERVICE_ROLE_KEY });
    const items = await fetchActivePlaidItems({
      pgSr,
      orgId: connector.org_id,
    });

    if (!items.length) {
      return {
        rowsRead: 0,
        rowsWritten: 0,
        payload: { note: "No active Plaid items for this org yet" },
      };
    }

    let totalRead = 0,
      totalWritten = 0;
    const payload = { items: [] };

    if (resourceType === "cash_accounts") {
      for (const item of items) {
        try {
          const accessToken = await getPlaidAccessToken({
            pgSr,
            itemRow: item,
          });
          const data = await plaidApi({
            env: item.environment || "sandbox",
            path: "/accounts/balance/get",
            body: {
              client_id: process.env.VITE_PLAID_CLIENT_ID,
              secret: process.env.PLAID_SECRET,
              access_token: accessToken,
            },
          });
          const accounts = Array.isArray(data.accounts) ? data.accounts : [];
          totalRead += accounts.length;
          const written = await upsertCashAccounts({
            pgSr,
            orgId: connector.org_id,
            plaidItemRowId: item.id,
            accounts,
          });
          totalWritten += written;
          await markPlaidItemSynced({
            pgSr,
            itemRowId: item.id,
            accountsCount: accounts.length,
          });
          payload.items.push({
            item_id: item.item_id,
            institution: item.institution_name,
            accounts: accounts.length,
          });
        } catch (err) {
          const msg = err?.message || String(err);
          const needsReauth =
            /ITEM_LOGIN_REQUIRED|INVALID_ACCESS_TOKEN|ITEM_NOT_FOUND/.test(msg);
          await markPlaidItemError({
            pgSr,
            itemRowId: item.id,
            errorCode: needsReauth ? "reauth_required" : "sync_error",
            errorMessage: msg,
            needsReauth,
          });
          payload.items.push({ item_id: item.item_id, error: msg });
        }
      }
      return {
        rowsRead: totalRead,
        rowsWritten: totalWritten,
        partial: payload.items.some((i) => i.error),
        payload,
      };
    }

    if (resourceType === "transactions") {
      const mapRes = await pgSr({
        path: `/cash_accounts?org_id=eq.${encodeURIComponent(connector.org_id)}&select=id,plaid_account_id`,
      });
      const accountIdByPlaidId = {};
      if (mapRes.ok && Array.isArray(mapRes.body)) {
        for (const r of mapRes.body) {
          if (r.plaid_account_id) accountIdByPlaidId[r.plaid_account_id] = r.id;
        }
      }

      const today = new Date();
      const end = today.toISOString().slice(0, 10);
      const start = new Date(today.getTime() - 90 * 86400000)
        .toISOString()
        .slice(0, 10);

      for (const item of items) {
        try {
          const accessToken = await getPlaidAccessToken({
            pgSr,
            itemRow: item,
          });
          const COUNT = 500;
          let offset = 0;
          const allTx = [];
          for (;;) {
            const data = await plaidApi({
              env: item.environment || "sandbox",
              path: "/transactions/get",
              body: {
                client_id: process.env.VITE_PLAID_CLIENT_ID,
                secret: process.env.PLAID_SECRET,
                access_token: accessToken,
                start_date: start,
                end_date: end,
                options: { count: COUNT, offset },
              },
            });
            const chunk = Array.isArray(data.transactions)
              ? data.transactions
              : [];
            allTx.push(...chunk);
            const total = Number(data.total_transactions || 0);
            offset += chunk.length;
            if (!chunk.length || offset >= total || chunk.length < COUNT) break;
          }
          totalRead += allTx.length;
          const written = await upsertBankTransactions({
            pgSr,
            orgId: connector.org_id,
            plaidItemRowId: item.id,
            transactions: allTx,
            accountIdByPlaidId,
          });
          totalWritten += written;
          payload.items.push({
            item_id: item.item_id,
            institution: item.institution_name,
            transactions: allTx.length,
          });
        } catch (err) {
          const msg = err?.message || String(err);
          const needsReauth = /ITEM_LOGIN_REQUIRED|INVALID_ACCESS_TOKEN/.test(
            msg,
          );
          await markPlaidItemError({
            pgSr,
            itemRowId: item.id,
            errorCode: needsReauth ? "reauth_required" : "sync_error",
            errorMessage: msg,
            needsReauth,
          });
          payload.items.push({ item_id: item.item_id, error: msg });
        }
      }
      return {
        rowsRead: totalRead,
        rowsWritten: totalWritten,
        partial: payload.items.some((i) => i.error),
        payload,
      };
    }

    return {
      rowsRead: 0,
      rowsWritten: 0,
      error: `Unknown Plaid resource: ${resourceType}`,
    };
  },
};

const DROPBOX_API = "https://api.dropboxapi.com/2";
const DROPBOX_CONTENT = "https://content.dropboxapi.com/2";

export async function dbxApi(path, accessToken, body, pathRootNs = null) {
  const headers = {
    Authorization: `Bearer ${accessToken}`,
    "Content-Type": "application/json",
  };
  if (pathRootNs) {
    headers["Dropbox-API-Path-Root"] = JSON.stringify({
      ".tag": "root",
      root: String(pathRootNs),
    });
  }
  let r;
  try {
    r = await fetch(`${DROPBOX_API}${path}`, {
      method: "POST",
      headers,
      body: JSON.stringify(body ?? null),
    });
  } catch (e) {
    const detail = e?.cause?.code || e?.code || e?.message || String(e);
    return {
      ok: false,
      status: 0,
      body: null,
      raw: `fetch failed: ${detail}`,
      network_error: true,
    };
  }
  const text = await r.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {}
  return { ok: r.ok, status: r.status, body: json, raw: text };
}

export async function dbxApiWithRetry(
  path,
  body,
  pathRootNs,
  getAccessToken,
  refreshAndGetToken,
) {
  let res1 = await dbxApi(path, getAccessToken(), body, pathRootNs);
  if (res1.status === 0 && res1.network_error) {
    const res2 = await dbxApi(path, getAccessToken(), body, pathRootNs);
    res2.retried_after_network_error = true;
    if (res2.status === 0 && res2.network_error) {
      res2.network_failed = true;
    }
    res1 = res2;
  }
  if (res1.status !== 401) return res1;
  let refreshed;
  try {
    refreshed = await refreshAndGetToken();
  } catch (e) {
    refreshed = { ok: false, detail: e?.message || String(e) };
  }
  if (!refreshed?.ok || !refreshed.access_token) {
    res1.refresh_failed = true;
    res1.refresh_detail = refreshed?.detail || null;
    return res1;
  }
  const res2 = await dbxApi(path, getAccessToken(), body, pathRootNs);
  res2.retried_after_refresh = true;
  return res2;
}

const DROPBOX_ADAPTER = {
  vendor: "dropbox",
  resources: ["files"],

  async sync({ connector, resourceType, bearer, pgImpl, triggeredBy }) {
    if (resourceType !== "files") {
      return {
        rowsRead: 0,
        rowsWritten: 0,
        error: `Unknown Dropbox resource: ${resourceType}`,
      };
    }
    const pgFn = pgImpl || pg;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!SERVICE_ROLE_KEY) {
      return {
        rowsRead: 0,
        rowsWritten: 0,
        error: "SUPABASE_SERVICE_ROLE_KEY not set",
      };
    }
    const orgId = connector.org_id;
    const writeBearer = SERVICE_ROLE_KEY;
    const tokenPath =
      triggeredBy === "scheduler"
        ? "scheduled"
        : triggeredBy === "drain_bg"
          ? "drain"
          : "manual";

    const acctsRes = await pgFn({
      bearer: writeBearer,
      path: `/org_dropbox_accounts?org_id=eq.${orgId}&status=in.(active,needs_reauth)&select=id,access_token_expires_at,team_member_id,home_namespace_id,sync_cursor`,
    });
    if (!acctsRes.ok) {
      return {
        rowsRead: 0,
        rowsWritten: 0,
        error: `Failed to list Dropbox accounts [${acctsRes.status}]: ${(acctsRes.raw || "").slice(0, 300)}`,
      };
    }
    const accounts = acctsRes.body || [];
    if (!accounts.length)
      return {
        rowsRead: 0,
        rowsWritten: 0,
        note: "No connected Dropbox accounts",
      };

    let totalRead = 0,
      totalWritten = 0;
    const perAcct = [];
    let tokenFailures = 0;
    let firstTokenError = null;
    const SYNC_BUDGET_MS = 21_000;
    const syncDeadline = Date.now() + SYNC_BUDGET_MS;
    let partial = false;

    for (const acct of accounts) {
      let accessToken = null;
      const tok = await getDropboxAccessToken({
        acctId: acct.id,
        pgFn,
        path: tokenPath,
      });
      if (!tok.ok) {
        const detail =
          tok.detail || `dropbox token refresh failed (${tok.class})`;
        await pgFn({
          bearer: writeBearer,
          path: `/org_dropbox_accounts?id=eq.${acct.id}`,
          method: "PATCH",
          body: {
            last_error_code: tok.class,
            last_error_message: String(detail).slice(0, 500),
            last_error_at: new Date().toISOString(),
          },
          prefer: "return=minimal",
        });
        tokenFailures += 1;
        if (!firstTokenError)
          firstTokenError = `dropbox_account=${acct.id}: ${detail}`;
        continue;
      }
      accessToken = tok.access_token;

      const getAccessToken = () => accessToken;
      let walkRefreshClass = null;
      let walkRefreshNeedsReauth = false;
      const refreshTokenInWalk = async () => {
        const tok = await getDropboxAccessToken({
          acctId: acct.id,
          pgFn,
          path: tokenPath,
          forceRefresh: true,
        });
        walkRefreshClass = tok.ok ? null : tok.class || null;
        walkRefreshNeedsReauth = !tok.ok && tok.needs_reauth === true;
        if (!tok.ok) return { ok: false, detail: tok.detail || tok.class };
        accessToken = tok.access_token;
        return { ok: true, access_token: accessToken };
      };

      let pathRootNs = null;
      let accountDiag = {
        dropbox_account_id: acct.id,
        team_member_id: acct.team_member_id || null,
        home_namespace_id: acct.home_namespace_id || null,
        root_namespace_id: null,
        walked_namespace: "home",
        entries: 0,
        pages: 0,
        resumed_from_cursor: !!acct.sync_cursor,
      };
      const resolvePathRootNs = async () => {
        const acctInfo = await dbxApiWithRetry(
          "/users/get_current_account",
          null,
          null,
          getAccessToken,
          refreshTokenInWalk,
        );
        if (acctInfo.retried_after_refresh)
          accountDiag.token_refresh_recovered = true;
        if (acctInfo.refresh_failed) {
          accountDiag.token_refresh_failed = true;
          accountDiag.token_refresh_detail = acctInfo.refresh_detail;
        }
        if (acctInfo.ok && acctInfo.body?.root_info) {
          const rootNs = acctInfo.body.root_info.root_namespace_id;
          const homeNs = acctInfo.body.root_info.home_namespace_id;
          accountDiag.root_namespace_id = rootNs || null;
          if (rootNs && homeNs && String(rootNs) !== String(homeNs)) {
            accountDiag.walked_namespace = "root";
            return rootNs;
          }
        }
        return null;
      };
      pathRootNs = await resolvePathRootNs();
      if (acct.sync_cursor) {
        accountDiag.walked_namespace = pathRootNs
          ? "continue_root"
          : "continue_home";
      }

      let cursor = acct.sync_cursor || null;
      let hasMore = true,
        pageCount = 0;
      let triedFallback = false;
      let acctPartial = false;
      while (hasMore && pageCount < 200) {
        if (Date.now() > syncDeadline) {
          partial = true;
          acctPartial = true;
          accountDiag.timed_out = true;
          break;
        }
        const apiPath = cursor
          ? "/files/list_folder/continue"
          : "/files/list_folder";
        const apiBody = cursor
          ? { cursor }
          : {
              path: "",
              recursive: true,
              include_deleted: false,
              include_has_explicit_shared_members: true,
              limit: 2000,
            };
        const res = await dbxApiWithRetry(
          apiPath,
          apiBody,
          pathRootNs,
          getAccessToken,
          refreshTokenInWalk,
        );
        if (res.retried_after_refresh)
          accountDiag.token_refresh_recovered = true;
        if (res.refresh_failed) {
          accountDiag.token_refresh_failed = true;
          accountDiag.token_refresh_detail = res.refresh_detail;
        }
        if (!res.ok) {
          accountDiag.error = accountDiag.error || {
            status: res.status,
            body: (res.raw || "").slice(0, 400),
            with_path_root: !!pathRootNs,
            on_continue: !!cursor,
          };

          const isResetError =
            res.status === 409 &&
            cursor &&
            /"?(reset|path_lookup\/not_found)"?/.test(res.raw || "");
          if (isResetError) {
            accountDiag.cursor_reset = true;
            cursor = null;
            hasMore = true;
            pathRootNs = await resolvePathRootNs();
            accountDiag.walked_namespace = pathRootNs
              ? "restart_after_reset_root"
              : "restart_after_reset_home";
            await pg({
              bearer: writeBearer || SERVICE_ROLE_KEY,
              path: `/org_dropbox_accounts?id=eq.${acct.id}`,
              method: "PATCH",
              body: { sync_cursor: null, sync_cursor_at: null },
              prefer: "return=minimal",
            });
            continue;
          }

          if (
            pathRootNs &&
            !triedFallback &&
            (res.status === 409 || res.status === 400)
          ) {
            triedFallback = true;
            pathRootNs = null;
            cursor = null;
            hasMore = true;
            accountDiag.walked_namespace = "home_fallback";
            continue;
          }
          if (res.status === 401) {
            const genuineRevocation =
              walkRefreshNeedsReauth &&
              (walkRefreshClass === "invalid_grant" ||
                walkRefreshClass === "no_refresh_token");
            await pg({
              bearer: writeBearer || SERVICE_ROLE_KEY,
              path: `/org_dropbox_accounts?id=eq.${acct.id}`,
              method: "PATCH",
              body: {
                ...(genuineRevocation ? { status: "needs_reauth" } : {}),
                last_error_code: walkRefreshClass || "dropbox_api_401",
                last_error_message: String(
                  res.refresh_detail || "Dropbox returned 401 mid-walk",
                ).slice(0, 500),
                last_error_at: new Date().toISOString(),
              },
              prefer: "return=minimal",
            });
          }
          partial = true;
          acctPartial = true;
          break;
        }
        const entries = res.body?.entries || [];
        totalRead += entries.length;
        accountDiag.entries += entries.length;

        if (entries.length) {
          const rows = entries
            .filter((e) => e[".tag"] === "file" || e[".tag"] === "folder")
            .map((e) => ({
              org_id: orgId,
              dropbox_account_id: acct.id,
              dropbox_file_id: e.id,
              path_lower: e.path_lower || "/" + (e.name || "").toLowerCase(),
              path_display: e.path_display || "/" + (e.name || ""),
              name: e.name,
              kind: e[".tag"],
              size_bytes: e.size ?? null,
              content_hash: e.content_hash || null,
              rev: e.rev || null,
              client_modified: e.client_modified || null,
              server_modified: e.server_modified || null,
              is_downloadable: e.is_downloadable !== false,
              shared_folder_id: e.shared_folder_id || null,
              parent_shared_folder_id: e.parent_shared_folder_id || null,
              last_seen_at: new Date().toISOString(),
            }));
          if (rows.length) {
            const up = await pg({
              bearer: writeBearer || SERVICE_ROLE_KEY,
              path: "/dropbox_files?on_conflict=org_id,dropbox_account_id,dropbox_file_id",
              method: "POST",
              prefer: "resolution=merge-duplicates,return=minimal",
              body: rows,
            });
            if (up.ok) totalWritten += rows.length;
          }
        }

        cursor = res.body?.cursor;
        hasMore = !!res.body?.has_more;
        pageCount++;
      }
      accountDiag.pages = pageCount;
      perAcct.push(accountDiag);

      const walkFinished = !hasMore;
      const cursorPatch = walkFinished
        ? { sync_cursor: null, sync_cursor_at: null }
        : cursor
          ? { sync_cursor: cursor, sync_cursor_at: new Date().toISOString() }
          : {};
      const walkClean = walkFinished && !acctPartial;
      await pg({
        bearer: writeBearer || SERVICE_ROLE_KEY,
        path: `/org_dropbox_accounts?id=eq.${acct.id}`,
        method: "PATCH",
        body: {
          last_synced_at: new Date().toISOString(),
          ...(walkClean
            ? {
                last_error_code: null,
                last_error_message: null,
                last_error_at: null,
              }
            : {}),
          ...cursorPatch,
        },
        prefer: "return=minimal",
      });
    }

    const allAccountsFailedToken =
      tokenFailures > 0 && tokenFailures === accounts.length;
    if (allAccountsFailedToken) {
      return {
        rowsRead: totalRead,
        rowsWritten: totalWritten,
        error: `Dropbox token refresh failed for all ${accounts.length} account(s). ${firstTokenError}. Reconnect Dropbox from the Integrations tab.`,
        payload: { accounts: perAcct, tokenFailures, firstTokenError },
      };
    }

    return {
      rowsRead: totalRead,
      rowsWritten: totalWritten,
      partial,
      payload: { accounts: perAcct },
    };
  },
};

const ENTRATA_BASE_URLS = {
  us: "https://apis.entrata.com/ext/orgs",
  eu: "https://apis.entrata.global/ext/orgs",
};

function entrataRpcBody(methodName, version = "r1", params = {}) {
  return {
    auth: { type: "apikey" },
    requestId: Math.floor(Math.random() * 1_000_000),
    method: { name: methodName, version, params },
  };
}

export function parseEntrataBucketString(v) {
  const out = { minute: null, hour: null, day: null };
  if (typeof v !== "string") return out;
  for (const part of v.split(";")) {
    const m = part.trim().match(/^(-?\d+)\s*\/\s*(day|hour|minute)s?$/i);
    if (!m) continue;
    const n = parseInt(m[1], 10);
    if (Number.isFinite(n)) out[m[2].toLowerCase()] = n;
  }
  return out;
}

export function parseEntrataResetString(resetV, orderSourceV) {
  const out = { minute: null, hour: null, day: null };
  if (typeof resetV !== "string" || typeof orderSourceV !== "string")
    return out;
  const order = [];
  for (const part of orderSourceV.split(";")) {
    const m = part.trim().match(/\/\s*(day|hour|minute)s?$/i);
    if (m) order.push(m[1].toLowerCase());
  }
  const vals = resetV.split(";").map((s) => parseInt(s.trim(), 10));
  if (!order.length || order.length !== vals.length) return out;
  order.forEach((k, i) => {
    if (Number.isFinite(vals[i])) out[k] = vals[i];
  });
  return out;
}

export function parseEntrataRateLimitHeaders(getHeader, nowMs = Date.now()) {
  const h = (name) => {
    try {
      return getHeader(name);
    } catch {
      return null;
    }
  };
  const scalar = (v) => {
    const n = parseInt(v ?? "", 10);
    return Number.isFinite(n) ? n : null;
  };

  const compositeRemaining = h("x-ratelimit-remaining");
  const compositeLimit = h("x-ratelimit-limit");
  const remaining = parseEntrataBucketString(compositeRemaining);
  const limit = parseEntrataBucketString(compositeLimit);
  const resetSeconds = parseEntrataResetString(
    h("x-ratelimit-reset"),
    compositeRemaining ?? compositeLimit,
  );

  if (remaining.minute == null)
    remaining.minute = scalar(h("x-ratelimit-minute-remaining"));
  if (remaining.hour == null)
    remaining.hour = scalar(h("x-ratelimit-hour-remaining"));
  if (remaining.day == null)
    remaining.day = scalar(h("x-ratelimit-day-remaining"));

  if (remaining.minute == null)
    remaining.minute = scalar(h("x-rate-limit-remaining"));
  if (limit.minute == null) limit.minute = scalar(h("x-rate-limit-limit"));
  if (resetSeconds.minute == null) {
    const epochMs = scalar(h("x-rate-limit-reset"));
    if (epochMs != null && epochMs > nowMs && epochMs - nowMs <= 3_600_000) {
      resetSeconds.minute = Math.ceil((epochMs - nowMs) / 1000);
    }
  }

  return {
    minute: remaining.minute,
    hour: remaining.hour,
    day: remaining.day,
    limit,
    resetSeconds,
  };
}

export function emptyRateLimit() {
  return {
    minute: null,
    hour: null,
    day: null,
    limit: { minute: null, hour: null, day: null },
    resetSeconds: { minute: null, hour: null, day: null },
  };
}

export function classifyEntrata429(rl, bodyText) {
  if (
    typeof bodyText === "string" &&
    /quota exceeded|reached the limit of/i.test(bodyText)
  ) {
    return "exhausted";
  }
  if (!rl || typeof rl !== "object") return "unknown";
  const reported = ["minute", "hour", "day"]
    .map((k) => rl[k])
    .filter((v) => typeof v === "number" && Number.isFinite(v));
  if (!reported.length) return "unknown";
  if (reported.some((v) => v <= 0)) return "exhausted";
  return "spike_arrest";
}

const SPIKE_ARREST_RETRY_BASE_MS = 400;

export async function entrataCall({
  baseUrl,
  subdomain,
  apiKey,
  resource,
  methodName,
  version = "r1",
  params = {},
  page_no = null,
  per_page = null,
  timeoutMs = 30_000,
  bodyTimeoutMs = 15_000,
}) {
  const qs = [];
  if (page_no != null) qs.push(`page_no=${encodeURIComponent(page_no)}`);
  if (per_page != null) qs.push(`per_page=${encodeURIComponent(per_page)}`);
  const url =
    `${baseUrl}/${encodeURIComponent(subdomain)}/v1/${resource}` +
    (qs.length ? `?${qs.join("&")}` : "");
  const headers = {
    "X-Api-Key": apiKey,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (page_no != null) headers["X-Send-Pagination-Links"] = "1";
  const cleanParams = {};
  for (const [k, v] of Object.entries(params || {})) {
    if (v === "" || v == null) continue;
    cleanParams[k] = v;
  }
  const body = JSON.stringify(entrataRpcBody(methodName, version, cleanParams));

  const MAX_ATTEMPTS = 3;
  const HARD_TIMEOUT_BUFFER_MS = 5_000;
  let lastErr = null;
  const _entrataCallStart = Date.now();
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const _attemptStart = Date.now();
    console.log(
      JSON.stringify({
        diag: "entrata-timing",
        phase: "entrataCall.attempt_start",
        wallClockMs: _attemptStart,
        dMsSinceCallStart: _attemptStart - _entrataCallStart,
        methodName,
        attempt,
        MAX_ATTEMPTS,
      }),
    );
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const hardTimeoutMs = timeoutMs + bodyTimeoutMs + HARD_TIMEOUT_BUFFER_MS;
    let hardTimeoutId;
    const hardTimeoutPromise = new Promise((_, reject) => {
      hardTimeoutId = setTimeout(() => {
        console.log(
          JSON.stringify({
            diag: "entrata-timing",
            phase: "entrataCall.hard_timeout_fired",
            wallClockMs: Date.now(),
            dMsSinceAttemptStart: Date.now() - _attemptStart,
            methodName,
            attempt,
            hardTimeoutMs,
          }),
        );
        try {
          controller.abort();
        } catch {}
        reject(
          new Error(
            `entrataCall hard timeout after ${hardTimeoutMs}ms (body stream did not honor abort)`,
          ),
        );
      }, hardTimeoutMs);
    });
    const attemptPromise = (async () => {
      const r = await fetch(url, {
        method: "POST",
        headers,
        body,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      const bodyTimeoutId = setTimeout(() => controller.abort(), bodyTimeoutMs);
      let text;
      try {
        text = await r.text();
      } finally {
        clearTimeout(bodyTimeoutId);
      }
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}
      const rl = parseEntrataRateLimitHeaders((n) => r.headers.get(n));
      return { r, json, text, rl };
    })();
    try {
      const fetched = await Promise.race([attemptPromise, hardTimeoutPromise]);
      clearTimeout(hardTimeoutId);
      const { r, json, text, rl } = fetched;
      return {
        ok: r.ok,
        status: r.status,
        body: json,
        raw: text,
        rl,
        attempts: attempt,
      };
    } catch (e) {
      clearTimeout(timeoutId);
      clearTimeout(hardTimeoutId);
      lastErr = e;
      console.log(
        JSON.stringify({
          diag: "entrata-timing",
          phase: "entrataCall.attempt_error",
          wallClockMs: Date.now(),
          dMsSinceAttemptStart: Date.now() - _attemptStart,
          methodName,
          attempt,
          errorName: e?.name || null,
          errorMessage: (e?.message || String(e)).slice(0, 200),
        }),
      );
      if (attempt < MAX_ATTEMPTS) {
        await new Promise((res) => setTimeout(res, 400 * attempt * attempt));
        continue;
      }
    }
  }
  console.log(
    JSON.stringify({
      diag: "entrata-timing",
      phase: "entrataCall.retries_exhausted",
      wallClockMs: Date.now(),
      dMsSinceCallStart: Date.now() - _entrataCallStart,
      methodName,
      MAX_ATTEMPTS,
      lastErrorName: lastErr?.name || null,
    }),
  );
  return {
    ok: false,
    status: 0,
    body: null,
    raw: `fetch failed (after ${MAX_ATTEMPTS} attempts): ${lastErr?.message || String(lastErr)}`,
    rl: emptyRateLimit(),
    attempts: MAX_ATTEMPTS,
  };
}

async function getEntrataContext({
  orgId,
  pgFn,
  SERVICE_ROLE_KEY,
  _diagOrgId = null,
}) {
  const _t0 = Date.now();
  console.log(
    JSON.stringify({
      diag: "entrata-timing",
      phase: "getEntrataContext.start",
      wallClockMs: _t0,
      orgId: _diagOrgId || orgId,
    }),
  );
  const acctRes = await pgFn({
    bearer: SERVICE_ROLE_KEY,
    path: `/org_entrata_accounts?org_id=eq.${orgId}&status=eq.active&select=id,subdomain,region,api_key_encrypted&limit=1`,
  });
  const _t1 = Date.now();
  console.log(
    JSON.stringify({
      diag: "entrata-timing",
      phase: "getEntrataContext.acct_done",
      wallClockMs: _t1,
      dMsAcct: _t1 - _t0,
      ok: !!acctRes?.ok,
      status: acctRes?.status,
      rowCount: Array.isArray(acctRes?.body) ? acctRes.body.length : null,
    }),
  );
  if (!acctRes.ok || !Array.isArray(acctRes.body) || !acctRes.body.length) {
    return {
      error: `Failed to list Entrata accounts [${acctRes.status}]: ${(acctRes.raw || "").slice(0, 200)}`,
    };
  }
  const acct = acctRes.body[0];
  if (!acct.api_key_encrypted)
    return { error: "Entrata api_key_encrypted missing" };
  console.log(
    JSON.stringify({
      diag: "entrata-timing",
      phase: "getEntrataContext.decrypt_start",
      wallClockMs: Date.now(),
    }),
  );
  const decRes = await pgFn({
    bearer: SERVICE_ROLE_KEY,
    path: "/rpc/entrata_decrypt_api_key",
    method: "POST",
    body: { p_ciphertext: acct.api_key_encrypted },
  });
  const _t2 = Date.now();
  console.log(
    JSON.stringify({
      diag: "entrata-timing",
      phase: "getEntrataContext.decrypt_done",
      wallClockMs: _t2,
      dMsTotal: _t2 - _t0,
      ok: !!decRes?.ok,
      status: decRes?.status,
      decryptedLen:
        typeof decRes?.body === "string" ? decRes.body.length : null,
    }),
  );
  if (!decRes.ok || typeof decRes.body !== "string" || !decRes.body.length) {
    return { error: "Entrata api_key decrypt failed" };
  }
  const region = acct.region === "eu" ? "eu" : "us";
  return {
    accountId: acct.id,
    subdomain: acct.subdomain,
    region,
    apiKey: decRes.body,
    baseUrl: ENTRATA_BASE_URLS[region],
  };
}

function pickArray(body, resultPath) {
  const root = body?.response?.result;
  if (!root) return [];
  const parts = resultPath.split(".");

  const walk = (node, idx) => {
    if (node == null) return [];
    if (idx >= parts.length) {
      if (Array.isArray(node)) return node;
      if (typeof node === "object") return [node];
      return [];
    }
    if (Array.isArray(node)) {
      const out = [];
      for (const el of node) out.push(...walk(el, idx));
      return out;
    }
    if (typeof node !== "object") return [];
    return walk(node[parts[idx]], idx + 1);
  };

  return walk(root, 0);
}

function pickPrimaryCustomer(v) {
  const arr =
    (v.customers && v.customers.customer) ||
    (v.Customers && v.Customers.Customer) ||
    null;
  if (!arr) return {};
  const list = Array.isArray(arr) ? arr : [arr];
  const isPrimary = (c) =>
    c &&
    (c.customerType === "Primary" ||
      c.CustomerType === "Primary" ||
      c.relationshipName === "Primary" ||
      c.RelationshipName === "Primary");
  return list.find(isPrimary) || list[0] || {};
}

function pickActiveLeaseInterval(v) {
  const arr =
    (v.leaseIntervals && v.leaseIntervals.leaseInterval) ||
    (v.LeaseIntervals && v.LeaseIntervals.LeaseInterval) ||
    null;
  if (!arr) return null;
  const list = Array.isArray(arr) ? arr : [arr];
  const isCurrent = (iv) =>
    iv &&
    (iv.leaseIntervalStatusTypeName === "Current" ||
      iv.LeaseIntervalStatusTypeName === "Current");
  return list.find(isCurrent) || list[0] || null;
}

function pickScheduledChargeAmount(v, typeMatch, codeMatch = null) {
  const arr =
    (v.scheduledCharges && v.scheduledCharges.scheduledCharge) ||
    (v.ScheduledCharges && v.ScheduledCharges.ScheduledCharge) ||
    null;
  if (!arr) return null;
  const list = Array.isArray(arr) ? arr : [arr];
  const norm = (s) => (typeof s === "string" ? s.toLowerCase() : s);
  const wantType = typeMatch ? norm(typeMatch) : null;
  const wantCode = codeMatch ? norm(codeMatch) : null;
  for (const c of list) {
    if (!c) continue;
    const ct = norm(c.chargeType || c.ChargeType);
    const cc = norm(c.chargeCode || c.ChargeCode);
    if ((wantType && ct === wantType) || (wantCode && cc === wantCode)) {
      const amt = c.amount != null ? c.amount : c.Amount;
      const n = Number(amt);
      return Number.isFinite(n) ? n : null;
    }
  }
  return null;
}

const DEPOSIT_CHARGE_CODE_RE = /^security\s+deposit$/i;

function pickArDepositNet(v) {
  const arr =
    (v.arTransactions && v.arTransactions.arTransaction) ||
    (v.ArTransactions && v.ArTransactions.ArTransaction) ||
    null;
  if (!arr) return null;
  const list = Array.isArray(arr) ? arr : [arr];
  let net = 0;
  let seen = false;
  for (const t of list) {
    if (!t) continue;
    const name = t.chargeCodeName != null ? t.chargeCodeName : t.ChargeCodeName;
    if (!DEPOSIT_CHARGE_CODE_RE.test(String(name == null ? "" : name).trim()))
      continue;
    const n = Number(t.amount != null ? t.amount : t.Amount);
    if (!Number.isFinite(n)) continue;
    net += n;
    seen = true;
  }
  return seen ? net : null;
}

const RENT_CHARGE_CODES = new Set(["rent", "retail rent"]);

function pickMonthlyRentAmount(v) {
  const arr =
    (v.scheduledCharges && v.scheduledCharges.scheduledCharge) ||
    (v.ScheduledCharges && v.ScheduledCharges.ScheduledCharge) ||
    null;
  if (!arr) return null;
  const list = Array.isArray(arr) ? arr : [arr];
  const norm = (s) => (typeof s === "string" ? s.trim().toLowerCase() : s);

  const candidates = [];
  for (const c of list) {
    if (!c) continue;
    if (!RENT_CHARGE_CODES.has(norm(c.chargeCode || c.ChargeCode))) continue;
    const freq = norm(c.frequency || c.Frequency);
    if (freq && freq !== "monthly") continue;
    const amt = Number(c.amount != null ? c.amount : c.Amount);
    if (!Number.isFinite(amt)) continue;
    const raw = c.startDate || c.StartDate || null;
    const t = raw ? Date.parse(`${String(raw).slice(0, 10)}T00:00:00Z`) : NaN;
    candidates.push({ amt, start: Number.isFinite(t) ? t : null });
  }
  if (!candidates.length) return null;

  const today = new Date();
  const todayUtc = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );

  const started = candidates.filter(
    (c) => c.start === null || c.start <= todayUtc,
  );
  if (started.length) {
    started.sort(
      (a, b) =>
        (b.start ?? -Infinity) - (a.start ?? -Infinity) || b.amt - a.amt,
    );
    return started[0].amt;
  }

  candidates.sort(
    (a, b) => (a.start ?? Infinity) - (b.start ?? Infinity) || b.amt - a.amt,
  );
  return candidates[0].amt;
}

function coerceEntrataBool(x) {
  if (x === true || x === "true" || x === 1 || x === "1") return true;
  if (x === false || x === "false" || x === 0 || x === "0") return false;
  return false;
}

function sumUnitSpacesMarketRent(v) {
  const arr =
    (v.unitSpaces && v.unitSpaces.unitSpace) ||
    (v.UnitSpaces && v.UnitSpaces.UnitSpace) ||
    null;
  if (arr) {
    const list = Array.isArray(arr) ? arr : [arr];
    let sum = 0;
    let sawAny = false;
    for (const space of list) {
      if (!space) continue;
      const raw =
        space.marketRent != null ? space.marketRent : space.MarketRent;
      const n = Number(raw);
      if (Number.isFinite(n)) {
        sum += n;
        sawAny = true;
      }
    }
    if (sawAny) return sum;
  }
  const flat = v.MarketRent != null ? v.MarketRent : v.marketRent;
  const fn = Number(flat);
  return Number.isFinite(fn) ? fn : null;
}

export function dedupeRowsByConflictKey(rows, conflictKey) {
  if (!conflictKey || !Array.isArray(rows) || rows.length < 2) return rows;
  const keys = conflictKey
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!keys.length) return rows;
  const seen = new Map();
  for (const row of rows) {
    if (!row) continue;
    const k = keys.map((c) => (row[c] != null ? String(row[c]) : "")).join(" ");
    seen.set(k, row);
  }
  return Array.from(seen.values());
}

export function mapEntrataLeaseResponseToRow(
  v,
  { orgId, accountId, propertyId },
) {
  const primary = pickPrimaryCustomer(v);
  const active = pickActiveLeaseInterval(v);

  const primaryEmail =
    (primary &&
      primary.addresses &&
      primary.addresses.address &&
      primary.addresses.address.email) ||
    (primary &&
      primary.Addresses &&
      primary.Addresses.Address &&
      primary.Addresses.Address.Email) ||
    primary.Email ||
    primary.email ||
    null;

  const primaryFullName =
    primary.nameFull ||
    primary.NameFull ||
    [
      primary.firstName || primary.FirstName,
      primary.lastName || primary.LastName,
    ]
      .filter(Boolean)
      .join(" ") ||
    null;

  const unitNumber =
    v.UnitNumber ||
    v.unitNumber ||
    v.unitNumberSpace ||
    v.UnitNumberSpace ||
    null;

  const status =
    v.leaseIntervalStatus ||
    v.LeaseIntervalStatus ||
    v.LeaseStatus ||
    v.status ||
    (active &&
      (active.leaseIntervalStatusTypeName ||
        active.LeaseIntervalStatusTypeName)) ||
    null;

  const leaseStartDate =
    v.LeaseStartDate ||
    v.leaseStartDate ||
    (active && (active.startDate || active.StartDate)) ||
    null;
  const leaseEndDate =
    v.LeaseEndDate ||
    v.leaseEndDate ||
    (active && (active.endDate || active.EndDate)) ||
    null;

  const moveInDate =
    v.MoveInDate ||
    v.moveInDate ||
    primary.moveInDate ||
    primary.MoveInDate ||
    null;
  const moveOutDate =
    v.MoveOutDate ||
    v.moveOutDate ||
    primary.moveOutDate ||
    primary.MoveOutDate ||
    null;

  const rent = pickMonthlyRentAmount(v);
  let deposit = pickArDepositNet(v);
  if (deposit == null)
    deposit = pickScheduledChargeAmount(v, "Security Deposit", "SDeposit");
  if (deposit == null) deposit = pickScheduledChargeAmount(v, "Deposit");

  const primaryCustomerIdRaw =
    primary.id != null
      ? primary.id
      : primary.CustomerID != null
        ? primary.CustomerID
        : primary.customerId != null
          ? primary.customerId
          : null;
  const primaryCustomerIdNum =
    primaryCustomerIdRaw != null ? Number(primaryCustomerIdRaw) : null;

  return {
    org_id: orgId,
    entrata_account_id: accountId,
    property_id:
      Number(v.PropertyID || v.propertyId || propertyId || 0) || null,
    lease_id: Number(v.LeaseID || v.leaseId || v.id),
    unit_id:
      v.UnitID != null || v.unitId != null
        ? Number(v.UnitID != null ? v.UnitID : v.unitId)
        : null,
    unit_number: unitNumber,
    status,
    lease_start_date: leaseStartDate,
    lease_end_date: leaseEndDate,
    move_in_date: moveInDate,
    move_out_date: moveOutDate,
    rent: rent != null ? rent : v.Rent != null ? Number(v.Rent) : null,
    deposit:
      deposit != null ? deposit : v.Deposit != null ? Number(v.Deposit) : null,
    primary_customer_id: Number.isFinite(primaryCustomerIdNum)
      ? primaryCustomerIdNum
      : null,
    primary_customer_name: primaryFullName,
    primary_customer_email: primaryEmail,
    is_mtm: coerceEntrataBool(
      v.IsMTM != null
        ? v.IsMTM
        : v.isMTM != null
          ? v.isMTM
          : v.isMonthToMonth != null
            ? v.isMonthToMonth
            : v.IsMonthToMonth,
    ),
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function mapEntrataUnitResponseToRow(
  v,
  { orgId, accountId, propertyId },
) {
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    property_id: Number(v.PropertyID || v.propertyId || propertyId),
    unit_id: Number(v.UnitID || v.unitId || v.id),
    unit_number: v.UnitNumber || v.unitNumber || null,
    unit_type_id:
      v.UnitTypeID != null
        ? Number(v.UnitTypeID)
        : v.unitTypeId != null
          ? Number(v.unitTypeId)
          : null,
    unit_type_name: v.UnitType || v.unitType || v.unitTypeName || null,
    building_name: v.Building || v.building || v.buildingName || null,
    floor: v.Floor || v.floorNumber || null,
    bedrooms:
      v.NumberOfBedrooms != null
        ? Number(v.NumberOfBedrooms)
        : v.numberOfBedrooms != null
          ? Number(v.numberOfBedrooms)
          : null,
    bathrooms:
      v.NumberOfBathrooms != null
        ? Number(v.NumberOfBathrooms)
        : v.numberOfBathrooms != null
          ? Number(v.numberOfBathrooms)
          : null,
    sqft:
      v.SquareFeet != null
        ? Number(v.SquareFeet)
        : v.squareFeet != null
          ? Number(v.squareFeet)
          : null,
    market_rent: sumUnitSpacesMarketRent(v),
    is_disabled: coerceEntrataBool(
      v.IsDisabled != null ? v.IsDisabled : v.isDisabled,
    ),
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function mapEntrataCustomerResponseToRow(
  v,
  { orgId, accountId, propertyId },
) {
  const attrs = v["@attributes"] || v.attributes || {};
  const idRaw = attrs.Id || attrs.id || v.CustomerID || v.customerId || v.id;
  const leaseRaw =
    (v.LeaseId &&
      (v.LeaseId.id || v.LeaseId.Id || v.LeaseId["@value"] || v.LeaseId)) ||
    v.leaseId ||
    v.lease_id;
  const leaseNum = Number(leaseRaw);
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    customer_id: Number(idRaw),
    property_id: propertyId ? Number(propertyId) : null,
    lease_id: Number.isFinite(leaseNum) && leaseNum > 0 ? leaseNum : null,
    first_name: v.FirstName || v.firstName || null,
    last_name: v.LastName || v.lastName || null,
    email: v.Email || v.email || null,
    phone:
      (v.Phone && (v.Phone.PhoneNumber || v.Phone.phoneNumber)) ||
      v.PhoneNumber ||
      v.phoneNumber ||
      null,
    dob: v.BirthDate || v.dob || null,
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

function toFiniteNumber(x) {
  if (x == null || x === "") return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function parseEntrataMoney(x) {
  if (x == null || x === "") return null;
  if (typeof x === "number") return Number.isFinite(x) ? x : null;
  const s = String(x).replace(/[$,\s]/g, "");
  if (s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function toIsoDateOnly(s) {
  if (s == null || s === "") return null;
  const str = String(s).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(str);
  if (m)
    return `${m[3]}-${String(m[1]).padStart(2, "0")}-${String(m[2]).padStart(2, "0")}`;
  return null;
}

function parseEntrataDate(s) {
  if (s == null || s === "") return null;
  try {
    const d = new Date(s);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  } catch {
    return null;
  }
}

function readIdAttr(v, flatKeysPascal, flatKeysCamel) {
  const attrs = v["@attributes"] || v.attributes || {};
  const candidates = [attrs.Id, attrs.id];
  for (const k of flatKeysPascal || []) candidates.push(v[k]);
  for (const k of flatKeysCamel || []) candidates.push(v[k]);
  candidates.push(v.id);
  for (const c of candidates) {
    if (c == null) continue;
    const n = Number(c);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

function toPostMonth(s) {
  if (!s) return null;
  const str = String(s);
  let m = /^(\d{4})-(\d{2})/.exec(str);
  if (m) return `${m[1]}-${m[2]}`;
  m = /^(\d{1,2})\/(\d{4})$/.exec(str);
  if (m) return `${m[2]}-${String(m[1]).padStart(2, "0")}`;
  m = /^(\d{4})\/(\d{1,2})/.exec(str);
  if (m) return `${m[1]}-${String(m[2]).padStart(2, "0")}`;
  m = /^([A-Za-z]{3,9}),\s*(\d{4})$/.exec(str);
  if (m) {
    const MONTHS = [
      "jan",
      "feb",
      "mar",
      "apr",
      "may",
      "jun",
      "jul",
      "aug",
      "sep",
      "oct",
      "nov",
      "dec",
    ];
    const idx = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (idx >= 0) return `${m[2]}-${String(idx + 1).padStart(2, "0")}`;
    return null;
  }
  m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, "0")}`;
  return null;
}

export function synthGlTransactionId(key) {
  let h = 0xcbf29ce484222325n;
  for (let i = 0; i < key.length; i++) {
    h ^= BigInt(key.charCodeAt(i));
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return Number(h & 0x1fffffffffffffn);
}

const GL_HOT_MONTHS = 3;
const GL_HISTORY_FLOOR = "07/2023";

export function enumeratePostMonths(monthsBack, now = new Date()) {
  const out = [];
  for (let i = monthsBack - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    out.push(`${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`);
  }
  return out;
}

export function enumeratePostMonthsBetween(fromMMYYYY, toMMYYYY) {
  const parse = (value) => {
    const match = /^(\d{1,2})\/(\d{4})$/.exec(String(value || ""));
    if (!match) return null;
    const month = Number(match[1]);
    const year = Number(match[2]);
    return month >= 1 && month <= 12 ? new Date(year, month - 1, 1) : null;
  };
  const from = parse(fromMMYYYY);
  const to = parse(toMMYYYY);
  if (!from || !to || from > to) return [];
  const out = [];
  for (const d = new Date(from); d <= to; d.setMonth(d.getMonth() + 1)) {
    out.push(`${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`);
  }
  return out;
}

export function glHistoryWindow(
  now = new Date(),
  floor = GL_HISTORY_FLOOR,
  hotMonths = GL_HOT_MONTHS,
) {
  const hotWindow = enumeratePostMonths(hotMonths, now);
  if (!hotWindow.length) return [];
  const firstHot = /^(\d{1,2})\/(\d{4})$/.exec(hotWindow[0]);
  if (!firstHot) return [];
  const previousHot = new Date(Number(firstHot[2]), Number(firstHot[1]) - 2, 1);
  const previousHotMMYYYY = `${String(previousHot.getMonth() + 1).padStart(2, "0")}/${previousHot.getFullYear()}`;
  return enumeratePostMonthsBetween(floor, previousHotMMYYYY);
}

export function pickHistoryMonth(window, passIndex) {
  if (!window?.length) return null;
  const normalized = Number.isFinite(passIndex) ? Math.trunc(passIndex) : 0;
  return window[((normalized % window.length) + window.length) % window.length];
}

export function heldMonthToPostMonth(yyyyMm) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(yyyyMm || ""));
  if (!match) return null;
  const month = Number(match[2]);
  return month >= 1 && month <= 12 ? `${match[2]}/${match[1]}` : null;
}

export function laterPostMonth(a, b) {
  const key = (value) => {
    const match = /^(\d{1,2})\/(\d{4})$/.exec(String(value || ""));
    return match ? Number(match[2]) * 12 + Number(match[1]) : null;
  };
  const ka = key(a);
  const kb = key(b);
  if (ka == null) return kb == null ? null : b;
  if (kb == null) return a;
  return kb > ka ? b : a;
}

export function resolveHistoryFloor(heldPostMonth, floor = GL_HISTORY_FLOOR) {
  const held = heldMonthToPostMonth(heldPostMonth);
  return held ? laterPostMonth(floor, held) : null;
}

export function earlierPostMonth(a, b) {
  const later = laterPostMonth(a, b);
  if (later == null) return null;
  if (a == null) return b;
  if (b == null) return a;
  return later === a ? b : a;
}

export function propertyHoldsPostMonth(floorPostMonth, month) {
  if (!floorPostMonth || !month) return false;
  return (
    laterPostMonth(floorPostMonth, month) === month ||
    String(floorPostMonth) === String(month)
  );
}

export function historyEligibleBatch(batch, historyMonth, floorsByProperty) {
  if (!historyMonth || !Array.isArray(batch)) return [];
  const floors = floorsByProperty || {};
  return batch.filter((pid) =>
    propertyHoldsPostMonth(floors[String(pid)], historyMonth),
  );
}

const GL_REPAIR_MONTHS_PER_PASS = 6;

export function normalizeRepairCandidates(
  rows,
  limit = GL_REPAIR_MONTHS_PER_PASS,
) {
  const out = [];
  const seen = new Set();
  for (const r of Array.isArray(rows) ? rows : []) {
    const pid = r?.property_id != null ? String(r.property_id) : null;
    const month = heldMonthToPostMonth(r?.post_month);
    if (!pid || !month) continue;
    const key = `${pid}|${month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ property_id: pid, month });
    if (out.length >= limit) break;
  }
  return out;
}

export function repairCallsForBatch(
  batch,
  repairs,
  floorsByProperty,
  { hotMonths = [], historyMonth = null } = {},
) {
  if (!Array.isArray(batch) || !Array.isArray(repairs) || !repairs.length)
    return [];
  const inBatch = new Set(batch.map(String));
  const floors = floorsByProperty || {};
  const skip = new Set(hotMonths);
  const byMonth = new Map();
  for (const { property_id: pid, month } of repairs) {
    if (!inBatch.has(pid) || skip.has(month) || month === historyMonth)
      continue;
    if (!propertyHoldsPostMonth(floors[pid], month)) continue;
    if (!byMonth.has(month)) byMonth.set(month, []);
    byMonth.get(month).push(pid);
  }
  return [...byMonth.entries()].map(([month, ids]) => ({ month, ids }));
}

function toDateOnly(s) {
  if (!s) return null;
  const str = String(s);
  const bare = /^(\d{4})-(\d{2})-(\d{2})/.exec(str);
  if (bare) return `${bare[1]}-${bare[2]}-${bare[3]}`;
  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(str);
  if (mdy)
    return `${mdy[3]}-${String(mdy[1]).padStart(2, "0")}-${String(mdy[2]).padStart(2, "0")}`;
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

function glMonthEndDate(mmYYYY) {
  const m = /^(\d{1,2})\/(\d{4})$/.exec(String(mmYYYY || ""));
  if (!m) return null;
  const mm = Number(m[1]),
    yyyy = Number(m[2]);
  const last = new Date(yyyy, mm, 0).getDate();
  return `${yyyy}-${String(mm).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
}

export function mapEntrataGlDetailsToRows(v, { orgId, accountId, propertyId }) {
  const attrs = v["@attributes"] || v.attributes || {};
  const details = v.glDetails?.glDetail ?? v.GlDetails?.GlDetail ?? null;
  if (details == null) return [];
  const list = Array.isArray(details) ? details : [details];
  if (!list.length) return [];

  const acctNumber =
    attrs.accountNumber ||
    attrs.AccountNumber ||
    v.GlAccountNumber ||
    v.glAccountNumber ||
    v.AccountNumber ||
    null;
  const acctId = toFiniteNumber(
    attrs.accountId ||
      attrs.AccountId ||
      v.GlAccountId ||
      v.glAccountId ||
      v.AccountId,
  );
  const acctName =
    attrs.accountName ||
    attrs.AccountName ||
    v.GlAccountName ||
    v.glAccountName ||
    v.AccountName ||
    null;
  const pid = toFiniteNumber(
    v._propertyId ?? v.PropertyID ?? v.propertyId ?? propertyId,
  );
  const nodeMonth = v._postMonth || null;
  const seenAt = new Date().toISOString();

  const rows = [];
  for (const d of list) {
    if (!d || typeof d !== "object") continue;
    const dAttrs = d["@attributes"] || d.attributes || {};
    const detailId = readIdAttr(
      d,
      ["GlDetailId", "DetailId"],
      ["glDetailId", "detailId"],
    );
    rows.push({
      org_id: orgId,
      entrata_account_id: accountId,
      gl_detail_id: detailId,
      transaction_type:
        dAttrs.transactionType || dAttrs.TransactionType || null,
      property_id: pid,
      gl_account_id: acctId,
      gl_account_number: acctNumber,
      gl_account_name: acctName,
      transaction_date: toDateOnly(d.transactionDate || d.TransactionDate),
      post_date: toDateOnly(d.postDate || d.PostDate),
      post_month:
        toPostMonth(nodeMonth) || toPostMonth(d.postMonth || d.PostMonth),
      debit: toFiniteNumber(d.debit ?? d.Debit),
      credit: toFiniteNumber(d.credit ?? d.Credit),
      balance: toFiniteNumber(d.balance ?? d.Balance),
      reference: d.reference || d.Reference || null,
      memo: d.memo || d.Memo || null,
      ap_detail_id: toFiniteNumber(d.apDetailId ?? d.ApDetailId),
      unit_id: toFiniteNumber(d.unitId ?? d.UnitId),
      unit_number: d.unitNumber || d.UnitNumber || null,
      vendor_name: d.vendorName || d.VendorName || null,
      vendor_code: d.vendorCode || d.VendorCode || null,
      raw: d,
      last_seen_at: seenAt,
    });
  }
  return rows;
}

export function summarizeGlDetailApiCounts(detailRows) {
  const perMonth = new Map();
  for (const r of Array.isArray(detailRows) ? detailRows : []) {
    if (!r || r.property_id == null || !r.post_month) continue;
    const key = `${r.property_id}|${r.post_month}`;
    let entry = perMonth.get(key);
    if (!entry) {
      entry = {
        property_id: r.property_id,
        post_month: r.post_month,
        ids: new Set(),
        unkeyed: 0,
      };
      perMonth.set(key, entry);
    }
    if (r.gl_detail_id == null) entry.unkeyed += 1;
    else entry.ids.add(String(r.gl_detail_id));
  }
  const out = new Map();
  for (const [key, e] of perMonth) {
    out.set(key, {
      property_id: e.property_id,
      post_month: e.post_month,
      api_line_count: e.ids.size + e.unkeyed,
    });
  }
  return out;
}

export function glDetailCoverageTerminalRows({
  requests = [],
  detailRows = [],
} = {}) {
  const counts = summarizeGlDetailApiCounts(detailRows);
  const rows = [];
  const seen = new Set();
  for (const req of requests) {
    if (!req || req.property_id == null || !req.post_month) continue;
    const key = `${req.property_id}|${req.post_month}`;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      property_id: req.property_id,
      post_month: req.post_month,
      status: "complete",
      api_line_count: counts.get(key)?.api_line_count ?? 0,
    });
  }
  for (const [key, c] of counts) {
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({
      property_id: c.property_id,
      post_month: c.post_month,
      status: "complete",
      api_line_count: c.api_line_count,
    });
  }
  return rows;
}

export async function recordGlDetailCoverage({
  pgFn,
  bearer,
  orgId,
  accountId,
  runId = null,
  rows,
  diag = null,
}) {
  const stamped = (Array.isArray(rows) ? rows : [])
    .filter((r) => r && r.property_id != null && r.post_month)
    .map((r) => ({
      org_id: orgId,
      entrata_account_id: accountId,
      property_id: Number(r.property_id),
      post_month: r.post_month,
      status: r.status,
      api_line_count: r.api_line_count ?? null,
      error_message: r.error_message ?? null,
      run_id: runId,
    }));
  if (!stamped.length) return { ok: true, rows: 0 };
  if (!orgId || !accountId) {
    if (diag)
      diag.coverage_write_failures = (diag.coverage_write_failures || 0) + 1;
    return { ok: false, rows: 0, error: "missing org/account context" };
  }

  const CHUNK = 1000;
  let written = 0;
  for (let i = 0; i < stamped.length; i += CHUNK) {
    const slice = stamped.slice(i, i + CHUNK);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 30_000);
    let res;
    try {
      res = await pgFn({
        bearer,
        path: "/rpc/record_entrata_gl_detail_coverage",
        method: "POST",
        prefer: "return=minimal",
        body: { p_rows: slice },
        signal: controller.signal,
      });
    } catch (err) {
      res = { ok: false, status: 0, raw: err?.message || String(err) };
    } finally {
      clearTimeout(timer);
    }
    if (!res || !res.ok) {
      if (diag) {
        diag.coverage_write_failures = (diag.coverage_write_failures || 0) + 1;
        if (!diag.first_coverage_error) {
          diag.first_coverage_error = {
            status: res?.status ?? null,
            error: (res?.raw || "").slice(0, 200),
          };
        }
      }
      console.error(
        "[gl-detail] gl detail coverage write failed",
        JSON.stringify({ status: res?.status ?? null, rows: slice.length }),
      );
      return {
        ok: false,
        rows: written,
        error: (res?.raw || "").slice(0, 200),
      };
    }
    written += slice.length;
    if (diag)
      diag.coverage_rows_written =
        (diag.coverage_rows_written || 0) + slice.length;
  }
  return { ok: true, rows: written };
}

export function mapEntrataGlTransactionToRow(
  v,
  { orgId, accountId, propertyId },
) {
  const attrs = v["@attributes"] || v.attributes || {};
  const glTotal = v.glTotal || v.GlTotal || {};
  const postMonthTag = v._postMonth || null;
  const acctNumber =
    attrs.accountNumber ||
    attrs.AccountNumber ||
    v.GlAccountNumber ||
    v.glAccountNumber ||
    v.AccountNumber ||
    null;
  const acctId = toFiniteNumber(
    attrs.accountId ||
      attrs.AccountId ||
      v.GlAccountId ||
      v.glAccountId ||
      v.AccountId,
  );
  const acctName =
    attrs.accountName ||
    attrs.AccountName ||
    v.GlAccountName ||
    v.glAccountName ||
    v.AccountName ||
    null;
  const pid = toFiniteNumber(
    v._propertyId ?? v.PropertyID ?? v.propertyId ?? propertyId,
  );
  let debit = toFiniteNumber(glTotal.debitClosingBalance ?? v.Debit ?? v.debit);
  let credit = toFiniteNumber(
    glTotal.creditClosingBalance ?? v.Credit ?? v.credit,
  );
  const amountRaw = v.Amount != null ? v.Amount : v.amount;
  if (debit == null && credit == null && amountRaw != null) {
    const n = toFiniteNumber(amountRaw);
    if (n != null) {
      if (n >= 0) {
        debit = n;
        credit = 0;
      } else {
        debit = 0;
        credit = -n;
      }
    }
  }
  const postMonth = postMonthTag
    ? toPostMonth(postMonthTag)
    : toPostMonth(v.PostMonth || v.postMonth || v.PostDate || v.postDate);
  const postDate = postMonthTag
    ? glMonthEndDate(postMonthTag)
    : v.PostDate || v.postDate || null;
  let glTxnId = readIdAttr(
    v,
    ["GlTransactionId", "TransactionId"],
    ["glTransactionId", "transactionId"],
  );
  if (glTxnId == null && pid != null && acctNumber != null) {
    glTxnId = synthGlTransactionId(`${pid}:${acctNumber}:${postMonth || ""}`);
  }
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    gl_transaction_id: glTxnId,
    property_id: pid,
    post_month: postMonth,
    post_date: postDate,
    gl_account_id: acctId,
    gl_account_name: acctName,
    gl_account_number: acctNumber,
    debit,
    credit,
    description: v.Memo || v.memo || v.Description || v.description || null,
    journal_entry_id: toFiniteNumber(v.JournalEntryId || v.journalEntryId),
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function mapEntrataArTransactionToRow(
  v,
  { orgId, accountId, propertyId },
) {
  const txnId = readIdAttr(
    v,
    ["ArTransactionId", "TransactionId", "ArTransactionID"],
    ["arTransactionId", "transactionId"],
  );
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    transaction_id: txnId,
    lease_id: toFiniteNumber(v.LeaseId || v.leaseId || v.LeaseID),
    property_id: toFiniteNumber(v.PropertyID || v.propertyId || propertyId),
    ar_code_id: toFiniteNumber(v.ArCodeId || v.arCodeId || v.ArCodeID),
    ar_code_name: v.ArCodeName || v.arCodeName || v.ArCode || null,
    transaction_date:
      v.TransactionDate ||
      v.transactionDate ||
      v.PostDate ||
      v.postDate ||
      null,
    post_month: toPostMonth(
      v.PostMonth || v.postMonth || v.TransactionDate || v.transactionDate,
    ),
    amount: toFiniteNumber(v.Amount ?? v.amount),
    description: v.Description || v.description || v.Memo || v.memo || null,
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function mapEntrataArInvoiceToRow(v, { orgId, accountId, propertyId }) {
  const invId = readIdAttr(
    v,
    ["ArInvoiceId", "InvoiceId", "InvoiceID"],
    ["arInvoiceId", "invoiceId"],
  );
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    invoice_id: invId,
    lease_id: toFiniteNumber(v.LeaseId || v.leaseId || v.LeaseID),
    property_id: toFiniteNumber(v.PropertyID || v.propertyId || propertyId),
    invoice_number: v.InvoiceNumber || v.invoiceNumber || null,
    invoice_date: v.InvoiceDate || v.invoiceDate || null,
    due_date: v.DueDate || v.dueDate || null,
    total_amount: toFiniteNumber(
      v.TotalAmount ?? v.totalAmount ?? v.Amount ?? v.amount,
    ),
    balance: toFiniteNumber(
      v.Balance ?? v.balance ?? v.AmountDue ?? v.amountDue,
    ),
    status: v.Status || v.status || null,
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function mapEntrataArPaymentToRow(v, { orgId, accountId, propertyId }) {
  const payId = readIdAttr(
    v,
    ["ArPaymentId", "PaymentId", "PaymentID"],
    ["arPaymentId", "paymentId"],
  );
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    payment_id: payId,
    lease_id: toFiniteNumber(v.LeaseId || v.leaseId || v.LeaseID),
    property_id: toFiniteNumber(v.PropertyID || v.propertyId || propertyId),
    payment_date:
      v.PaymentDate || v.paymentDate || v.PostDate || v.postDate || null,
    amount: toFiniteNumber(v.Amount ?? v.amount),
    method: v.Method || v.method || v.PaymentMethod || v.paymentMethod || null,
    reference_number:
      v.ReferenceNumber ||
      v.referenceNumber ||
      v.Reference ||
      v.reference ||
      null,
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

function asEntrataArray(x) {
  if (Array.isArray(x)) return x;
  if (x == null) return [];
  return [x];
}

export function flattenEntrataBudgetLines(body, propertyId) {
  let budgets = pickArray(body, "properties.property.budgets.budget");
  if (!budgets.length)
    budgets = pickArray(body, "Properties.Property.Budgets.Budget");
  const lines = [];
  for (const b of budgets) {
    if (!b || typeof b !== "object") continue;
    const budgetId = b.id ?? b.Id ?? b.budgetId ?? b.BudgetId;
    const fiscalYear = b.fiscalYear ?? b.FiscalYear ?? b.year ?? b.Year;
    const budgetName = b.budgetName ?? b.BudgetName ?? b.name ?? b.Name ?? null;
    const budgetStatusTypeId =
      b.budgetStatusTypeId ??
      b.BudgetStatusTypeId ??
      b.statusTypeId ??
      b.StatusTypeId ??
      null;
    const glAccounts = asEntrataArray(
      (b.glAccounts && b.glAccounts.glAccount) ||
        (b.GlAccounts && b.GlAccounts.GlAccount),
    );
    for (const ga of glAccounts) {
      if (!ga || typeof ga !== "object") continue;
      const glAccountId =
        ga.id ??
        ga.Id ??
        ga.glAccountId ??
        ga.GlAccountId ??
        ga.accountId ??
        ga.AccountId;
      const glAccountNumber =
        ga.accountNumber ??
        ga.AccountNumber ??
        ga.glAccountNumber ??
        ga.GlAccountNumber ??
        ga.accountCode ??
        ga.AccountCode ??
        null;
      const months = asEntrataArray(
        (ga.budgetMonths && ga.budgetMonths.budgetMonth) ||
          (ga.BudgetMonths && ga.BudgetMonths.BudgetMonth),
      );
      for (const bm of months) {
        if (!bm || typeof bm !== "object") continue;
        lines.push({
          budgetId,
          budgetName,
          budgetStatusTypeId,
          propertyId,
          fiscalYear,
          glAccountId,
          glAccountNumber,
          budgetMonth: bm.month ?? bm.Month,
          budgetedAmount:
            bm.amount ?? bm.Amount ?? bm.budgetedAmount ?? bm.BudgetedAmount,
        });
      }
    }
  }
  return lines;
}

export function mapEntrataBudgetToRow(v, { orgId, accountId, propertyId }) {
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    budget_id: readIdAttr(v, ["BudgetId", "BudgetID"], ["budgetId"]),
    budget_name: v.BudgetName || v.budgetName || null,
    budget_status_type_id: toFiniteNumber(
      v.BudgetStatusTypeId ?? v.budgetStatusTypeId,
    ),
    property_id: toFiniteNumber(v.PropertyID || v.propertyId || propertyId),
    fiscal_year: toFiniteNumber(
      v.FiscalYear || v.fiscalYear || v.Year || v.year,
    ),
    gl_account_id: toFiniteNumber(
      v.GlAccountId || v.glAccountId || v.AccountId,
    ),
    gl_account_number:
      v.GlAccountNumber || v.glAccountNumber || v.AccountNumber || null,
    budget_month: toPostMonth(
      v.BudgetMonth ||
        v.budgetMonth ||
        v.Month ||
        v.month ||
        v.PostMonth ||
        v.postMonth,
    ),
    budgeted_amount: toFiniteNumber(
      v.BudgetedAmount ?? v.budgetedAmount ?? v.Amount ?? v.amount,
    ),
    actual_amount: toFiniteNumber(v.ActualAmount ?? v.actualAmount),
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function flattenEntrataGlTreeNodes(body) {
  const branches = [];
  const accounts = [];
  const result = body?.response?.result || body?.Response?.Result || null;
  if (!result || typeof result !== "object") return { branches, accounts };

  const isAccountNode = (n) =>
    !!(
      n &&
      typeof n === "object" &&
      !Array.isArray(n) &&
      (n.AccountNumber != null ||
        n.accountNumber != null ||
        n.GlGroupType != null ||
        n.glGroupType != null)
    );
  const isBranchNode = (n) =>
    !!(
      n &&
      typeof n === "object" &&
      !Array.isArray(n) &&
      !isAccountNode(n) &&
      (n.BranchId != null ||
        n.branchId != null ||
        n.GroupName != null ||
        n.groupName != null)
    );

  let trees = pickArray(body, "glTrees.glTree");
  if (!trees.length) trees = pickArray(body, "GlTrees.GlTree");
  if (!trees.length) trees = pickArray(body, "trees.tree");
  if (!trees.length) trees = pickArray(body, "Trees.Tree");
  if (!trees.length) {
    for (const val of Object.values(result)) {
      const arr = Array.isArray(val)
        ? val
        : val && typeof val === "object"
          ? Object.values(val).find(Array.isArray)
          : null;
      if (
        Array.isArray(arr) &&
        arr.length &&
        arr[0] &&
        typeof arr[0] === "object"
      ) {
        const a0 = arr[0]["@attributes"] || arr[0].attributes || arr[0];
        if (a0 && (a0.Id != null || a0.TreeId != null || a0.GlTreeId != null)) {
          trees = arr;
          break;
        }
      }
    }
  }
  if (!trees.length) trees = [result];

  for (const tree of trees) {
    if (!tree || typeof tree !== "object") continue;
    const attrs = tree["@attributes"] || tree.attributes || {};
    const treeId = toFiniteNumber(
      attrs.Id ??
        attrs.TreeId ??
        attrs.GlTreeId ??
        tree.Id ??
        tree.id ??
        tree.TreeId ??
        tree.treeId ??
        tree.GlTreeId ??
        tree.glTreeId,
    );
    const treeName =
      attrs.Name ??
      attrs.TreeName ??
      tree.Name ??
      tree.name ??
      tree.TreeName ??
      tree.treeName ??
      null;

    const classify = (item) => {
      if (isAccountNode(item)) {
        accounts.push({
          ...item,
          _treeId: treeId,
          _treeName: treeName,
          _position: accounts.length,
        });
        return "account";
      }
      if (isBranchNode(item)) {
        branches.push({
          ...item,
          _treeId: treeId,
          _treeName: treeName,
          _position: branches.length,
        });
        return "branch";
      }
      return null;
    };

    const seen = new Set();
    const walk = (node) => {
      if (!node || typeof node !== "object" || seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        for (const item of node) walk(item);
        return;
      }
      for (const key of Object.keys(node)) {
        if (key === "@attributes" || key === "attributes") continue;
        const val = node[key];
        if (Array.isArray(val)) {
          for (const item of val) {
            const kind = classify(item);
            if (kind === "branch" || kind === null) walk(item);
          }
        } else if (val && typeof val === "object") {
          const kind = classify(val);
          if (kind === "branch" || kind === null) walk(val);
        }
      }
    };
    walk(tree);
  }
  return { branches, accounts };
}

export function mapEntrataGlTreeBranchToRow(v, { orgId, accountId }) {
  const attrs = v["@attributes"] || v.attributes || {};
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    tree_id: toFiniteNumber(v._treeId),
    tree_name: v._treeName || null,
    branch_id: toFiniteNumber(
      v.BranchId ?? v.branchId ?? attrs.BranchId ?? attrs.Id,
    ),
    branch_name: v.GroupName || v.groupName || v.Name || v.name || null,
    position: toFiniteNumber(v._position),
    show_group_name: coerceEntrataBool(
      v.ShowGroupName != null ? v.ShowGroupName : v.showGroupName,
    ),
    show_summary_row: coerceEntrataBool(
      v.ShowSummaryRow != null ? v.ShowSummaryRow : v.showSummaryRow,
    ),
    summary_row_name: v.SummaryRowName || v.summaryRowName || null,
    description: v.Description || v.description || null,
    is_enabled: coerceEntrataBool(
      v.IsEnabled != null ? v.IsEnabled : v.isEnabled,
    ),
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function mapEntrataGlTreeAccountToRow(v, { orgId, accountId }) {
  const attrs = v["@attributes"] || v.attributes || {};
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    tree_id: toFiniteNumber(v._treeId),
    gl_account_id: toFiniteNumber(
      attrs.Id ?? attrs.AccountId ?? v.Id ?? v.AccountId ?? v.accountId,
    ),
    branch_id: toFiniteNumber(attrs.BranchId ?? v.BranchId ?? v.branchId),
    account_number:
      v.AccountNumber || v.accountNumber || attrs.AccountNumber || null,
    account_name: v.AccountName || v.accountName || attrs.AccountName || null,
    gl_group_type: v.GlGroupType || v.glGroupType || null,
    status: v.Status || v.status || null,
    is_system: coerceEntrataBool(v.IsSystem != null ? v.IsSystem : v.isSystem),
    position: toFiniteNumber(v._position),
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function mapEntrataBankAccountToRow(v, { orgId, accountId }) {
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    bank_account_id: readIdAttr(
      v,
      ["BankAccountId", "BankAccountID"],
      ["bankAccountId"],
    ),
    name: v.Name || v.name || v.AccountName || v.accountName || null,
    account_type: v.AccountType || v.accountType || v.Type || v.type || null,
    bank_name: v.BankName || v.bankName || null,
    is_disabled: coerceEntrataBool(
      v.IsDisabled != null ? v.IsDisabled : v.isDisabled,
    ),
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function mapEntrataVendorToRow(v, { orgId, accountId }) {
  const contact = v.Contact || v.contact || {};
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    vendor_id: readIdAttr(v, ["VendorId", "VendorID"], ["vendorId"]),
    name: v.Name || v.name || v.VendorName || v.vendorName || null,
    contact_name:
      contact.Name || contact.name || v.ContactName || v.contactName || null,
    phone:
      contact.Phone ||
      contact.phone ||
      (contact.Phones &&
        (contact.Phones.PhoneNumber || contact.Phones.phoneNumber)) ||
      v.Phone ||
      v.phone ||
      v.PhoneNumber ||
      v.phoneNumber ||
      null,
    email: contact.Email || contact.email || v.Email || v.email || null,
    tax_id: v.TaxId || v.taxId || v.TIN || v.tin || null,
    is_1099:
      v.Is1099 != null || v.is1099 != null
        ? coerceEntrataBool(v.Is1099 != null ? v.Is1099 : v.is1099)
        : null,
    status: v.Status || v.status || null,
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function mapEntrataLeaseActivityToRow(v, { orgId, accountId }) {
  const actId = readIdAttr(
    v,
    ["LeaseActivityId", "ActivityId", "ActivityID"],
    ["leaseActivityId", "activityId"],
  );
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    activity_id: actId,
    lease_id: toFiniteNumber(v.LeaseId || v.leaseId || v.LeaseID),
    activity_type: v.ActivityType || v.activityType || v.Type || v.type || null,
    activity_date: v.ActivityDate || v.activityDate || v.Date || v.date || null,
    description: v.Description || v.description || v.Note || v.note || null,
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function mapEntrataExpiringLeaseToRow(
  v,
  { orgId, accountId, propertyId },
) {
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    lease_id: readIdAttr(v, ["LeaseId", "LeaseID"], ["leaseId"]),
    property_id: toFiniteNumber(v.PropertyID || v.propertyId || propertyId),
    lease_end_date:
      v.LeaseEndDate || v.leaseEndDate || v.EndDate || v.endDate || null,
    notice_date: v.NoticeDate || v.noticeDate || null,
    renewal_status:
      v.RenewalStatus || v.renewalStatus || v.Status || v.status || null,
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function mapEntrataLeaseDetailsToRow(v, { orgId, accountId }) {
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    lease_id: toFiniteNumber(v.LeaseId || v.leaseId || v.LeaseID || v.id),
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

function parsePublishedRent(x) {
  const n = parseEntrataMoney(x);
  return n != null && n > 0 ? n : null;
}

export function flattenEntrataUnitAvailability(body, propertyId) {
  const root = body?.response?.result;
  if (!root || typeof root !== "object") return [];
  const container =
    root.ILS_Units || root.ils_units || root.ILSUnits || root.IlsUnits || null;
  if (!container || typeof container !== "object") return [];
  const unitNode = container.Unit ?? container.unit ?? null;
  if (!unitNode || typeof unitNode !== "object") return [];
  const nodes = Array.isArray(unitNode) ? unitNode : Object.values(unitNode);
  const asOf = new Date().toISOString();
  const out = [];
  for (const node of nodes) {
    if (!node || typeof node !== "object") continue;
    const a = node["@attributes"] || node.attributes || {};
    const rentAttrs =
      (node.Rent && node.Rent["@attributes"]) ||
      (node.rent && node.rent["@attributes"]) ||
      {};
    const termRents = asEntrataArray(
      (node.Rent && node.Rent.TermRent) ?? (node.rent && node.rent.termRent),
    );
    const termAttrList = termRents
      .map((t) =>
        t && typeof t === "object"
          ? t["@attributes"] || t.attributes || t
          : null,
      )
      .filter((t) => t && typeof t === "object");
    const availability = a.Availability ?? a.availability ?? null;
    const status = a.Status ?? a.status ?? null;
    const lowestPublished = (vals) => {
      const found = vals.map(parsePublishedRent).filter((n) => n != null);
      return found.length ? Math.min(...found) : null;
    };
    const askingRent =
      parsePublishedRent(rentAttrs.MinRent ?? rentAttrs.minRent) ??
      lowestPublished(termAttrList.map((t) => t.Rent ?? t.rent)) ??
      lowestPublished(termAttrList.map((t) => t.BaseRent ?? t.baseRent)) ??
      parsePublishedRent(rentAttrs.MaxRent ?? rentAttrs.maxRent);
    out.push({
      ...node,
      unitId: toFiniteNumber(
        a.PropertyUnitId ?? a.propertyUnitId ?? a.UnitId ?? a.unitId,
      ),
      propertyId:
        toFiniteNumber(a.PropertyId ?? a.propertyId) ??
        toFiniteNumber(propertyId),
      asOf,
      availableDate: toIsoDateOnly(
        a.AvailableOn ?? a.availableOn ?? a.AvailableDate ?? a.availableDate,
      ),
      isAvailable:
        availability == null
          ? null
          : /^available$/i.test(String(availability).trim()),
      isOnHold: status == null ? null : /hold/i.test(String(status)),
      askingRent,
    });
  }
  return out;
}

export function mapEntrataUnitAvailabilityToRow(
  v,
  { orgId, accountId, propertyId },
) {
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    property_id: toFiniteNumber(v.PropertyID || v.propertyId || propertyId),
    unit_id: readIdAttr(v, ["UnitId", "UnitID"], ["unitId"]),
    as_of: v.AsOf || v.asOf || new Date().toISOString(),
    available_date:
      v.AvailableDate ||
      v.availableDate ||
      v.DateAvailable ||
      v.dateAvailable ||
      null,
    is_available:
      v.IsAvailable != null || v.isAvailable != null
        ? coerceEntrataBool(
            v.IsAvailable != null ? v.IsAvailable : v.isAvailable,
          )
        : null,
    is_on_hold:
      v.IsOnHold != null || v.isOnHold != null
        ? coerceEntrataBool(v.IsOnHold != null ? v.IsOnHold : v.isOnHold)
        : null,
    asking_rent: parsePublishedRent(
      v.AskingRent != null
        ? v.AskingRent
        : v.askingRent != null
          ? v.askingRent
          : v.AdvertisedRent != null
            ? v.AdvertisedRent
            : v.advertisedRent != null
              ? v.advertisedRent
              : v.AskingRate != null
                ? v.AskingRate
                : v.askingRate,
    ),
    concession_amount: parseEntrataMoney(
      v.ConcessionAmount ?? v.concessionAmount,
    ),
    lease_term_months: toFiniteNumber(
      v.LeaseTermMonths ?? v.leaseTermMonths ?? v.TermMonths ?? v.termMonths,
    ),
    raw: v,
  };
}

export function mapEntrataApInvoiceToRow(v, { orgId, accountId, propertyId }) {
  const invId = readIdAttr(
    v,
    ["InvoiceId", "InvoiceID", "ApInvoiceId"],
    ["invoiceId", "apInvoiceId"],
  );
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    invoice_id: invId,
    vendor_id: toFiniteNumber(v.VendorId || v.vendorId),
    property_id: toFiniteNumber(v.PropertyID || v.propertyId || propertyId),
    invoice_number: v.InvoiceNumber || v.invoiceNumber || null,
    invoice_date: toDateOnly(v.date || v.InvoiceDate || v.invoiceDate),
    due_date: toDateOnly(v.DueDate || v.dueDate),
    post_month: toDateOnly(v.postMonth || v.PostMonth),
    post_date: toDateOnly(v.postDate || v.PostDate),
    total_amount: toFiniteNumber(
      v.TotalAmount ?? v.totalAmount ?? v.Amount ?? v.amount,
    ),
    balance: toFiniteNumber(v.Balance ?? v.balance),
    status: v.Status || v.status || null,
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function mapEntrataWorkOrderToRow(v, { orgId, accountId, propertyId }) {
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    work_order_id: readIdAttr(
      v,
      [
        "WorkOrderId",
        "WorkOrderID",
        "MaintenanceRequestId",
        "MaintenanceRequestID",
      ],
      ["maintenanceRequestId", "workOrderId"],
    ),
    property_id: toFiniteNumber(v.PropertyID || v.propertyId || propertyId),
    unit_id: toFiniteNumber(v.UnitId || v.unitId),
    status:
      v.maintenanceStatus ||
      v.MaintenanceStatus ||
      v.Status ||
      v.status ||
      null,
    priority:
      v.maintenancePriority ||
      v.MaintenancePriority ||
      v.Priority ||
      v.priority ||
      null,
    category:
      v.maintenanceCategoryName ||
      v.MaintenanceCategoryName ||
      v.maintenanceProblem ||
      v.MaintenanceProblem ||
      v.Category ||
      v.category ||
      v.WorkOrderCategory ||
      v.workOrderCategory ||
      null,
    summary:
      v.maintenanceDescription ||
      v.MaintenanceDescription ||
      v.Summary ||
      v.summary ||
      v.Description ||
      v.description ||
      null,
    created_date: parseEntrataDate(
      v.createdOn ||
        v.CreatedOn ||
        v.CreatedDate ||
        v.createdDate ||
        v.OpenDate ||
        v.openDate,
    ),
    completed_date: parseEntrataDate(
      v.completedOn ||
        v.CompletedOn ||
        v.CompletedDate ||
        v.completedDate ||
        v.CloseDate ||
        v.closeDate,
    ),
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function mapEntrataFloorPlanToRow(v, { orgId, accountId, propertyId }) {
  const idValueRaw = v.Identification?.IDValue ?? v.identification?.idValue;
  const idValueNum = idValueRaw != null ? Number(idValueRaw) : null;
  const fpId =
    Number.isFinite(idValueNum) && idValueNum > 0
      ? idValueNum
      : readIdAttr(v, ["FloorPlanId", "FloorPlanID"], ["floorPlanId"]);
  const propIdFromRow = toFiniteNumber(
    v.PropertyID != null
      ? v.PropertyID
      : v.propertyId != null
        ? v.propertyId
        : v.PropertyId != null && typeof v.PropertyId !== "object"
          ? v.PropertyId
          : null,
  );
  return {
    org_id: orgId,
    entrata_account_id: accountId,
    property_id:
      propIdFromRow != null
        ? propIdFromRow
        : propertyId != null
          ? toFiniteNumber(propertyId)
          : null,
    kind: "floor_plan",
    natural_key: fpId != null ? String(fpId) : null,
    label: v.Name || v.name || v.FloorPlanName || v.floorPlanName || null,
    raw: v,
    last_seen_at: new Date().toISOString(),
  };
}

export function getWorkOrdersDateWindow(now = new Date()) {
  const from = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate());
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) =>
    `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
  return [fmt(from), fmt(now)];
}

export function getGlPostMonthWindow(now = new Date()) {
  const from = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) => `${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
  return [fmt(from), fmt(now)];
}

export function getExpiringLeasesDateWindow(now = new Date()) {
  const to = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  const pad = (n) => String(n).padStart(2, "0");
  const fmt = (d) =>
    `${pad(d.getMonth() + 1)}/${pad(d.getDate())}/${d.getFullYear()}`;
  return [fmt(now), fmt(to)];
}

const LEASES_PAGE_SIZE = 500;

export const ENTRATA_RESOURCES = {
  properties: {
    pg_table: "entrata_properties",
    conflict: "org_id,property_id",
    cadence_minutes: 360,
    call: (ctx) =>
      entrataCall({
        ...ctx,
        resource: "properties",
        methodName: "getProperties",
      }),
    resultPath: "PhysicalProperty.Property",
    resultPathAlt: "properties.property",
    toRow: (v, { orgId, accountId }) => {
      const addr = v.Address || v.address || {};
      return {
        org_id: orgId,
        entrata_account_id: accountId,
        property_id: Number(v.PropertyID || v.propertyId || v.id),
        name: v.MarketingName || v.name || null,
        short_description: v.ShortDescription || null,
        website: v.Website || v.webSite || null,
        phone:
          (v.Phone && (v.Phone.PhoneNumber || v.Phone.phoneNumber)) ||
          v.phoneNumber ||
          null,
        email: v.Email || v.email || null,
        address_street:
          addr.Address ||
          addr.AddressLine1 ||
          addr.addressLine1 ||
          addr.street ||
          null,
        address_city: addr.City || addr.city || null,
        address_state: addr.StateCode || addr.state || null,
        address_postal: addr.PostalCode || addr.postalCode || null,
        address_country: addr.Country || addr.country || null,
        year_built: v.YearBuilt || null,
        num_units: v.NumberOfUnits || v.numUnits || null,
        is_disabled: v.IsDisabled === "true" || v.IsDisabled === true || false,
        property_type: v.Type || v.propertyType || null,
        raw: v,
        last_seen_at: new Date().toISOString(),
      };
    },
  },

  units: {
    pg_table: "entrata_units",
    conflict: "org_id,unit_id",
    cadence_minutes: 360,
    needs_property_ids: true,
    iterate_per_property: true,
    call: (ctx, _page_no, propertyId) =>
      entrataCall({
        ...ctx,
        resource: "propertyunits",
        methodName: "getPropertyUnits",
        params: { propertyIds: String(propertyId) },
      }),
    resultPath: "properties.property.units.unit",
    resultPathAlt: "PhysicalProperty.Property.Units.Unit",
    toRow: mapEntrataUnitResponseToRow,
  },

  leases: {
    pg_table: "entrata_leases",
    conflict: "org_id,lease_id",
    cadence_minutes: 360,
    paginated: true,
    needs_property_ids: true,
    iterate_per_property: true,
    paginate_by_page_size: true,
    page_size: LEASES_PAGE_SIZE,
    call: (ctx, page_no, propertyId) =>
      entrataCall({
        ...ctx,
        resource: "leases",
        methodName: "getLeases",
        version: "r1",
        page_no,
        per_page: LEASES_PAGE_SIZE,
        params: {
          propertyId: String(propertyId),
          leaseStatusTypeIds: "3,4,5,6",
          includeArTransactions: true,
        },
      }),
    resultPath: "leases.lease",
    resultPathAlt: "properties.property.leases.lease",
    toRow: mapEntrataLeaseResponseToRow,
  },

  customers: {
    pg_table: "entrata_customers",
    conflict: "org_id,customer_id",
    cadence_minutes: 360,
    needs_property_ids: true,
    iterate_per_property: true,
    call: (ctx, _page_no, propertyId) =>
      entrataCall({
        ...ctx,
        resource: "customers",
        methodName: "getCustomers",
        params: { propertyId: String(propertyId) },
      }),
    resultPath: "Customers.Customer",
    resultPathAlt: "customers.customer",
    toRow: mapEntrataCustomerResponseToRow,
  },

  gl_transactions: {
    pg_table: "entrata_gl_transactions",
    conflict: "org_id,gl_transaction_id",
    cadence_minutes: 360,
    paginated: false,
    needs_property_ids: true,
    mapped_properties_only: true,
    history_floor_from_held_months: true,
    repair_from_rollup_lines_mismatch: true,
    iterate_per_property: true,
    call: async (ctx, _page_no, propertyIdOrBatch) => {
      const batch = (
        Array.isArray(propertyIdOrBatch)
          ? propertyIdOrBatch
          : [propertyIdOrBatch]
      )
        .filter((p) => p != null)
        .map(String);
      const historyMonth = ctx.resourceHistoryMonth || null;
      const historyBatch = historyEligibleBatch(
        batch,
        historyMonth,
        ctx.resourceHistoryFloors,
      );
      const hotMonths = enumeratePostMonths(GL_HOT_MONTHS);
      const repairCalls = repairCallsForBatch(
        batch,
        ctx.resourceRepairMonths,
        ctx.resourceHistoryFloors,
        {
          hotMonths,
          historyMonth,
        },
      );
      const calls = [
        ...hotMonths.map((month) => ({ month, ids: batch })),
        ...(historyBatch.length
          ? [{ month: historyMonth, ids: historyBatch }]
          : []),
        ...repairCalls,
      ];
      const allTxns = [];
      let lastRl = null,
        firstError = null;
      const monthErrors = [];
      const recordCoverage =
        typeof ctx.recordGlDetailCoverage === "function"
          ? ctx.recordGlDetailCoverage
          : null;
      const coverageRequests = [];
      for (const { month, ids } of calls) {
        const coveragePostMonth = toPostMonth(month);
        if (recordCoverage && coveragePostMonth) {
          await recordCoverage(
            ids.map((id) => ({
              property_id: id,
              post_month: coveragePostMonth,
              status: "pending",
            })),
          );
        }
        const res = await entrataCall({
          ...ctx,
          resource: "financial",
          methodName: "getGlTransactions",
          params: {
            propertyIds: ids.join(","),
            postMonthFrom: month,
            postMonthTo: month,
            isDetailed: true,
          },
        });
        lastRl = res.rl || lastRl;
        if (!res.ok) {
          firstError = firstError || res;
          monthErrors.push({
            month,
            status: res.status,
            property_ids: ids,
            error: `getGlTransactions [${res.status}]: ${(res.raw || "").slice(0, 200)}`,
          });
          if (recordCoverage && coveragePostMonth) {
            await recordCoverage(
              ids.map((id) => ({
                property_id: id,
                post_month: coveragePostMonth,
                status: "error",
                error_message: `getGlTransactions [${res.status}]: ${(res.raw || "").slice(0, 200)}`,
              })),
            );
          }
          continue;
        }
        if (coveragePostMonth) {
          for (const id of ids) {
            coverageRequests.push({
              property_id: id,
              post_month: coveragePostMonth,
            });
          }
        }
        const props =
          res.body?.response?.result?.properties?.property ??
          res.body?.response?.result?.Properties?.Property ??
          [];
        for (const p of Array.isArray(props) ? props : [props]) {
          if (!p || typeof p !== "object") continue;
          const pAttrs = p["@attributes"] || p.attributes || {};
          const pid =
            pAttrs.id ??
            pAttrs.Id ??
            pAttrs.propertyId ??
            pAttrs.PropertyId ??
            null;
          const txns =
            p.transactions?.transaction ?? p.Transactions?.Transaction ?? [];
          for (const t of Array.isArray(txns) ? txns : [txns]) {
            if (!t || typeof t !== "object") continue;
            t._postMonth = month;
            if (pid != null) t._propertyId = pid;
            allTxns.push(t);
          }
        }
      }
      if (!allTxns.length && firstError) return firstError;
      return {
        ok: true,
        status: 200,
        rl: lastRl,
        body: {
          response: {
            result: {
              properties: {
                property: [{ transactions: { transaction: allTxns } }],
              },
            },
          },
        },
        glCoverageRequests: coverageRequests,
        glMonthErrors: monthErrors,
      };
    },
    resultPath: "properties.property.transactions.transaction",
    resultPathAlt: "Properties.Property.Transactions.Transaction",
    toRow: mapEntrataGlTransactionToRow,
    property_batch_size: 20,
    sideTable: {
      pg_table: "entrata_gl_transaction_lines",
      conflict: "org_id,gl_detail_id",
      toRows: mapEntrataGlDetailsToRows,
    },
    gl_detail_coverage: true,
  },

  ar_transactions: {
    pg_table: "entrata_ar_transactions",
    conflict: "org_id,transaction_id",
    cadence_minutes: 360,
    paginated: true,
    needs_property_ids: true,
    iterate_per_property: true,
    call: (ctx, page_no, propertyId) =>
      entrataCall({
        ...ctx,
        resource: "artransactions",
        methodName: "getLeaseArTransactions",
        version: "r1",
        page_no,
        per_page: 500,
        params: { propertyId: String(propertyId) },
      }),
    resultPath: "transactions.transaction",
    resultPathAlt: "Transactions.Transaction",
    toRow: mapEntrataArTransactionToRow,
  },

  ar_invoices: {
    pg_table: "entrata_ar_invoices",
    conflict: "org_id,invoice_id",
    cadence_minutes: 360,
    paginated: true,
    needs_property_ids: true,
    iterate_per_property: true,
    manual_only: true,
    call: (ctx, page_no, propertyId) =>
      entrataCall({
        ...ctx,
        resource: "artransactions",
        methodName: "getArInvoices",
        page_no,
        per_page: 500,
        params: { propertyId: String(propertyId) },
      }),
    resultPath: "invoices.invoice",
    resultPathAlt: "Invoices.Invoice",
    toRow: mapEntrataArInvoiceToRow,
  },

  ar_payments: {
    pg_table: "entrata_ar_payments",
    conflict: "org_id,payment_id",
    cadence_minutes: 360,
    paginated: true,
    needs_property_ids: false,
    iterate_per_property: false,
    call: (ctx, page_no) =>
      entrataCall({
        ...ctx,
        resource: "arpayments",
        methodName: "getArPayments",
        page_no,
        per_page: 500,
        params: {},
      }),
    resultPath: "ArPayments.ArPayment",
    resultPathAlt: "payments.payment",
    toRow: mapEntrataArPaymentToRow,
  },

  budgets: {
    pg_table: "entrata_budgets",
    conflict: "org_id,budget_id,gl_account_id,budget_month",
    cadence_minutes: 1440,
    paginated: false,
    needs_property_ids: true,
    iterate_per_property: true,
    call: async (ctx, _page_no, propertyId) => {
      const res = await entrataCall({
        ...ctx,
        resource: "financial",
        methodName: "getBudgets",
        params: {
          propertyIds: String(propertyId),
          budgetYear: String(new Date().getFullYear()),
        },
      });
      if (!res.ok) return res;
      const lines = flattenEntrataBudgetLines(res.body, propertyId);
      if (!lines.length) return res;
      return {
        ok: true,
        status: 200,
        rl: res.rl,
        body: { response: { result: { budgetLines: { budgetLine: lines } } } },
      };
    },
    resultPath: "budgetLines.budgetLine",
    resultPathAlt: "BudgetLines.BudgetLine",
    toRow: mapEntrataBudgetToRow,
  },

  gl_tree_branches: {
    pg_table: "entrata_gl_tree_branches",
    conflict: "org_id,tree_id,branch_id",
    cadence_minutes: 1440,
    paginated: false,
    needs_property_ids: false,
    iterate_per_property: false,
    call: async (ctx) => {
      const res = await entrataCall({
        ...ctx,
        resource: "financial",
        methodName: "getGlTrees",
      });
      if (!res.ok) return res;
      const { branches } = flattenEntrataGlTreeNodes(res.body);
      if (!branches.length) return res;
      return {
        ok: true,
        status: 200,
        rl: res.rl,
        body: {
          response: { result: { glTreeBranches: { branch: branches } } },
        },
      };
    },
    resultPath: "glTreeBranches.branch",
    toRow: mapEntrataGlTreeBranchToRow,
  },

  gl_tree_accounts: {
    pg_table: "entrata_gl_tree_accounts",
    conflict: "org_id,tree_id,gl_account_id",
    cadence_minutes: 1440,
    paginated: false,
    needs_property_ids: false,
    iterate_per_property: false,
    call: async (ctx) => {
      const res = await entrataCall({
        ...ctx,
        resource: "financial",
        methodName: "getGlTrees",
      });
      if (!res.ok) return res;
      const { accounts } = flattenEntrataGlTreeNodes(res.body);
      if (!accounts.length) return res;
      return {
        ok: true,
        status: 200,
        rl: res.rl,
        body: {
          response: { result: { glTreeAccounts: { account: accounts } } },
        },
      };
    },
    resultPath: "glTreeAccounts.account",
    toRow: mapEntrataGlTreeAccountToRow,
  },

  bank_accounts: {
    pg_table: "entrata_bank_accounts",
    conflict: "org_id,bank_account_id",
    cadence_minutes: 1440,
    needs_property_ids: false,
    iterate_per_property: false,
    call: (ctx) =>
      entrataCall({
        ...ctx,
        resource: "financial",
        methodName: "getBankAccounts",
      }),
    resultPath: "bankAccounts.bankAccount",
    resultPathAlt: "BankAccounts.BankAccount",
    toRow: mapEntrataBankAccountToRow,
  },

  vendors: {
    pg_table: "entrata_vendors",
    conflict: "org_id,vendor_id",
    cadence_minutes: 1440,
    manual_only: true,
    needs_property_ids: true,
    iterate_per_property: true,
    call: (ctx, _page_no, propertyId) =>
      entrataCall({
        ...ctx,
        resource: "vendors",
        methodName: "getVendors",
        params: { propertyId: String(propertyId) },
      }),
    resultPath: "vendors.vendor",
    resultPathAlt: "Vendors.Vendor",
    toRow: mapEntrataVendorToRow,
  },

  lease_activity: {
    pg_table: "entrata_lease_activity",
    conflict: "org_id,activity_id",
    cadence_minutes: 1440,
    manual_only: true,
    needs_property_ids: true,
    iterate_per_property: true,
    call: (ctx, _page_no, propertyId) =>
      entrataCall({
        ...ctx,
        resource: "leases",
        methodName: "getLeaseActivities",
        params: { propertyId: String(propertyId) },
      }),
    resultPath: "activities.activity",
    resultPathAlt: "Activities.Activity",
    toRow: mapEntrataLeaseActivityToRow,
  },

  expiring_leases: {
    pg_table: "entrata_expiring_leases",
    conflict: "org_id,lease_id",
    cadence_minutes: 1440,
    needs_property_ids: true,
    iterate_per_property: true,
    call: (ctx, _page_no, propertyId) => {
      const [fromDate, toDate] = getExpiringLeasesDateWindow();
      return entrataCall({
        ...ctx,
        resource: "leases",
        methodName: "getExpiringLeases",
        params: {
          propertyId: String(propertyId),
          expirationDateFrom: fromDate,
          expirationDateTo: toDate,
          fromDate,
          toDate,
        },
      });
    },
    resultPath: "leases.lease",
    resultPathAlt: "Leases.Lease",
    toRow: mapEntrataExpiringLeaseToRow,
  },

  lease_details: {
    pg_table: "entrata_lease_details",
    conflict: "org_id,lease_id",
    cadence_minutes: 1440,
    manual_only: true,
    needs_property_ids: false,
    call: () => ({
      ok: false,
      status: 0,
      body: null,
      raw: "lease_details is manual_only — call directly via per-lease lookup",
      rl: emptyRateLimit(),
      attempts: 0,
    }),
    resultPath: "leases.lease",
    resultPathAlt: "Leases.Lease",
    toRow: mapEntrataLeaseDetailsToRow,
  },

  unit_availability: {
    pg_table: "entrata_unit_availability",
    conflict: "",
    cadence_minutes: 1440,
    needs_property_ids: true,
    iterate_per_property: true,
    call: async (ctx, _page_no, propertyId) => {
      const res = await entrataCall({
        ...ctx,
        resource: "propertyunits",
        methodName: "getUnitsAvailabilityAndPricing",
        params: { propertyId: String(propertyId) },
      });
      if (!res.ok) return res;
      const units = flattenEntrataUnitAvailability(res.body, propertyId);
      if (!units.length) return res;
      return {
        ok: true,
        status: 200,
        rl: res.rl,
        body: { response: { result: { unitAvailability: { unit: units } } } },
      };
    },
    resultPath: "unitAvailability.unit",
    resultPathAlt: "UnitAvailability.Unit",
    toRow: mapEntrataUnitAvailabilityToRow,
  },

  ap_invoices: {
    pg_table: "entrata_invoices",
    conflict: "org_id,invoice_id",
    cadence_minutes: 1440,
    paginated: true,
    needs_property_ids: true,
    iterate_per_property: true,
    call: (ctx, page_no, propertyId) =>
      entrataCall({
        ...ctx,
        resource: "vendors",
        methodName: "getInvoices",
        version: "r2",
        page_no,
        per_page: 500,
        params: { propertyIds: String(propertyId) },
      }),
    resultPath: "invoices.invoice",
    resultPathAlt: "Invoices.Invoice",
    toRow: mapEntrataApInvoiceToRow,
    page_size: 500,
  },

  work_orders: {
    pg_table: "entrata_work_orders",
    conflict: "org_id,work_order_id",
    cadence_minutes: 1440,
    needs_property_ids: true,
    iterate_per_property: true,
    call: (ctx, _page_no, propertyId) => {
      const [fromDate, toDate] = getWorkOrdersDateWindow();
      return entrataCall({
        ...ctx,
        resource: "maintenance",
        methodName: "getWorkOrders",
        params: {
          propertyId: String(propertyId),
          workOrderDateFrom: fromDate,
          workOrderDateTo: toDate,
        },
      });
    },
    resultPath: "workOrders.workOrder",
    resultPathAlt: "WorkOrders.WorkOrder",
    toRow: mapEntrataWorkOrderToRow,
  },

  property_meta_floor_plans: {
    pg_table: "entrata_property_meta",
    conflict: "org_id,property_id,kind,natural_key",
    cadence_minutes: 1440,
    needs_property_ids: true,
    iterate_per_property: true,
    call: (ctx, _page_no, propertyId) =>
      entrataCall({
        ...ctx,
        resource: "properties",
        methodName: "getFloorPlans",
        params: { propertyId: String(propertyId) },
      }),
    resultPath: "FloorPlans.FloorPlan",
    resultPathAlt: "floorplans.floorplan",
    toRow: mapEntrataFloorPlanToRow,
  },
};

export const FUNCTION_SAFE_CAP_MS = 13.5 * 60_000;

export const SCHEDULED_FUNCTION_WALL_CLOCK_MS =
  Number(process.env.CONNECTOR_SYNC_WALL_CLOCK_MS) > 0
    ? Number(process.env.CONNECTOR_SYNC_WALL_CLOCK_MS)
    : 60_000;

const SYNC_DEADLINE_SAFETY_MS = 30_000;

export function deadlineSafetyReserveMs(
  remainingMs,
  maxReserveMs = SYNC_DEADLINE_SAFETY_MS,
) {
  if (!Number.isFinite(remainingMs) || remainingMs <= 0) return 0;
  return Math.max(1_000, Math.min(maxReserveMs, Math.floor(remainingMs * 0.2)));
}

const RUN_ROW_CLOSE_RESERVE_MS = 3_000;

export function runRowCloseReserveMs(remainingMs) {
  const perResourceReserve = deadlineSafetyReserveMs(remainingMs);
  return Math.min(RUN_ROW_CLOSE_RESERVE_MS, Math.floor(perResourceReserve / 2));
}

const PRELOOP_BUDGET_MS = 60_000;
const HELD_FLOOR_READ_BUDGET_MS = 5_000;

export class SyncDeadlineTimeout extends Error {
  constructor() {
    super("sync deadline exceeded");
    this.name = "SyncDeadlineTimeout";
    this.syncDeadlineTimedOut = true;
  }
}
export async function withSyncDeadline(deadlineMs, work) {
  const remaining = deadlineMs - Date.now();
  if (remaining <= 0) throw new SyncDeadlineTimeout();
  let timer;
  const deadlinePromise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new SyncDeadlineTimeout()), remaining);
  });
  try {
    return await Promise.race([work(), deadlinePromise]);
  } finally {
    clearTimeout(timer);
  }
}

export const CHUNK_RESUMABLE_RESOURCES = new Set([
  "gl_transactions",
  "ap_invoices",
  "ar_invoices",
  "budgets",
  "customers",
  "expiring_leases",
  "units",
  "unit_availability",
  "property_meta_floor_plans",
  "ar_payments",
  "leases",
  "ar_transactions",
  "work_orders",
  "vendors",
  "lease_activity",
]);

const RATE_LIMIT_MINUTE_FLOOR = 1;
const RATE_LIMIT_HOUR_FLOOR = 1;
const RATE_LIMIT_DAY_FLOOR = 0;
const RATE_LIMIT_MAX_WAIT_MS = 65_000;

const RATE_LIMIT_MAX_WAIT_FRACTION = 1 / 3;

export function decideRatePacing({
  rl,
  nowMs,
  deadlineMs,
  deadlineSafetyMs = 8_000,
}) {
  if (!rl || typeof rl !== "object") return { action: "proceed" };

  if (rl.day != null && rl.day <= RATE_LIMIT_DAY_FLOOR) {
    return { action: "stop", bucket: "day" };
  }
  if (rl.hour != null && rl.hour <= RATE_LIMIT_HOUR_FLOOR) {
    return { action: "stop", bucket: "hour" };
  }
  if (rl.minute != null && rl.minute <= RATE_LIMIT_MINUTE_FLOOR) {
    const resetSec = rl.resetSeconds && rl.resetSeconds.minute;
    if (Number.isFinite(resetSec) && resetSec >= 0) {
      const waitMs = (resetSec + 1) * 1000;
      const fits = Number.isFinite(deadlineMs)
        ? nowMs + waitMs + deadlineSafetyMs <= deadlineMs
        : true;
      const withinShare = Number.isFinite(deadlineMs)
        ? waitMs <= (deadlineMs - nowMs) * RATE_LIMIT_MAX_WAIT_FRACTION
        : true;
      if (waitMs <= RATE_LIMIT_MAX_WAIT_MS && fits && withinShare) {
        return { action: "wait", waitMs, bucket: "minute" };
      }
    }
    return { action: "stop", bucket: "minute" };
  }
  return { action: "proceed" };
}

export const RESOURCE_SYNC_CURSORS_KEY = "resource_sync_cursors";

export function readResourceCursorIndex(
  config,
  resourceType,
  listLength = null,
) {
  if (!config || typeof config !== "object") return 0;
  const cursors = config[RESOURCE_SYNC_CURSORS_KEY];
  if (!cursors || typeof cursors !== "object") return 0;
  const entry = cursors[resourceType];
  const pos = entry && Number.isInteger(entry.pos) ? entry.pos : 0;
  if (pos < 0) return 0;
  if (Number.isInteger(listLength) && pos >= listLength) return 0;
  return pos;
}

export function withResourceCursor(config, resourceType, nextPos) {
  const base = config && typeof config === "object" ? config : {};
  const cursors = { ...(base[RESOURCE_SYNC_CURSORS_KEY] || {}) };
  if (nextPos == null) delete cursors[resourceType];
  else cursors[resourceType] = { pos: nextPos };
  return { ...base, [RESOURCE_SYNC_CURSORS_KEY]: cursors };
}

export function withResourcePassHistoryMonth(config, resourceType, month) {
  const base = config && typeof config === "object" ? config : {};
  const months = { ...(base.resource_pass_history_month || {}) };
  if (typeof month === "string" && month) months[resourceType] = month;
  else delete months[resourceType];
  return { ...base, resource_pass_history_month: months };
}

export function withResourcePassRepairMonths(config, resourceType, repairs) {
  const base = config && typeof config === "object" ? config : {};
  const months = { ...(base.resource_pass_repair_months || {}) };
  if (Array.isArray(repairs) && repairs.length) {
    months[resourceType] = repairs.map((r) => ({
      property_id: String(r.property_id),
      month: r.month,
    }));
  } else delete months[resourceType];
  return { ...base, resource_pass_repair_months: months };
}

export function withResourcePassIndex(config, resourceType, nextPassIndex) {
  const base = config && typeof config === "object" ? config : {};
  const passIndexes = { ...(base.resource_pass_index || {}) };
  passIndexes[resourceType] = Number.isFinite(nextPassIndex)
    ? Math.max(0, Math.trunc(nextPassIndex))
    : 0;
  return { ...base, resource_pass_index: passIndexes };
}

export async function persistConnectorConfig({
  connector,
  config,
  bearer,
  pgFn = pg,
}) {
  const res = await pgFn({
    bearer,
    path: `/connectors?id=eq.${encodeURIComponent(connector.id)}`,
    method: "PATCH",
    body: { config },
    prefer: "return=minimal",
  });
  if (!res || !res.ok) {
    console.error(
      "[sync-cursor] resource cursor persist failed",
      JSON.stringify({
        connector_id: connector?.id,
        status: res?.status ?? null,
      }),
    );
    return false;
  }
  return true;
}

export function describePartialLoss(resourceType, diag) {
  if (!diag) return null;
  const parts = [];
  const months = Array.isArray(diag.gl_month_errors)
    ? diag.gl_month_errors
    : [];
  if (months.length) {
    const m = months[0];
    parts.push(
      `${months.length} GL month${months.length === 1 ? "" : "s"} failed` +
        ` (${m.month}, ${m.property_count ?? (m.property_ids || []).length} propert${(m.property_count ?? 0) === 1 ? "y" : "ies"}): ${m.error}`,
    );
  }
  const props = Array.isArray(diag.property_error_list)
    ? diag.property_error_list
    : [];
  const nonRateLimited = props.filter((p) => p.status !== 429);
  if (nonRateLimited.length) {
    const p = nonRateLimited[0];
    const n = Math.max(diag.property_errors || 0, nonRateLimited.length);
    parts.push(
      `${n} propert${n === 1 ? "y" : "ies"} failed (property ${p.property_id} [${p.status}]: ${p.error})`,
    );
  }
  if (diag.no_pagination_info_full_page > 0) {
    const s = diag.sample_truncated_property;
    parts.push(
      `${diag.no_pagination_info_full_page} full page${diag.no_pagination_info_full_page === 1 ? "" : "s"}` +
        " returned without pagination info; later pages were not fetched" +
        (s ? ` (property ${s.property_id}, ${s.items} items)` : ""),
    );
  }
  if (!parts.length) return null;
  return `Entrata ${resourceType} incomplete: ${parts.join("; ")}`.slice(
    0,
    500,
  );
}

const ENTRATA_ADAPTER = {
  vendor: "entrata",
  resources: Object.keys(ENTRATA_RESOURCES),

  async sync({
    connector,
    resourceType,
    bearer,
    pgImpl,
    functionDeadline = null,
    runId = null,
  }) {
    const spec = ENTRATA_RESOURCES[resourceType];
    if (!spec)
      return {
        rowsRead: 0,
        rowsWritten: 0,
        error: `Unknown Entrata resource: ${resourceType}`,
      };

    const pgFn = pgImpl || pg;
    const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
    if (!SERVICE_ROLE_KEY) {
      return {
        rowsRead: 0,
        rowsWritten: 0,
        error: "SUPABASE_SERVICE_ROLE_KEY not set",
      };
    }
    const writeBearer = SERVICE_ROLE_KEY;
    const orgId = connector.org_id;

    if (spec.manual_only) {
      return {
        rowsRead: 0,
        rowsWritten: 0,
        payload: { diag: { skipped: "manual_only", resource: resourceType } },
      };
    }

    const cadenceMinutes = spec.cadence_minutes;
    if (Number.isFinite(cadenceMinutes) && cadenceMinutes > 0) {
      const sinceIso = new Date(
        Date.now() - cadenceMinutes * 60_000,
      ).toISOString();
      const cadenceSkipLiteral = encodeURIComponent(
        JSON.stringify({ diag: { skipped: "cadence_not_elapsed" } }),
      );
      const lastRunRes = await pgFn({
        bearer: writeBearer,
        path:
          `/connector_sync_runs?connector_id=eq.${encodeURIComponent(connector.id)}` +
          `&resource_type=eq.${encodeURIComponent(resourceType)}` +
          `&status=eq.success` +
          `&payload=not.cs.${cadenceSkipLiteral}` +
          `&started_at=gte.${encodeURIComponent(sinceIso)}` +
          `&select=started_at&order=started_at.desc&limit=1`,
      });
      if (
        lastRunRes &&
        lastRunRes.ok &&
        Array.isArray(lastRunRes.body) &&
        lastRunRes.body.length
      ) {
        return {
          rowsRead: 0,
          rowsWritten: 0,
          payload: {
            diag: {
              skipped: "cadence_not_elapsed",
              resource: resourceType,
              cadence_minutes: cadenceMinutes,
              last_run_at: lastRunRes.body[0].started_at,
            },
          },
        };
      }
    }

    let preloopDeadline = Date.now() + PRELOOP_BUDGET_MS;
    if (functionDeadline != null) {
      preloopDeadline = Math.min(
        preloopDeadline,
        functionDeadline -
          deadlineSafetyReserveMs(functionDeadline - Date.now()),
      );
    }
    const preloopBudgetMs = preloopDeadline - Date.now();
    const preloopExhausted = preloopBudgetMs < 3000;

    console.log(
      JSON.stringify({
        diag: "entrata-timing",
        phase: "syncResource.preContext",
        wallClockMs: Date.now(),
        resource_type: resourceType,
        connector_id: connector.id,
      }),
    );
    let ctx;
    try {
      ctx = await withSyncDeadline(preloopDeadline, () =>
        getEntrataContext({ orgId, pgFn, SERVICE_ROLE_KEY, _diagOrgId: orgId }),
      );
    } catch (e) {
      if (e && e.syncDeadlineTimedOut) {
        return {
          rowsRead: 0,
          rowsWritten: 0,
          partial: true,
          payload: {
            diag: {
              preloop_timed_out: true,
              preloop_step: "getEntrataContext",
              resource: resourceType,
              clock_exhausted: preloopExhausted,
              preloop_budget_ms: preloopBudgetMs,
            },
          },
        };
      }
      throw e;
    }
    console.log(
      JSON.stringify({
        diag: "entrata-timing",
        phase: "syncResource.postContext",
        wallClockMs: Date.now(),
        resource_type: resourceType,
        connector_id: connector.id,
        hadError: !!ctx?.error,
      }),
    );
    if (ctx.error) return { rowsRead: 0, rowsWritten: 0, error: ctx.error };
    const callCtx = {
      baseUrl: ctx.baseUrl,
      subdomain: ctx.subdomain,
      apiKey: ctx.apiKey,
    };

    if (spec.needs_property_ids) {
      console.log(
        JSON.stringify({
          diag: "entrata-timing",
          phase: "propsRes.start",
          wallClockMs: Date.now(),
          resource_type: resourceType,
          connector_id: connector.id,
        }),
      );
      let propsRes;
      try {
        propsRes = await withSyncDeadline(preloopDeadline, () =>
          pgFn({
            bearer: writeBearer,
            path: `/entrata_properties?org_id=eq.${orgId}&entrata_account_id=eq.${ctx.accountId}&select=property_id&limit=5000`,
          }),
        );
      } catch (e) {
        if (e && e.syncDeadlineTimedOut) {
          return {
            rowsRead: 0,
            rowsWritten: 0,
            partial: true,
            payload: {
              diag: {
                preloop_timed_out: true,
                preloop_step: "propsRes",
                resource: resourceType,
                clock_exhausted: preloopExhausted,
                preloop_budget_ms: preloopBudgetMs,
              },
            },
          };
        }
        throw e;
      }
      console.log(
        JSON.stringify({
          diag: "entrata-timing",
          phase: "propsRes.done",
          wallClockMs: Date.now(),
          resource_type: resourceType,
          connector_id: connector.id,
          ok: !!propsRes?.ok,
          status: propsRes?.status,
          rowCount: Array.isArray(propsRes?.body) ? propsRes.body.length : null,
        }),
      );
      if (!propsRes.ok) {
        return {
          rowsRead: 0,
          rowsWritten: 0,
          error: `Fetch entrata_properties for ${resourceType} failed [${propsRes.status}]: ${(propsRes.raw || "").slice(0, 200)}`,
        };
      }
      const ids = (propsRes.body || [])
        .map((r) => r.property_id)
        .filter(Boolean);
      if (!ids.length) {
        return {
          rowsRead: 0,
          rowsWritten: 0,
          error: `No entrata_properties rows yet — run the 'properties' sync first before syncing ${resourceType}.`,
        };
      }
      const propertyScopeDiag = { properties_total: ids.length };
      let scopedIds = ids;
      if (spec.mapped_properties_only) {
        let mappedPropsRes;
        try {
          mappedPropsRes = await withSyncDeadline(preloopDeadline, () =>
            pgFn({
              bearer: writeBearer,
              path: `/properties?org_id=eq.${encodeURIComponent(orgId)}&entrata_property_id=not.is.null&select=entrata_property_id&limit=5000`,
            }),
          );
        } catch (e) {
          if (e && e.syncDeadlineTimedOut) {
            return {
              rowsRead: 0,
              rowsWritten: 0,
              partial: true,
              payload: {
                diag: {
                  preloop_timed_out: true,
                  preloop_step: "mappedProperties",
                  resource: resourceType,
                  clock_exhausted: preloopExhausted,
                  preloop_budget_ms: preloopBudgetMs,
                  properties_mapped: 0,
                  ...propertyScopeDiag,
                },
              },
            };
          }
          throw e;
        }
        if (!mappedPropsRes?.ok) {
          return {
            rowsRead: 0,
            rowsWritten: 0,
            error: `Fetch mapped properties for ${resourceType} failed [${mappedPropsRes?.status}]: ${(mappedPropsRes?.raw || "").slice(0, 200)}`,
            payload: { diag: { ...propertyScopeDiag, properties_mapped: 0 } },
          };
        }
        const mappedIds = new Set(
          (mappedPropsRes.body || [])
            .map((r) => r.entrata_property_id)
            .filter(Boolean)
            .map(String),
        );
        scopedIds = ids.filter((id) => mappedIds.has(String(id)));
        propertyScopeDiag.properties_mapped = scopedIds.length;
        if (!scopedIds.length) {
          return {
            rowsRead: 0,
            rowsWritten: 0,
            error: `No mapped properties available for ${resourceType} — map at least one public.properties.entrata_property_id before syncing.`,
            payload: { diag: propertyScopeDiag },
          };
        }
      }
      callCtx.propertyIds = scopedIds;
      callCtx.propertyScopeDiag = propertyScopeDiag;
    }

    const SYNC_BUDGET_MS = spec.iterate_per_property ? 4 * 60_000 : 21_000;
    let syncDeadline = Date.now() + SYNC_BUDGET_MS;
    if (functionDeadline != null) {
      syncDeadline = Math.min(
        syncDeadline,
        functionDeadline -
          deadlineSafetyReserveMs(functionDeadline - Date.now()),
      );
    }
    let partial = false;

    let totalRead = 0,
      totalWritten = 0;
    const diag = {
      resource: resourceType,
      pages: 0,
      entries: 0,
      properties_done: 0,
      rateLimit: null,
      ...(callCtx.propertyScopeDiag || {}),
    };

    const recordCoverageRows = spec.gl_detail_coverage
      ? (rows) =>
          recordGlDetailCoverage({
            pgFn,
            bearer: writeBearer,
            orgId,
            accountId: ctx.accountId,
            runId,
            rows,
            diag,
          })
      : null;
    if (recordCoverageRows) callCtx.recordGlDetailCoverage = recordCoverageRows;

    const processOnePage = async (res, contextPropertyId = null) => {
      diag.rateLimit = res.rl;
      if (!res.ok) {
        if (res.status === 401 || res.status === 403) {
          await pgFn({
            bearer: writeBearer,
            path: `/org_entrata_accounts?id=eq.${ctx.accountId}`,
            method: "PATCH",
            body: {
              status: "needs_reauth",
              last_error_code: "auth_failed",
              last_error_message: (res.raw || "").slice(0, 300),
              last_error_at: new Date().toISOString(),
            },
            prefer: "return=minimal",
          });
        }
        return {
          ok: false,
          status: res.status,
          error: `Entrata ${resourceType} [${res.status}]: ${(res.raw || "").slice(0, 300)}`,
        };
      }
      if (Array.isArray(res.glMonthErrors) && res.glMonthErrors.length) {
        diag.gl_month_errors = (diag.gl_month_errors || [])
          .concat(
            res.glMonthErrors.map((m) => ({
              month: m.month,
              status: m.status,
              error: m.error,
              property_ids: (m.property_ids || []).slice(0, 25),
              property_count: (m.property_ids || []).length,
            })),
          )
          .slice(0, 50);
        partial = true;
      }
      let items = pickArray(res.body, spec.resultPath);
      if (!items.length && spec.resultPathAlt)
        items = pickArray(res.body, spec.resultPathAlt);
      if (!items.length && !diag.first_empty_shape) {
        const result = res.body?.response?.result || {};
        diag.first_empty_shape = {
          top_keys: Object.keys(result).slice(0, 10),
          preview: JSON.stringify(result).slice(0, 400),
        };
      }
      const resultRoot = res.body?.response?.result;
      if (
        !items.length &&
        resultRoot &&
        typeof resultRoot === "object" &&
        !Array.isArray(resultRoot) &&
        typeof resultRoot.success === "string"
      ) {
        diag.skipped_text_success_shape =
          (diag.skipped_text_success_shape || 0) + 1;
      }
      diag.entries += items.length;
      totalRead += items.length;
      let glCoverageDetailRows = [];
      if (items.length) {
        const toRowCtx = {
          orgId,
          accountId: ctx.accountId,
          propertyId: contextPropertyId,
        };
        const natKeyCols = (spec.conflict || "org_id,unit_id")
          .split(",")
          .map((s) => s.trim())
          .filter((c) => c && c !== "org_id" && c !== "entrata_account_id");
        const mappedAll = items.map((v) => spec.toRow(v, toRowCtx));
        const mapped = mappedAll.filter((r) =>
          natKeyCols.every((c) => r[c] != null),
        );
        if (mapped.length < mappedAll.length) {
          const droppedCount = mappedAll.length - mapped.length;
          diag.dropped_for_null_natkey =
            (diag.dropped_for_null_natkey || 0) + droppedCount;
          if (!diag.sample_dropped_keys) {
            const firstDropped = mappedAll.find(
              (r) => !natKeyCols.every((c) => r[c] != null),
            );
            if (firstDropped) {
              const sample = {};
              for (const c of natKeyCols) sample[c] = firstDropped[c] ?? null;
              diag.sample_dropped_keys = sample;
            }
          }
        }
        const rows = spec.conflict
          ? dedupeRowsByConflictKey(mapped, spec.conflict)
          : mapped;
        if (rows.length < mapped.length) {
          diag.deduped = (diag.deduped || 0) + (mapped.length - rows.length);
        }
        if (rows.length === 0) {
          diag.skipped_empty_upsert = (diag.skipped_empty_upsert || 0) + 1;
        } else {
          const upsertPath = spec.conflict
            ? `/${spec.pg_table}?on_conflict=${spec.conflict}`
            : `/${spec.pg_table}`;
          const upsertPrefer = spec.conflict
            ? "resolution=merge-duplicates,return=minimal"
            : "return=minimal";
          const UPSERT_TIMEOUT_MS = 30_000;
          const upsertController = new AbortController();
          const upsertTimer = setTimeout(
            () => upsertController.abort(),
            UPSERT_TIMEOUT_MS,
          );
          let upsert;
          try {
            upsert = await pgFn({
              bearer: writeBearer,
              path: upsertPath,
              method: "POST",
              prefer: upsertPrefer,
              body: rows,
              signal: upsertController.signal,
            });
          } finally {
            clearTimeout(upsertTimer);
          }
          if (!upsert.ok) {
            return {
              ok: false,
              error: `Upsert ${spec.pg_table} failed [${upsert.status}]: ${(upsert.raw || "").slice(0, 200)}`,
            };
          }
          totalWritten += rows.length;
        }

        if (spec.sideTable && typeof spec.sideTable.toRows === "function") {
          const st = spec.sideTable;
          const stNatKeyCols = (st.conflict || "")
            .split(",")
            .map((s) => s.trim())
            .filter((c) => c && c !== "org_id" && c !== "entrata_account_id");
          const stAll = [];
          for (const v of items) {
            const produced = st.toRows(v, toRowCtx);
            if (Array.isArray(produced) && produced.length)
              stAll.push(...produced);
          }
          diag.side_entries = (diag.side_entries || 0) + stAll.length;
          const stMapped = stAll.filter(
            (r) => r && stNatKeyCols.every((c) => r[c] != null),
          );
          if (stMapped.length < stAll.length) {
            diag.side_dropped_for_null_natkey =
              (diag.side_dropped_for_null_natkey || 0) +
              (stAll.length - stMapped.length);
          }
          if (spec.gl_detail_coverage) glCoverageDetailRows = stAll;
          const stRows = st.conflict
            ? dedupeRowsByConflictKey(stMapped, st.conflict)
            : stMapped;
          if (stRows.length < stMapped.length) {
            diag.side_deduped =
              (diag.side_deduped || 0) + (stMapped.length - stRows.length);
          }
          if (stRows.length) {
            const SIDE_CHUNK = 500;
            for (let i = 0; i < stRows.length; i += SIDE_CHUNK) {
              const slice = stRows.slice(i, i + SIDE_CHUNK);
              const stController = new AbortController();
              const stTimer = setTimeout(() => stController.abort(), 30_000);
              let stUpsert;
              try {
                stUpsert = await pgFn({
                  bearer: writeBearer,
                  path: st.conflict
                    ? `/${st.pg_table}?on_conflict=${st.conflict}`
                    : `/${st.pg_table}`,
                  method: "POST",
                  prefer: st.conflict
                    ? "resolution=merge-duplicates,return=minimal"
                    : "return=minimal",
                  body: slice,
                  signal: stController.signal,
                });
              } finally {
                clearTimeout(stTimer);
              }
              if (!stUpsert.ok) {
                const stError = `Upsert ${st.pg_table} failed [${stUpsert.status}]: ${(stUpsert.raw || "").slice(0, 200)}`;
                if (
                  spec.gl_detail_coverage &&
                  recordCoverageRows &&
                  Array.isArray(res.glCoverageRequests) &&
                  res.glCoverageRequests.length
                ) {
                  const keyOf = (r) => `${r.property_id}|${r.post_month}`;
                  const stranded = new Set();
                  const landed = new Set();
                  for (let j = 0; j < stRows.length; j += 1) {
                    const sr = stRows[j];
                    if (!sr || sr.property_id == null || !sr.post_month)
                      continue;
                    (j < i ? landed : stranded).add(keyOf(sr));
                  }
                  const terminal = glDetailCoverageTerminalRows({
                    requests: res.glCoverageRequests,
                    detailRows: stAll,
                  });
                  await recordCoverageRows(
                    terminal.map((r) => {
                      const k = keyOf(r);
                      if (landed.has(k) && !stranded.has(k)) return r;
                      return {
                        property_id: r.property_id,
                        post_month: r.post_month,
                        status: "error",
                        error_message: stError,
                      };
                    }),
                  );
                }
                return { ok: false, error: stError };
              }
              diag.side_rows_written =
                (diag.side_rows_written || 0) + slice.length;
            }
          }
        }
      }

      if (
        spec.gl_detail_coverage &&
        recordCoverageRows &&
        Array.isArray(res.glCoverageRequests) &&
        res.glCoverageRequests.length
      ) {
        await recordCoverageRows(
          glDetailCoverageTerminalRows({
            requests: res.glCoverageRequests,
            detailRows: glCoverageDetailRows,
          }),
        );
      }
      diag.pages += 1;
      const pageInfo =
        res.body?.response?.result?.paginationInfo ||
        res.body?.response?.result?.PaginationInfo ||
        null;
      let hasMore;
      if (pageInfo) {
        hasMore = !!(
          pageInfo.hasMorePages === "true" ||
          pageInfo.hasMorePages === true ||
          pageInfo.hasNextPage === true
        );
      } else if (spec.paginate_by_page_size && spec.page_size > 0) {
        hasMore = items.length >= spec.page_size;
        if (hasMore) diag.page_size_pagination = true;
      } else {
        diag.no_pagination_info = (diag.no_pagination_info || 0) + 1;
        if (spec.page_size > 0 && items.length >= spec.page_size) {
          diag.no_pagination_info_full_page =
            (diag.no_pagination_info_full_page || 0) + 1;
          if (!diag.sample_truncated_property) {
            diag.sample_truncated_property = {
              property_id: contextPropertyId,
              items: items.length,
            };
          }
        }
        hasMore = false;
      }
      return { ok: true, hasMore };
    };

    if (spec.iterate_per_property) {
      const rawPids = callCtx.propertyIds || [];
      const batchSize =
        Number.isFinite(spec.property_batch_size) &&
        spec.property_batch_size > 1
          ? Math.floor(spec.property_batch_size)
          : 1;
      const pids =
        batchSize > 1
          ? Array.from(
              { length: Math.ceil(rawPids.length / batchSize) },
              (_, k) => rawPids.slice(k * batchSize, (k + 1) * batchSize),
            )
          : rawPids;
      const PER_PROPERTY_DELAY_MS = 120;

      const resumable = CHUNK_RESUMABLE_RESOURCES.has(resourceType);
      let liveConfig = connector.config || {};
      let startIdx = 0;
      if (resumable) {
        try {
          const cfgRes = await pgFn({
            bearer: writeBearer,
            path: `/connectors?id=eq.${encodeURIComponent(connector.id)}&select=config`,
          });
          if (
            cfgRes &&
            cfgRes.ok &&
            Array.isArray(cfgRes.body) &&
            cfgRes.body[0]?.config
          ) {
            liveConfig = cfgRes.body[0].config;
          }
        } catch {}
        startIdx = readResourceCursorIndex(
          liveConfig,
          resourceType,
          pids.length,
        );
        diag.resume_from = startIdx;
      }
      const configuredPassIndex = Number.isFinite(
        liveConfig?.resource_pass_index?.[resourceType],
      )
        ? Math.max(0, Math.trunc(liveConfig.resource_pass_index[resourceType]))
        : 0;
      callCtx.resourcePassIndex =
        startIdx === 0
          ? configuredPassIndex
          : Math.max(0, configuredPassIndex - 1);
      diag.resource_pass_index = callCtx.resourcePassIndex;

      callCtx.resourceHistoryMonth = null;
      callCtx.resourceHistoryFloors = null;
      if (spec.history_floor_from_held_months) {
        const floors = {};
        let floorsRead = 0;
        try {
          await withSyncDeadline(
            Math.min(syncDeadline, Date.now() + HELD_FLOOR_READ_BUDGET_MS),
            async () => {
              const ids = rawPids.map(String);
              const CONCURRENCY = 8;
              for (let i = 0; i < ids.length; i += CONCURRENCY) {
                const slice = ids.slice(i, i + CONCURRENCY);
                const results = await Promise.all(
                  slice.map((pid) =>
                    pgFn({
                      bearer: writeBearer,
                      path:
                        `/entrata_gl_transactions?org_id=eq.${encodeURIComponent(orgId)}` +
                        `&property_id=eq.${encodeURIComponent(pid)}` +
                        "&select=post_month&order=post_month.asc&limit=1",
                    })
                      .then((res) =>
                        res?.ok &&
                        Array.isArray(res.body) &&
                        res.body[0]?.post_month
                          ? resolveHistoryFloor(res.body[0].post_month)
                          : null,
                      )
                      .catch(() => null),
                  ),
                );
                slice.forEach((pid, k) => {
                  if (results[k]) {
                    floors[pid] = results[k];
                    floorsRead += 1;
                  }
                });
              }
            },
          );
        } catch (e) {
          diag.gl_history_floor_unavailable = e?.syncDeadlineTimedOut
            ? "timed_out"
            : "read_failed";
        }
        if (!floorsRead)
          diag.gl_history_floor_unavailable =
            diag.gl_history_floor_unavailable || "no_held_months";
        callCtx.resourceHistoryFloors = floorsRead ? floors : null;

        const deepestFloor = floorsRead
          ? Object.values(floors).reduce(
              (acc, f) => earlierPostMonth(acc, f),
              null,
            )
          : null;
        if (resumable && startIdx > 0) {
          const storedMonth =
            liveConfig?.resource_pass_history_month?.[resourceType];
          callCtx.resourceHistoryMonth =
            typeof storedMonth === "string" ? storedMonth : null;
          diag.gl_history_month_source = "resumed";
        } else {
          callCtx.resourceHistoryMonth = deepestFloor
            ? pickHistoryMonth(
                glHistoryWindow(new Date(), deepestFloor),
                callCtx.resourcePassIndex,
              )
            : null;
          diag.gl_history_month_source = "resolved";
        }
        if (!callCtx.resourceHistoryFloors) callCtx.resourceHistoryMonth = null;
        diag.gl_history_floor = deepestFloor;
        diag.gl_history_floors_read = floorsRead;
        diag.gl_history_month = callCtx.resourceHistoryMonth;

        callCtx.resourceRepairMonths = null;
        if (
          spec.repair_from_rollup_lines_mismatch &&
          callCtx.resourceHistoryFloors
        ) {
          if (resumable && startIdx > 0) {
            const stored =
              liveConfig?.resource_pass_repair_months?.[resourceType];
            callCtx.resourceRepairMonths = Array.isArray(stored)
              ? normalizeRepairCandidates(
                  stored.map((s) => ({
                    property_id: s.property_id,
                    post_month: toPostMonth(s.month),
                  })),
                )
              : null;
            diag.gl_repair_months_source = "resumed";
          } else {
            try {
              const res = await withSyncDeadline(
                Math.min(syncDeadline, Date.now() + HELD_FLOOR_READ_BUDGET_MS),
                () =>
                  pgFn({
                    bearer: writeBearer,
                    path: "/rpc/gl_rollup_lines_repair_candidates",
                    method: "POST",
                    body: {
                      p_org_id: orgId,
                      p_limit: GL_REPAIR_MONTHS_PER_PASS,
                    },
                  }),
              );
              if (res?.ok && Array.isArray(res.body)) {
                callCtx.resourceRepairMonths = normalizeRepairCandidates(
                  res.body,
                );
                diag.gl_repair_months_source = "resolved";
              } else {
                diag.gl_repair_months_unavailable = `http_${res?.status ?? 0}`;
              }
            } catch (e) {
              diag.gl_repair_months_unavailable = e?.syncDeadlineTimedOut
                ? "timed_out"
                : "read_failed";
            }
          }
        }
        diag.gl_repair_months = callCtx.resourceRepairMonths
          ? callCtx.resourceRepairMonths.map(
              (r) => `${r.property_id}@${r.month}`,
            )
          : null;
      }

      if (resumable && startIdx === 0) {
        liveConfig = withResourcePassIndex(
          liveConfig,
          resourceType,
          configuredPassIndex + 1,
        );
        if (spec.history_floor_from_held_months) {
          liveConfig = withResourcePassHistoryMonth(
            liveConfig,
            resourceType,
            callCtx.resourceHistoryMonth,
          );
          liveConfig = withResourcePassRepairMonths(
            liveConfig,
            resourceType,
            callCtx.resourceRepairMonths,
          );
        }
        await persistConnectorConfig({
          connector,
          config: liveConfig,
          bearer: writeBearer,
          pgFn,
        });
        diag.resource_pass_index_next = configuredPassIndex + 1;
      }

      console.log(
        JSON.stringify({
          diag: "entrata-timing",
          phase: "perProperty.loop_start",
          wallClockMs: Date.now(),
          resource_type: resourceType,
          connector_id: connector.id,
          propertyCount: pids.length,
          resumeFrom: startIdx,
        }),
      );
      let i = startIdx;
      let stopResource = false;
      for (; i < pids.length; i++) {
        if (Date.now() > syncDeadline) {
          partial = true;
          diag.timed_out = true;
          break;
        }
        {
          const pace = decideRatePacing({
            rl: diag.rateLimit,
            nowMs: Date.now(),
            deadlineMs: syncDeadline,
          });
          if (pace.action === "stop") {
            diag.rate_limited = true;
            diag.rate_paused = true;
            diag.rate_pause_bucket = pace.bucket;
            partial = true;
            break;
          }
          if (pace.action === "wait") {
            diag.rate_waits = (diag.rate_waits || 0) + 1;
            diag.rate_wait_ms = (diag.rate_wait_ms || 0) + pace.waitMs;
            await new Promise((res) => setTimeout(res, pace.waitMs));
            if (Date.now() > syncDeadline) {
              partial = true;
              diag.timed_out = true;
              break;
            }
          }
        }
        if (resumable) {
          liveConfig = withResourceCursor(liveConfig, resourceType, i + 1);
          await persistConnectorConfig({
            connector,
            config: liveConfig,
            bearer: writeBearer,
            pgFn,
          });
        }
        if (i > startIdx)
          await new Promise((res) => setTimeout(res, PER_PROPERTY_DELAY_MS));
        const pid = pids[i];
        console.log(
          JSON.stringify({
            diag: "entrata-timing",
            phase: "perProperty.start",
            wallClockMs: Date.now(),
            resource_type: resourceType,
            connector_id: connector.id,
            propertyId: pid,
            propertyIndex: i,
            propertyCount: pids.length,
          }),
        );
        let page_no = spec.paginated ? 1 : null;
        let hasMore = true;
        while (hasMore) {
          if (Date.now() > syncDeadline) {
            partial = true;
            diag.timed_out = true;
            break;
          }
          let out;
          try {
            out = await withSyncDeadline(syncDeadline, async () => {
              const res = await spec.call(callCtx, page_no, pid);
              return processOnePage(res, pid);
            });
          } catch (e) {
            if (e && e.syncDeadlineTimedOut) {
              partial = true;
              diag.timed_out = true;
              break;
            }
            throw e;
          }
          if (!out.ok) {
            diag.first_property_error = diag.first_property_error || {
              property_id: pid,
              error: out.error,
              status: out.status,
            };
            diag.property_errors = (diag.property_errors || 0) + 1;
            if ((diag.property_error_list || []).length < 25) {
              diag.property_error_list = (
                diag.property_error_list || []
              ).concat([
                {
                  property_id: pid,
                  status: out.status,
                  error: String(out.error || "").slice(0, 300),
                },
              ]);
            }
            partial = true;
            if (out.status === 429) {
              stopResource = true;
              diag.rate_limited = true;
              diag.rate_pause_bucket = "reactive_429";
            }
            break;
          }
          if (!spec.paginated) {
            hasMore = false;
            break;
          }
          if (!out.hasMore) {
            hasMore = false;
            break;
          }
          {
            const pace = decideRatePacing({
              rl: diag.rateLimit,
              nowMs: Date.now(),
              deadlineMs: syncDeadline,
            });
            if (pace.action === "stop") {
              stopResource = true;
              diag.rate_limited = true;
              diag.rate_paused = true;
              diag.rate_pause_bucket = pace.bucket;
              diag.rate_paused_mid_property = true;
              partial = true;
              break;
            }
            if (pace.action === "wait") {
              diag.rate_waits = (diag.rate_waits || 0) + 1;
              diag.rate_wait_ms = (diag.rate_wait_ms || 0) + pace.waitMs;
              await new Promise((res) => setTimeout(res, pace.waitMs));
              if (Date.now() > syncDeadline) {
                partial = true;
                diag.timed_out = true;
                break;
              }
            }
          }
          page_no += 1;
          if (page_no > 200) {
            partial = true;
            diag.capped = true;
            break;
          }
        }
        if (hasMore) {
          diag.properties_abandoned_mid_pagination =
            (diag.properties_abandoned_mid_pagination || 0) + 1;
          if (!stopResource) {
            diag.properties_skipped_by_deadline =
              (diag.properties_skipped_by_deadline || 0) + 1;
            if (!diag.sample_skipped_property) {
              diag.sample_skipped_property = {
                property_id: pid,
                stopped_after_page: page_no,
              };
            }
          }
        }
        if (!stopResource)
          diag.properties_done += Array.isArray(pid) ? pid.length : 1;
        console.log(
          JSON.stringify({
            diag: "entrata-timing",
            phase: "perProperty.done",
            wallClockMs: Date.now(),
            resource_type: resourceType,
            connector_id: connector.id,
            propertyId: pid,
            propertyComplete: !stopResource,
            pagesFetched: diag.pages,
            entriesRead: totalRead,
          }),
        );
        if (stopResource) {
          if (resumable) {
            liveConfig = withResourceCursor(liveConfig, resourceType, i);
            await persistConnectorConfig({
              connector,
              config: liveConfig,
              bearer: writeBearer,
              pgFn,
            });
          }
          break;
        }
      }

      if (resumable) {
        if (i >= pids.length && !partial) {
          liveConfig = withResourceCursor(liveConfig, resourceType, null);
          await persistConnectorConfig({
            connector,
            config: liveConfig,
            bearer: writeBearer,
            pgFn,
          });
          diag.cursor_completed = true;
        }
        connector.config = liveConfig;
      }
    } else {
      const resumable =
        CHUNK_RESUMABLE_RESOURCES.has(resourceType) && spec.paginated;
      let liveConfig = connector.config || {};
      let startPage = 1;
      if (resumable) {
        try {
          const cfgRes = await pgFn({
            bearer: writeBearer,
            path: `/connectors?id=eq.${encodeURIComponent(connector.id)}&select=config`,
          });
          if (
            cfgRes &&
            cfgRes.ok &&
            Array.isArray(cfgRes.body) &&
            cfgRes.body[0]?.config
          ) {
            liveConfig = cfgRes.body[0].config;
          }
        } catch {}
        const savedPage = readResourceCursorIndex(
          liveConfig,
          resourceType,
          null,
        );
        startPage = savedPage > 0 ? savedPage : 1;
        diag.resume_from_page = startPage;
      }
      let page_no = spec.paginated ? startPage : null;
      let keepGoing = true;
      while (keepGoing) {
        if (Date.now() > syncDeadline) {
          partial = true;
          diag.timed_out = true;
          break;
        }
        {
          const pace = decideRatePacing({
            rl: diag.rateLimit,
            nowMs: Date.now(),
            deadlineMs: syncDeadline,
          });
          if (pace.action === "stop") {
            diag.rate_limited = true;
            diag.rate_paused = true;
            diag.rate_pause_bucket = pace.bucket;
            partial = true;
            break;
          }
          if (pace.action === "wait") {
            diag.rate_waits = (diag.rate_waits || 0) + 1;
            diag.rate_wait_ms = (diag.rate_wait_ms || 0) + pace.waitMs;
            await new Promise((res) => setTimeout(res, pace.waitMs));
            if (Date.now() > syncDeadline) {
              partial = true;
              diag.timed_out = true;
              break;
            }
          }
        }
        if (resumable) {
          liveConfig = withResourceCursor(
            liveConfig,
            resourceType,
            page_no + 1,
          );
          await persistConnectorConfig({
            connector,
            config: liveConfig,
            bearer: writeBearer,
            pgFn,
          });
        }
        let out;
        try {
          out = await withSyncDeadline(syncDeadline, async () => {
            const res = spec.paginated
              ? await spec.call(callCtx, page_no)
              : await spec.call(callCtx);
            return processOnePage(res);
          });
        } catch (e) {
          if (e && e.syncDeadlineTimedOut) {
            partial = true;
            diag.timed_out = true;
            break;
          }
          throw e;
        }
        if (!out.ok) {
          if (resumable) connector.config = liveConfig;
          if (out.status === 429) {
            diag.rate_limited = true;
            if (resumable) {
              liveConfig = withResourceCursor(
                liveConfig,
                resourceType,
                page_no,
              );
              await persistConnectorConfig({
                connector,
                config: liveConfig,
                bearer: writeBearer,
                pgFn,
              });
              connector.config = liveConfig;
            }
            return {
              rowsRead: totalRead,
              rowsWritten: totalWritten,
              partial: true,
              payload: { diag },
            };
          }
          return {
            rowsRead: totalRead,
            rowsWritten: totalWritten,
            partial: true,
            error: out.error,
            payload: { diag },
          };
        }
        if (!spec.paginated) {
          keepGoing = false;
          break;
        }
        if (!out.hasMore) {
          keepGoing = false;
          break;
        }
        page_no += 1;
        if (page_no > 200) {
          partial = true;
          diag.capped = true;
          break;
        }
      }
      if (resumable) {
        if (!partial) {
          liveConfig = withResourceCursor(liveConfig, resourceType, null);
          await persistConnectorConfig({
            connector,
            config: liveConfig,
            bearer: writeBearer,
            pgFn,
          });
          diag.cursor_completed = true;
        }
        connector.config = liveConfig;
      }
    }

    await pgFn({
      bearer: writeBearer,
      path: `/org_entrata_accounts?id=eq.${ctx.accountId}`,
      method: "PATCH",
      body: {
        last_synced_at: new Date().toISOString(),
        last_error_code: null,
        last_error_message: null,
        last_error_at: null,
        ...(diag.rateLimit
          ? {
              rl_minute_remaining: diag.rateLimit.minute,
              rl_hour_remaining: diag.rateLimit.hour,
              rl_day_remaining: diag.rateLimit.day,
              rl_seen_at: new Date().toISOString(),
            }
          : {}),
      },
      prefer: "return=minimal",
    });

    const rateLimited =
      totalRead === 0 &&
      diag.first_property_error &&
      diag.first_property_error.status === 429;
    if (rateLimited) {
      diag.rate_limited = true;
      partial = true;
    }
    let escalatedError;
    if (
      !rateLimited &&
      totalRead === 0 &&
      diag.first_property_error &&
      diag.first_property_error.error
    ) {
      escalatedError = diag.first_property_error.error;
    }

    const partialError = escalatedError
      ? null
      : describePartialLoss(resourceType, diag);
    if (partialError) partial = true;

    return {
      rowsRead: totalRead,
      rowsWritten: totalWritten,
      partial,
      payload: { diag },
      ...(escalatedError ? { error: escalatedError } : {}),
      ...(partialError ? { partialError } : {}),
    };
  },
};

export const ADAPTERS = Object.freeze({
  [MOCK_ADAPTER.vendor]: MOCK_ADAPTER,
  [QUICKBOOKS_ADAPTER.vendor]: QUICKBOOKS_ADAPTER,
  [PLAID_ADAPTER.vendor]: PLAID_ADAPTER,
  [DROPBOX_ADAPTER.vendor]: DROPBOX_ADAPTER,
  [ENTRATA_ADAPTER.vendor]: ENTRATA_ADAPTER,
});

export function resolveAdapter(vendor) {
  return ADAPTERS[vendor] || null;
}

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SUPABASE_ANON =
  process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

const PG_DEFAULT_TIMEOUT_MS = 30_000;
const PG_HARD_TIMEOUT_BUFFER_MS = 5_000;

export async function pg({
  bearer,
  path,
  method = "GET",
  body = null,
  prefer = null,
  signal = null,
  timeoutMs = PG_DEFAULT_TIMEOUT_MS,
  hardTimeoutMs = timeoutMs + PG_HARD_TIMEOUT_BUFFER_MS,
}) {
  const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const apikey =
    bearer && bearer === SERVICE_ROLE_KEY ? SERVICE_ROLE_KEY : SUPABASE_ANON;
  const headers = {
    apikey,
    Authorization: `Bearer ${bearer}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
  if (prefer) headers.Prefer = prefer;
  let fetchSignal = signal;
  let abortTimer = null;
  if (!signal) {
    const internal = new AbortController();
    abortTimer = setTimeout(() => {
      try {
        internal.abort();
      } catch {}
    }, timeoutMs);
    fetchSignal = internal.signal;
  }
  let hardTimer;
  const hardTimeout = new Promise((resolve) => {
    hardTimer = setTimeout(() => {
      resolve({
        ok: false,
        status: 0,
        body: null,
        raw: `timeout: pg ${method} ${path} exceeded ${hardTimeoutMs}ms`,
      });
    }, hardTimeoutMs);
  });
  const attempt = (async () => {
    try {
      const res = await fetch(`${SUPABASE_URL}/rest/v1${path}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: fetchSignal,
      });
      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {}
      return { ok: res.ok, status: res.status, body: json, raw: text };
    } catch (e) {
      const isAbort =
        e?.name === "AbortError" || /abort/i.test(String(e?.message || ""));
      return {
        ok: false,
        status: 0,
        body: null,
        raw: isAbort
          ? `aborted: ${e?.message || "AbortError"}`
          : `fetch error: ${e?.message || String(e)}`,
      };
    }
  })();
  try {
    return await Promise.race([attempt, hardTimeout]);
  } finally {
    if (abortTimer) clearTimeout(abortTimer);
    clearTimeout(hardTimer);
  }
}

const CONNECTOR_LEASE_KEY = "sync_inflight_until";
const CONNECTOR_LEASE_TTL_MS = 16 * 60_000;

export async function claimConnectorLease({
  connector,
  bearer,
  pgImpl = null,
  nowMs = Date.now(),
  ttlMs = CONNECTOR_LEASE_TTL_MS,
}) {
  const pgFn = pgImpl || pg;
  const freshRes = await pgFn({
    bearer,
    path: `/connectors?id=eq.${encodeURIComponent(connector.id)}&select=config`,
  });
  const freshConfig =
    (freshRes.ok && Array.isArray(freshRes.body)
      ? freshRes.body[0]?.config
      : null) ||
    connector.config ||
    {};
  const existing = freshConfig[CONNECTOR_LEASE_KEY];
  if (existing && new Date(existing).getTime() > nowMs) {
    return { acquired: false, heldUntil: existing };
  }
  const until = new Date(nowMs + ttlMs).toISOString();
  const mergedConfig = { ...freshConfig, [CONNECTOR_LEASE_KEY]: until };
  const res = await pgFn({
    bearer,
    path: `/connectors?id=eq.${encodeURIComponent(connector.id)}`,
    method: "PATCH",
    body: { config: mergedConfig },
    prefer: "return=representation",
  });
  if (!res.ok) {
    console.error(
      "[connector-lease] claim PATCH failed",
      JSON.stringify({
        connector_id: connector.id,
        status: res.status,
        raw: (res.raw || "").slice(0, 200),
      }),
    );
    return { acquired: true, heldUntil: until };
  }
  const persisted = Array.isArray(res.body)
    ? res.body[0]?.config?.[CONNECTOR_LEASE_KEY]
    : null;
  if (persisted !== until) {
    console.error(
      "[connector-lease] claim did not persist",
      JSON.stringify({
        connector_id: connector.id,
        wanted: until,
        got: persisted,
      }),
    );
  }
  connector.config = mergedConfig;
  return { acquired: true, heldUntil: until };
}

export async function releaseConnectorLease({
  connector,
  bearer,
  pgImpl = null,
  heldUntil = null,
}) {
  const pgFn = pgImpl || pg;
  const freshRes = await pgFn({
    bearer,
    path: `/connectors?id=eq.${encodeURIComponent(connector.id)}&select=config`,
  });
  const freshConfig =
    (freshRes.ok && Array.isArray(freshRes.body)
      ? freshRes.body[0]?.config
      : null) ||
    connector.config ||
    {};
  const current = freshConfig[CONNECTOR_LEASE_KEY];
  if (!current) return;
  if (heldUntil && current !== heldUntil) return;
  const mergedConfig = { ...freshConfig };
  delete mergedConfig[CONNECTOR_LEASE_KEY];
  const res = await pgFn({
    bearer,
    path: `/connectors?id=eq.${encodeURIComponent(connector.id)}`,
    method: "PATCH",
    body: { config: mergedConfig },
  });
  if (!res.ok) {
    console.error(
      "[connector-lease] release PATCH failed",
      JSON.stringify({
        connector_id: connector.id,
        status: res.status,
        raw: (res.raw || "").slice(0, 200),
      }),
    );
  }
  if (connector.config) delete connector.config[CONNECTOR_LEASE_KEY];
}

export const BENIGN_STOP_DIAG_KEYS = [
  "timed_out",
  "preloop_timed_out",
  "function_budget_cut",
  "rate_limited",
  "rate_paused",
];

export async function syncOneResource({
  bearer,
  connector,
  adapter,
  resourceType,
  triggeredBy,
  functionDeadline = null,
}) {
  const insRes = await pg({
    bearer,
    path: "/connector_sync_runs",
    method: "POST",
    body: {
      connector_id: connector.id,
      org_id: connector.org_id,
      direction: "in",
      resource_type: resourceType,
      status: "running",
      triggered_by: triggeredBy,
      payload: {},
    },
    prefer: "return=representation",
  });
  const runRow = Array.isArray(insRes.body) ? insRes.body[0] : insRes.body;
  const runId = runRow?.id;

  let rowsRead = 0,
    rowsWritten = 0,
    status = "error",
    errorMessage = null,
    payload = {};
  let budgetCut = false;
  try {
    const work = Promise.resolve(
      adapter.sync({
        connector,
        resourceType,
        bearer,
        pgImpl: pg,
        functionDeadline,
        triggeredBy,
        runId,
      }),
    );
    work.catch(() => {});
    const out =
      functionDeadline != null
        ? await withSyncDeadline(
            functionDeadline -
              runRowCloseReserveMs(functionDeadline - Date.now()),
            () => work,
          )
        : await work;
    rowsRead = out?.rowsRead || 0;
    rowsWritten = out?.rowsWritten || 0;
    payload = out?.payload || {};
    status = out?.error ? "error" : out?.partial ? "partial" : "success";
    errorMessage = out?.error || out?.partialError || null;
    if (payload?.diag?.preloop_timed_out && payload?.diag?.clock_exhausted)
      budgetCut = true;
  } catch (err) {
    if (err && err.syncDeadlineTimedOut) {
      budgetCut = true;
      status = "partial";
      errorMessage = null;
      payload = {
        diag: {
          resource: resourceType,
          function_budget_cut: true,
          rows_read_unknown: true,
          cursor_preserved: true,
        },
      };
    } else {
      errorMessage = err?.message || String(err);
    }
  }

  if (runId) {
    await pg({
      bearer,
      path: `/connector_sync_runs?id=eq.${encodeURIComponent(runId)}`,
      method: "PATCH",
      body: {
        completed_at: new Date().toISOString(),
        rows_read: rowsRead,
        rows_written: rowsWritten,
        status,
        error_message: errorMessage,
        payload,
      },
    });
  }

  const namedBenign = BENIGN_STOP_DIAG_KEYS.some((k) => !!payload?.diag?.[k]);
  const unrecoveredPropertyError = !!payload?.diag?.first_property_error;
  const benignStop =
    budgetCut === true || (namedBenign && !unrecoveredPropertyError);

  return {
    resourceType,
    runId,
    rowsRead,
    rowsWritten,
    status,
    errorMessage,
    budgetCut,
    benignStop,
  };
}

export const CONNECTOR_VENDOR_TEMPLATES = Object.freeze({
  mock: null,

  quickbooks: {
    name: "Intuit QuickBooks Online",
    website: "https://security.intuit.com",
    category: "Accounting / Financial Data",
    services_provided:
      "QuickBooks Online API — pulls chart of accounts, vendors, journal entries for corporate P&L and GL reconciliation.",
    criticality: "high",
    data_classification: "confidential",
    data_shared_description:
      "Read-only OAuth 2.0 access to the firm's QuickBooks realm. Chart of accounts, journal entries, vendor records. No write access to the customer's QB data. Tokens encrypted at rest via pgcrypto.",
    is_subprocessor: true,
    soc2_report_available: true,
    soc2_report_url:
      "https://security.intuit.com/index.php/trust-and-assurance",
    certifications: ["SOC 2 Type II", "ISO 27001", "PCI DSS", "GDPR"],
    security_contact_email: "security@intuit.com",
    notes:
      "OAuth 2.0 via Intuit developer portal. Refresh tokens rotated per-call. Revocation path lives in Integrations → QuickBooks → Disconnect.",
  },

  plaid: {
    name: "Plaid",
    website: "https://plaid.com/security/",
    category: "Financial Data Aggregation",
    services_provided:
      "Plaid Link + API — connects firm bank accounts to pull balances + transactions for cash-flow visibility and bank reconciliation.",
    criticality: "critical",
    data_classification: "restricted",
    data_shared_description:
      "Bank account balances, transactions, routing + account numbers (encrypted + tokenized). Plaid holds the bank credentials; we only store Plaid item + access tokens. Tokens encrypted at rest via pgcrypto.",
    is_subprocessor: true,
    soc2_report_available: true,
    soc2_report_url: "https://plaid.com/security/",
    certifications: ["SOC 2 Type II", "ISO 27001", "ISO 27701", "GDPR", "CCPA"],
    security_contact_email: "security@plaid.com",
    notes:
      "Plaid Link SDK in browser handles credential capture; we never see bank credentials directly. Per-institution health monitoring via webhooks. Required Plaid products minimized to transactions + auth.",
  },

  dropbox: {
    name: "Dropbox",
    website: "https://www.dropbox.com/security",
    category: "File Storage / Document Management",
    services_provided:
      "Dropbox API — read-only access to the firm's Dropbox workspace for underwriting models, deal documents, LP subscriptions. Watcher for new/changed files.",
    criticality: "high",
    data_classification: "restricted",
    data_shared_description:
      "Full-tree read of the firm's Dropbox workspace including confidential deal documents (term sheets, appraisals, underwriting models, LP subscription agreements). Path-root header scoping to team-space only.",
    is_subprocessor: true,
    soc2_report_available: true,
    soc2_report_url: "https://www.dropbox.com/security",
    certifications: [
      "SOC 2 Type II",
      "ISO 27001",
      "ISO 27017",
      "ISO 27018",
      "HIPAA",
      "GDPR",
    ],
    security_contact_email: "security@dropbox.com",
    notes:
      "OAuth 2.0 via Dropbox App Console (files.metadata.read + files.content.read scopes only). Team-space namespace-root header required on every file API call. Refresh tokens stored encrypted.",
  },

  entrata: {
    name: "Entrata",
    website: "https://www.entrata.com/security",
    category: "Property Management / PMS",
    services_provided:
      "Entrata Web API — pulls customer/resident, unit, lease, AR, GL, and work-order data for portfolio operations and LP reporting.",
    criticality: "high",
    data_classification: "restricted",
    data_shared_description:
      "Tenant PII (name, contact, SSN-last-4, lease terms, payment history), unit occupancy, GL journal entries, work orders. Scoped per-property.",
    is_subprocessor: true,
    soc2_report_available: true,
    soc2_report_url: "https://www.entrata.com/security",
    certifications: ["SOC 2 Type II", "PCI DSS"],
    security_contact_email: "security@entrata.com",
    notes:
      "Per-property credentials via Entrata dev portal. Rate-limited + throttled in adapter. Error 310 observed on unit endpoint; mitigated with retry + per-property singular propertyId format.",
  },
});

export async function ensureConnectorVendor({ bearer, orgId, vendorSlug }) {
  if (!orgId || !vendorSlug)
    return { skipped: true, reason: "missing orgId or vendorSlug" };
  const template = CONNECTOR_VENDOR_TEMPLATES[vendorSlug];
  if (!template)
    return { skipped: true, reason: `no template for vendor "${vendorSlug}"` };

  const existing = await pg({
    bearer,
    path: `/security_vendors?org_id=eq.${encodeURIComponent(orgId)}&name=eq.${encodeURIComponent(template.name)}&select=id`,
    method: "GET",
  });
  if (Array.isArray(existing?.body) && existing.body.length > 0) {
    return {
      skipped: true,
      reason: "already registered",
      vendorId: existing.body[0].id,
    };
  }

  const today = new Date();
  const inOneYear = new Date();
  inOneYear.setDate(today.getDate() + 365);
  const fmt = (d) => d.toISOString().slice(0, 10);

  await pg({
    bearer,
    path: `/security_vendors`,
    method: "POST",
    body: {
      org_id: orgId,
      name: template.name,
      website: template.website,
      category: template.category,
      services_provided: template.services_provided,
      criticality: template.criticality,
      data_classification: template.data_classification,
      data_shared_description: template.data_shared_description,
      is_subprocessor: template.is_subprocessor,
      soc2_report_available: template.soc2_report_available,
      soc2_report_url: template.soc2_report_url,
      certifications: template.certifications,
      status: "active",
      onboarded_at: fmt(today),
      security_contact_email: template.security_contact_email,
      notes:
        `Auto-seeded on first ${vendorSlug} activation. ${template.notes || ""}`.trim(),
    },
    prefer: "return=minimal",
  });

  return { skipped: false, vendorSlug, orgName: template.name };
}
