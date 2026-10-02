import { getCurrentAccessToken } from "./supabaseClient.js";

const PLAID_LINK_JS = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";

let plaidSdkLoading = null;

function loadPlaidSdk() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Plaid Link can only run in the browser"));
  }
  if (window.Plaid && typeof window.Plaid.create === "function") {
    return Promise.resolve(window.Plaid);
  }
  if (plaidSdkLoading) return plaidSdkLoading;

  plaidSdkLoading = new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[src="${PLAID_LINK_JS}"]`);
    const onLoad = () => {
      if (window.Plaid && typeof window.Plaid.create === "function") {
        resolve(window.Plaid);
      } else {
        reject(new Error("Plaid Link SDK loaded but window.Plaid is missing"));
      }
    };
    if (existing) {
      existing.addEventListener("load", onLoad, { once: true });
      existing.addEventListener(
        "error",
        () => reject(new Error("Plaid Link SDK failed to load")),
        { once: true },
      );
      return;
    }
    const s = document.createElement("script");
    s.src = PLAID_LINK_JS;
    s.async = true;
    s.addEventListener("load", onLoad, { once: true });
    s.addEventListener(
      "error",
      () => reject(new Error("Plaid Link SDK failed to load")),
      { once: true },
    );
    document.head.appendChild(s);
  });
  return plaidSdkLoading;
}

export async function initiatePlaidConnect() {
  try {
    const supaJwt = await getCurrentAccessToken();
    if (!supaJwt)
      return { error: "Sign in to the platform before connecting a bank." };

    const tokenRes = await fetch("/.netlify/functions/plaid-link-token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${supaJwt}`,
      },
    });
    const tokenData = await tokenRes.json().catch(() => ({}));
    if (!tokenRes.ok) {
      return {
        error:
          tokenData?.error || `Plaid link-token failed (${tokenRes.status})`,
        detail: tokenData?.detail,
      };
    }
    const linkToken = tokenData.link_token;
    if (!linkToken) return { error: "Plaid did not return a link_token" };

    const Plaid = await loadPlaidSdk();

    return await new Promise((resolve) => {
      const handler = Plaid.create({
        token: linkToken,
        onSuccess: async (publicToken, metadata) => {
          try {
            const exchangeRes = await fetch(
              "/.netlify/functions/plaid-exchange",
              {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  Authorization: `Bearer ${supaJwt}`,
                },
                body: JSON.stringify({
                  public_token: publicToken,
                  institution: metadata?.institution || null,
                  accounts: metadata?.accounts || [],
                }),
              },
            );
            const data = await exchangeRes.json().catch(() => ({}));
            if (!exchangeRes.ok) {
              resolve({
                error:
                  data?.error ||
                  `Plaid exchange failed (${exchangeRes.status})`,
                detail: data?.detail,
              });
            } else {
              resolve({
                success: true,
                institution_name: data.institution_name,
                item_id: data.item_id,
                accounts_count: data.accounts_count,
              });
            }
          } catch (err) {
            resolve({ error: err?.message || "Plaid exchange threw" });
          }
        },
        onExit: (err) => {
          if (err) {
            console.warn("[plaid] Link onExit with error:", err);
            resolve({
              error:
                err.display_message ||
                err.error_message ||
                err.error_code ||
                "Plaid Link exited with error",
            });
          } else {
            resolve({ cancelled: true });
          }
        },
      });
      handler.open();
    });
  } catch (err) {
    console.error("[plaid] initiateConnect threw:", err);
    return { error: err?.message || "Plaid connect failed" };
  }
}
