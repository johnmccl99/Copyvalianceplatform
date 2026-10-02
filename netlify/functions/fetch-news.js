import { applySecurity, jsonResponse } from "./_security.js";

import { createHash } from "crypto";

const MAX_FEEDS_PER_RUN = 20;
const MAX_ITEMS_PER_FEED = 25;
const FETCH_TIMEOUT_MS = 8000;

function parseFeedXml(xml) {
  const items = [];
  const re = /<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi;
  let m;
  while ((m = re.exec(xml)) !== null && items.length < MAX_ITEMS_PER_FEED) {
    const block = m[2];
    const title = extractText(block, "title");
    const link = extractLink(block);
    const summary =
      extractText(block, "description") ||
      extractText(block, "summary") ||
      extractText(block, "content:encoded") ||
      extractText(block, "content");
    const pubDate =
      extractText(block, "pubDate") ||
      extractText(block, "published") ||
      extractText(block, "updated");
    const author =
      extractText(block, "dc:creator") ||
      extractText(block, "author") ||
      extractText(block, "creator");
    const image = extractImage(block);
    if (title && link) {
      items.push({ title, link, summary, pubDate, author, image });
    }
  }
  return items;
}

function extractText(block, tag) {
  const esc = tag.replace(/:/g, "\\:");
  const re = new RegExp(`<${esc}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${esc}>`, "i");
  const hit = block.match(re);
  if (!hit) return null;
  return decodeEntities(stripCdata(hit[1])).trim();
}

function extractLink(block) {
  const atomLink = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (atomLink) return atomLink[1];
  return extractText(block, "link");
}

function extractImage(block) {
  const enc = block.match(
    /<(?:enclosure|media:content|media:thumbnail)\b[^>]*url=["']([^"']+)["']/i,
  );
  if (enc) return enc[1];
  const img = block.match(/<image>[\s\S]*?<url>([\s\S]*?)<\/url>/i);
  if (img) return img[1].trim();
  return null;
}

function stripCdata(s) {
  return String(s || "").replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, "$1");
}

function decodeEntities(s) {
  if (!s) return s;
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#8216;/g, "\u2018")
    .replace(/&#8217;/g, "\u2019")
    .replace(/&#8220;/g, "\u201c")
    .replace(/&#8221;/g, "\u201d")
    .replace(/&#8211;/g, "\u2013")
    .replace(/&#8212;/g, "\u2014")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(parseInt(n, 10)));
}

function htmlToPlainSummary(html, maxLen = 400) {
  if (!html) return null;
  const stripped = String(html)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return stripped.length > maxLen
    ? stripped.slice(0, maxLen) + "\u2026"
    : stripped;
}

function sha256(s) {
  return createHash("sha256").update(String(s)).digest("hex");
}

async function fetchWithTimeout(url, ms, headers) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent":
          "Valiance-CRE-Dashboard/1.0 (+https://credashboardproperty.netlify.app)",
        Accept:
          "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
        ...(headers || {}),
      },
      signal: controller.signal,
    });
    const text = await res.text();
    return { ok: res.ok, status: res.status, text };
  } finally {
    clearTimeout(timer);
  }
}

async function supaGet(path) {
  const url = `${process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL}/rest/v1/${path}`;
  const res = await fetch(url, {
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/json",
    },
  });
  if (!res.ok) throw new Error(`supaGet ${path} ${res.status}`);
  return res.json();
}

async function supaRpc(fn, args, { schema = "public" } = {}) {
  const url = `${process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL}/rest/v1/rpc/${fn}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      "Content-Profile": schema,
    },
    body: JSON.stringify(args || {}),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`supaRpc ${schema}.${fn} ${res.status}: ${errText}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : res.text();
}

async function supaUpsert(table, rows, onConflict) {
  if (!rows || rows.length === 0) return { inserted: 0 };
  const url = `${process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL}/rest/v1/${table}?on_conflict=${encodeURIComponent(onConflict)}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "resolution=ignore-duplicates,return=representation",
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`supaUpsert ${table} ${res.status}: ${errText}`);
  }
  const data = await res.json();
  return { inserted: Array.isArray(data) ? data.length : 0 };
}

async function supaPatch(table, matchQuery, body) {
  const url = `${process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL}/rest/v1/${table}?${matchQuery}`;
  const res = await fetch(url, {
    method: "PATCH",
    headers: {
      apikey: process.env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify(body),
  });
  return res.ok;
}

const REFRESH_ROLES = new Set(["admin", "gp", "gp_admin", "gp-admin"]);

export function callerMayRefresh(profile) {
  if (!profile) return false;
  if (
    profile.is_admin === true ||
    profile.is_admin === "t" ||
    profile.is_admin === "true" ||
    profile.is_admin === 1
  ) {
    return true;
  }
  return REFRESH_ROLES.has(
    String(profile.role || "")
      .trim()
      .toLowerCase(),
  );
}

async function resolveCallerProfile(userJwt, callerAuthId) {
  const baseUrl = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const anonKey =
    process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const useUserJwt = Boolean(anonKey && userJwt);
  const path = `user_profiles?auth_id=eq.${encodeURIComponent(callerAuthId)}&select=id,role,is_admin&limit=1`;
  try {
    const res = await fetch(`${baseUrl}/rest/v1/${path}`, {
      headers: {
        apikey: useUserJwt ? anonKey : serviceKey,
        Authorization: `Bearer ${useUserJwt ? userJwt : serviceKey}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      console.warn(`[fetch-news] profile lookup returned ${res.status}`);
      return null;
    }
    const rows = await res.json();
    return Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
  } catch (e) {
    console.warn("[fetch-news] profile lookup failed:", e.message);
    return null;
  }
}

