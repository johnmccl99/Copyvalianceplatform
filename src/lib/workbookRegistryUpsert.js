export function chooseRegistryRowToReuse(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let best = null;
  let bestMs = null;
  for (const row of rows) {
    if (!row || typeof row !== "object" || !row.id) continue;
    if (row.superseded_at) continue;
    const ms = row.created_at ? new Date(row.created_at).getTime() : NaN;
    const sortable = Number.isFinite(ms) ? ms : -Infinity;
    if (best === null || sortable > bestMs) {
      best = row;
      bestMs = sortable;
    }
  }
  return best;
}

export function isFetchableEnvelope(envelope) {
  if (!envelope || typeof envelope !== "object") return false;
  if (envelope.provider === "sharepoint") {
    return Boolean(envelope.driveId) && Boolean(envelope.itemId);
  }
  if (envelope.provider === "dropbox") {
    return Boolean(envelope.path || envelope.path_lower || envelope.id);
  }
  return false;
}

export function carryForwardFetchEnvelope(donorEnvelope, localLoad) {
  if (!isFetchableEnvelope(donorEnvelope)) return null;
  const {
    local_load: _drop,
    source: _dropSource,
    ...fetchKeys
  } = donorEnvelope;
  return {
    ...fetchKeys,
    local_load: {
      loaded_by: localLoad?.loadedBy || null,
      path: localLoad?.path || null,
      at: localLoad?.at || new Date().toISOString(),
    },
  };
}

export function chooseFetchEnvelopeDonor(rows) {
  if (!Array.isArray(rows)) return null;
  const ms = (row) => {
    const t = row?.created_at ? new Date(row.created_at).getTime() : NaN;
    return Number.isFinite(t) ? t : -Infinity;
  };
  const fetchable = rows.filter(
    (r) => r && isFetchableEnvelope(r.source_envelope),
  );
  if (fetchable.length === 0) return null;
  const parsed = fetchable.filter((r) => r.last_parse_status === "success");
  const pool = parsed.length > 0 ? parsed : fetchable;
  return pool.reduce(
    (best, row) => (best === null || ms(row) > ms(best) ? row : best),
    null,
  );
}

export function registrationFields(
  envelope,
  { displayName, sourceType, sourceUrl, sourcePath },
) {
  return {
    source_type: sourceType,
    source_url: sourceUrl,
    source_path: sourcePath,
    source_envelope: envelope,
    display_name: displayName,
    last_parse_status: "queued",
    last_parse_error: null,
    last_parse_run_id: null,
    last_parsed_at: null,
  };
}
