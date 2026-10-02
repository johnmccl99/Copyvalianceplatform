import { supabase, ORG_ID } from "./supabaseClient.js";
import {
  uploadFileToDrive,
  isAuthenticated as msIsAuthenticated,
} from "./microsoftGraphClient.js";

export function safeHttpUrl(raw) {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    return u.href;
  } catch (e) {
    return null;
  }
}

export const SOURCE_TYPES = Object.freeze({
  SUPABASE_STORAGE: "supabase_storage",
  MICROSOFT_GRAPH: "microsoft_graph",
  DROPBOX: "dropbox",
  BOX: "box",
  GDRIVE: "gdrive",
  EXTERNAL_URL: "external_url",
});

const IMPLEMENTED_SOURCES = new Set([
  SOURCE_TYPES.SUPABASE_STORAGE,
  SOURCE_TYPES.MICROSOFT_GRAPH,
]);

const SUPABASE_BUCKET = "documents";

const sourceAdapters = {
  [SOURCE_TYPES.SUPABASE_STORAGE]: {
    requiresAuth: () => false,
    async upload(file, opts) {
      const timestamp = Date.now();
      const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      const storagePath = `${timestamp}_${safeName}`;

      const { error: upErr } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .upload(storagePath, file, {
          cacheControl: "3600",
          upsert: false,
          contentType: file.type || undefined,
        });

      if (upErr) return { error: upErr };
      return {
        source_ref: storagePath,
        external_url: null,
      };
    },
    async getDownloadUrl(documentRow, { expiresInSec = 3600 } = {}) {
      const path = documentRow.source_ref || documentRow.storage_path;
      if (!path)
        return {
          error: { message: "documents row has no source_ref/storage_path" },
        };
      const { data, error } = await supabase.storage
        .from(SUPABASE_BUCKET)
        .createSignedUrl(path, expiresInSec);
      if (error) return { error };
      const safe = safeHttpUrl(data?.signedUrl);
      if (!safe) return { error: { message: "Signed URL is malformed" } };
      return { url: safe };
    },
  },

  [SOURCE_TYPES.MICROSOFT_GRAPH]: {
    requiresAuth: () => !msIsAuthenticated(),
    async upload(file, opts) {
      const folderId = opts?.folderId || "root";
      const result = await uploadFileToDrive(file.name, file, folderId);
      if (result?.error) return { error: result.error };
      return {
        source_ref: result?.id || null,
        external_url: result?.webUrl || null,
      };
    },
    async getDownloadUrl(documentRow, opts) {
      const safe = safeHttpUrl(documentRow.external_url);
      if (safe) return { url: safe };
      if (documentRow.external_url) {
        return {
          error: {
            message: "Document link is not a safe HTTPS URL. Contact an admin.",
          },
        };
      }
      return {
        error: {
          message:
            "Microsoft Graph document has no external_url. Re-upload the file.",
        },
      };
    },
  },
};

export function isSourceImplemented(sourceType) {
  return IMPLEMENTED_SOURCES.has(sourceType);
}

export function sourceRequiresAuth(sourceType) {
  const adapter = sourceAdapters[sourceType];
  return adapter?.requiresAuth?.() || false;
}

export async function uploadDocument(file, opts = {}) {
  const source = opts.source || SOURCE_TYPES.SUPABASE_STORAGE;
  const adapter = sourceAdapters[source];
  if (!adapter) {
    return { document: null, error: { message: `Unknown source: ${source}` } };
  }
  if (!IMPLEMENTED_SOURCES.has(source)) {
    return {
      document: null,
      error: { message: `Source not yet implemented: ${source}` },
    };
  }
  if (!file || !file.name) {
    return { document: null, error: { message: "No file provided" } };
  }

  const upResult = await adapter.upload(file, opts);
  if (upResult.error) return { document: null, error: upResult.error };

  const row = {
    org_id: ORG_ID,
    file_name: file.name,
    file_type: file.type || file.name.split(".").pop()?.toLowerCase() || null,
    category: opts.category || "other",
    subcategory: opts.subcategory || opts.suggestedSubcategory || null,
    fund_id: opts.fundId || null,
    property_id: opts.propertyId || null,
    folder_id: opts.folderId || null,
    status: opts.status || "final",
    access_level: opts.accessLevel || "gp_only",
    version: 1,
    source_type: source,
    source_ref: upResult.source_ref,
    external_url: upResult.external_url || null,
    storage_path:
      source === SOURCE_TYPES.SUPABASE_STORAGE ? upResult.source_ref : null,
    description: opts.description || null,
    user_tags: opts.userTags || null,
    ai_suggestions: opts.aiSuggestions || null,
  };

  const { data, error } = await supabase
    .from("documents")
    .insert(row)
    .select()
    .single();

  if (error) {
    return { document: null, error };
  }

  return { document: data, error: null };
}

export async function getDocumentDownloadUrl(documentRow, opts = {}) {
  if (!documentRow)
    return { url: null, error: { message: "No document row provided" } };
  const source = documentRow.source_type || SOURCE_TYPES.SUPABASE_STORAGE;
  const adapter = sourceAdapters[source];
  if (!adapter)
    return { url: null, error: { message: `Unknown source: ${source}` } };
  if (!IMPLEMENTED_SOURCES.has(source)) {
    if (documentRow.external_url) return { url: documentRow.external_url };
    return {
      url: null,
      error: { message: `Source not yet implemented: ${source}` },
    };
  }
  return adapter.getDownloadUrl(documentRow, opts);
}

export function getSourceLabel(sourceType) {
  const labels = {
    [SOURCE_TYPES.SUPABASE_STORAGE]: "Supabase Storage",
    [SOURCE_TYPES.MICROSOFT_GRAPH]: "Microsoft 365",
    [SOURCE_TYPES.DROPBOX]: "Dropbox",
    [SOURCE_TYPES.BOX]: "Box",
    [SOURCE_TYPES.GDRIVE]: "Google Drive",
    [SOURCE_TYPES.EXTERNAL_URL]: "External Link",
  };
  return labels[sourceType] || "Unknown";
}
