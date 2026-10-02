import { supabase, getCurrentAccessToken } from "./supabaseClient.js";
import { pickVersionAtMonth } from "./rentRollVersions.js";

const VERSION_COLUMNS =
  "id, org_id, property_id, label, as_of, status, line_count, content_signature, " +
  "summary, signed_off_by, signed_off_at, locked_by, locked_at, " +
  "created_at, created_by, updated_at, updated_by";

const VERSION_LINE_COLUMNS =
  "id, version_id, org_id, property_id, row_index, source, lease_id, adjustment_id, " +
  "unit_id, unit_number, status, effective_status, occupied, adjusted, " +
  "lease_start, lease_end, move_in, move_out, rent, effective_rent, deposit, " +
  "tenant_id, tenant_name, tenant_email, is_mtm, managed_by, " +
  "group_name, group_adjustment_id, master_tenant_name, adjustments, charges, last_seen_at";

async function resolvePropertyEntrata(propertyId) {
  const { data, error } = await supabase
    .from("properties")
    .select("id, org_id, entrata_property_id")
    .eq("id", propertyId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

export async function captureRentRollVersion(propertyId, opts = {}) {
  if (!propertyId)
    return {
      data: null,
      error: { message: "captureRentRollVersion: propertyId required" },
    };
  const label = typeof opts.label === "string" ? opts.label.trim() : "";
  if (!label)
    return {
      data: null,
      error: { message: "A label (name for the version) is required." },
    };

  const token = await getCurrentAccessToken();
  if (!token) return { data: null, error: { message: "Not authenticated" } };

  let res;
  try {
    res = await fetch("/.netlify/functions/rent-roll-version-capture", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        property_id: propertyId,
        label,
        status: opts.status || "draft",
        signed_off_by: opts.signedOffBy ?? null,
        make_current: opts.makeCurrent === true,
      }),
    });
  } catch (e) {
    return {
      data: null,
      error: {
        message: e?.message || "Network error reaching the version service",
      },
    };
  }

  let body = {};
  try {
    body = await res.json();
  } catch {}
  if (!res.ok) {
    return {
      data: null,
      error: { message: body?.error || `Request failed (HTTP ${res.status})` },
    };
  }
  return { data: body, error: null };
}

export async function fetchRentRollVersions(propertyId) {
  if (!propertyId) return [];
  const prop = await resolvePropertyEntrata(propertyId);
  if (!prop || !prop.entrata_property_id) return [];
  const { data, error } = await supabase
    .from("rent_roll_versions")
    .select(VERSION_COLUMNS)
    .eq("property_id", prop.entrata_property_id)
    .order("as_of", { ascending: false });
  if (error) {
    console.error("fetchRentRollVersions error:", error);
    throw error;
  }
  return data || [];
}

export async function fetchRentRollVersionLines(versionId) {
  if (!versionId) return [];
  const { data, error } = await supabase
    .from("rent_roll_version_line")
    .select(VERSION_LINE_COLUMNS)
    .eq("version_id", versionId)
    .order("row_index", { ascending: true });
  if (error) {
    console.error("fetchRentRollVersionLines error:", error);
    throw error;
  }
  return data || [];
}

export async function fetchCurrentRentRollVersion(propertyId) {
  if (!propertyId) return null;
  const prop = await resolvePropertyEntrata(propertyId);
  if (!prop || !prop.entrata_property_id) return null;
  const { data: ptr, error: ptrErr } = await supabase
    .from("rent_roll_version_current")
    .select("version_id")
    .eq("property_id", prop.entrata_property_id)
    .maybeSingle();
  if (ptrErr) {
    console.error("fetchCurrentRentRollVersion pointer error:", ptrErr);
    throw ptrErr;
  }
  if (!ptr || !ptr.version_id) return null;
  const { data, error } = await supabase
    .from("rent_roll_versions")
    .select(VERSION_COLUMNS)
    .eq("id", ptr.version_id)
    .maybeSingle();
  if (error) {
    console.error("fetchCurrentRentRollVersion header error:", error);
    throw error;
  }
  return data || null;
}

export async function fetchRentRollAtMonth(propertyId, targetMonth) {
  if (!propertyId || !targetMonth) return null;
  const versions = await fetchRentRollVersions(propertyId);
  return pickVersionAtMonth(versions, targetMonth);
}

export async function signRentRollVersion(id, signedOffBy) {
  if (!id) throw new Error("signRentRollVersion: id required");
  const patch = { status: "signed" };
  if (signedOffBy != null && signedOffBy !== "")
    patch.signed_off_by = String(signedOffBy);
  const { data, error } = await supabase
    .from("rent_roll_versions")
    .update(patch)
    .eq("id", id)
    .select(VERSION_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new Error(
      "No version was updated — you may not have permission to sign off on this roll.",
    );
  return data;
}

export async function lockRentRollVersion(id) {
  if (!id) throw new Error("lockRentRollVersion: id required");
  const { data, error } = await supabase
    .from("rent_roll_versions")
    .update({ status: "locked" })
    .eq("id", id)
    .select(VERSION_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new Error(
      "No version was locked — you may not have permission, or the version is already locked.",
    );
  return data;
}

export async function setCurrentRentRollVersion(propertyId, versionId) {
  if (!propertyId)
    throw new Error("setCurrentRentRollVersion: propertyId required");
  if (!versionId)
    throw new Error("setCurrentRentRollVersion: versionId required");
  const prop = await resolvePropertyEntrata(propertyId);
  if (!prop?.org_id)
    throw new Error(
      "setCurrentRentRollVersion: property org_id not resolvable",
    );
  if (!prop?.entrata_property_id)
    throw new Error(
      "setCurrentRentRollVersion: property is not mapped to Entrata",
    );
  const { data, error } = await supabase
    .from("rent_roll_version_current")
    .upsert(
      {
        org_id: prop.org_id,
        property_id: prop.entrata_property_id,
        version_id: versionId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "org_id,property_id" },
    )
    .select("org_id, property_id, version_id, updated_at")
    .maybeSingle();
  if (error) throw error;
  if (!data)
    throw new Error(
      "Could not set the current version — you may not have permission.",
    );
  return data;
}