export const handler = async (event) => {
  const scheduledSecret = process.env.SCHEDULED_INVOCATION_SECRET || "";
  const providedSecret =
    (event.headers && event.headers["x-scheduled-invocation"]) || "";
  const isScheduled =
    scheduledSecret.length > 0 && providedSecret === scheduledSecret;

  if (!isScheduled) {
    const gate = await applySecurity(event, {
      methods: ["POST", "GET"],
      requireAuth: true,
      rateLimit: { maxPerMinute: 6 },
    });
    if (gate.error) return gate.error;

    const authHeader =
      event.headers?.authorization || event.headers?.Authorization || "";
    const userJwt = authHeader.replace(/^Bearer\s+/i, "");
    const callerAuthId = gate.user?.id;
    if (!callerAuthId)
      return jsonResponse(401, { error: "Authentication required" });

    const profile = await resolveCallerProfile(userJwt, callerAuthId);
    if (!callerMayRefresh(profile)) {
      console.warn("[fetch-news] refresh denied for", callerAuthId);
      return jsonResponse(403, { error: "Not authorized to refresh news" });
    }
  }

  if (!process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error("[fetch-news] SUPABASE_SERVICE_ROLE_KEY missing");
    return jsonResponse(500, { error: "Server not configured" });
  }

  try {
    const feeds = await supaGet(
      `news_feeds?is_enabled=eq.true&select=id,name,url,category,source_label,auth_token_encrypted&limit=${MAX_FEEDS_PER_RUN}`,
    );
    const results = [];
    let totalInserted = 0;

    for (const feed of feeds) {
      const feedResult = {
        id: feed.id,
        name: feed.name,
        status: "ok",
        count: 0,
        error: null,
      };
      try {
        let plainToken = null;
        if (feed.auth_token_encrypted) {
          try {
            plainToken = await supaRpc(
              "decrypt_pii_service",
              { ciphertext: feed.auth_token_encrypted },
              { schema: "app_private" },
            );
          } catch (e) {
            feedResult.status = "error";
            feedResult.error = `decrypt failed: ${String(e.message || e).slice(0, 120)}`;
            results.push(feedResult);
            continue;
          }
        }
        const headers = plainToken
          ? { Authorization: `Bearer ${plainToken}` }
          : {};
        const { ok, status, text } = await fetchWithTimeout(
          feed.url,
          FETCH_TIMEOUT_MS,
          headers,
        );
        if (!ok) {
          feedResult.status = "error";
          feedResult.error = `HTTP ${status}`;
        } else {
          const parsed = parseFeedXml(text);
          if (parsed.length === 0) {
            feedResult.status = "error";
            feedResult.error = "no items parsed";
          } else {
            const rows = parsed.map((p) => {
              const published_at = parseDate(p.pubDate);
              const content_hash = sha256(`${feed.id}|${p.link}`);
              return {
                feed_id: feed.id,
                title: String(p.title).slice(0, 500),
                link: String(p.link).slice(0, 2000),
                summary: htmlToPlainSummary(p.summary, 600),
                author: p.author ? String(p.author).slice(0, 200) : null,
                published_at,
                image_url: p.image ? String(p.image).slice(0, 2000) : null,
                category: feed.category,
                source_label: feed.source_label || feed.name,
                content_hash,
              };
            });
            const { inserted } = await supaUpsert(
              "news_items",
              rows,
              "feed_id,content_hash",
            );
            feedResult.count = inserted;
            totalInserted += inserted;
          }
        }
      } catch (err) {
        feedResult.status = err.name === "AbortError" ? "timeout" : "error";
        feedResult.error = err.message?.slice(0, 400) || "unknown";
      }
      await supaPatch("news_feeds", `id=eq.${feed.id}`, {
        last_fetched_at: new Date().toISOString(),
        last_fetch_status: feedResult.status,
        last_fetch_error: feedResult.error,
        last_item_count: feedResult.count,
      });
      results.push(feedResult);
    }

    const feedsFailed = results.filter((r) => r.status !== "ok").length;
    const allFailed = feeds.length > 0 && feedsFailed === feeds.length;
    const payload = {
      ok: !allFailed,
      feeds_processed: feeds.length,
      feeds_failed: feedsFailed,
      total_new_items: totalInserted,
      results,
    };
    if (allFailed) {
      console.error(`[fetch-news] all ${feeds.length} feeds failed`);
      return jsonResponse(502, {
        error: `All ${feeds.length} news sources failed to refresh`,
        ...payload,
      });
    }
    return jsonResponse(200, payload);
  } catch (err) {
    console.error("[fetch-news] unexpected error:", err);
    return jsonResponse(500, { error: "Failed to refresh news" });
  }
};

function parseDate(s) {
  if (!s) return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}
