import { supabase, fetchDropboxListing } from "./supabaseClient.js";
import {
  fetchSharePointSites,
  fetchSiteDocumentLibraries,
  fetchDriveItems,
  getMicrosoftConnectionStatus,
} from "./microsoftGraphClient.js";

export const DropboxProvider = {
  id: "dropbox",
  displayName: "Dropbox",

  async status() {
    const { data, error } = await supabase
      .from("org_dropbox_accounts")
      .select("status,email")
      .limit(1)
      .maybeSingle();
    if (error) {
      return {
        connected: false,
        reason: "Unable to check Dropbox connection.",
      };
    }
    if (!data) {
      return {
        connected: false,
        reason: "Dropbox not connected. Connect in Admin → Integration Hub.",
      };
    }
    if (data.status === "needs_reauth") {
      return {
        connected: false,
        reason:
          "Dropbox needs to be reconnected. Reauthorize in Admin → Integration Hub.",
      };
    }
    if (data.status !== "active") {
      return {
        connected: false,
        reason: `Dropbox status: ${data.status}. Reconnect in Admin → Integration Hub.`,
      };
    }
    return { connected: true };
  },

  async listRoot() {
    return this.listChildren({ path: "" });
  },

  async listChildren(node) {
    const items = await fetchDropboxListing(node?.path || "");
    return items.map(toDropboxFileNode);
  },

  async resolveSelection(node) {
    if (!node || node.kind !== "file") {
      throw new Error("Select a file to use it as the intake source.");
    }
    if (node.isDownloadable === false) {
      throw new Error(
        "This entry is not downloadable from Dropbox (e.g., a Google Docs shortcut). Pick a real .xlsx / .xlsm file.",
      );
    }
    return {
      provider: "dropbox",
      path: node.path,
      dropbox_file_id: node.id,
    };
  },
};

function toDropboxFileNode(row) {
  return {
    id: row.dropbox_file_id,
    name: row.name,
    kind: row.kind,
    path: row.path_display,
    modifiedAt: row.server_modified || row.client_modified || null,
    size: row.size_bytes ?? null,
    isDownloadable: row.is_downloadable !== false,
  };
}

export const SharePointProvider = {
  id: "sharepoint",
  displayName: "SharePoint",

  async status() {
    const s = getMicrosoftConnectionStatus();
    if (s === "Connected") return { connected: true };
    if (s === "Not Configured") {
      return {
        connected: false,
        reason: "Microsoft 365 is not configured in this environment.",
      };
    }
    return {
      connected: false,
      reason:
        "Microsoft 365 not connected. Sign in via Admin → Integration Hub.",
    };
  },

  async listRoot() {
    const res = await fetchSharePointSites();
    throwIfGraphError(res, "SharePoint sites unavailable");
    return (res?.value || []).map((site) => ({
      id: site.id,
      name: site.displayName || site.name || "Untitled site",
      kind: "folder",
      providerExtras: { tier: "site", siteId: site.id, webUrl: site.webUrl },
    }));
  },

  async listChildren(node) {
    const extras = node?.providerExtras || {};
    if (extras.tier === "site") {
      const res = await fetchSiteDocumentLibraries(extras.siteId);
      throwIfGraphError(res, "SharePoint drives unavailable");
      return (res?.value || []).map((drive) => ({
        id: drive.id,
        name: drive.name,
        kind: "folder",
        providerExtras: {
          tier: "drive",
          driveId: drive.id,
          webUrl: drive.webUrl,
        },
      }));
    }
    if (extras.tier === "drive") {
      const res = await fetchDriveItems(extras.driveId, "root", 200);
      throwIfGraphError(res, "SharePoint root items unavailable");
      return (res?.value || []).map((item) =>
        toGraphItemNode(item, extras.driveId),
      );
    }
    if (extras.tier === "folder") {
      const res = await fetchDriveItems(extras.driveId, node.id, 200);
      throwIfGraphError(res, "SharePoint folder items unavailable");
      return (res?.value || []).map((item) =>
        toGraphItemNode(item, extras.driveId),
      );
    }
    return [];
  },

  async resolveSelection(node) {
    if (!node || node.kind !== "file") {
      throw new Error("Select a file to use it as the intake source.");
    }
    const extras = node.providerExtras || {};
    if (!extras.driveId) {
      throw new Error(
        "Selected SharePoint item is missing drive context. Re-navigate from a site and retry.",
      );
    }
    return {
      provider: "sharepoint",
      driveId: extras.driveId,
      itemId: node.id,
      name: node.name,
      webUrl: extras.webUrl,
    };
  },
};

function toGraphItemNode(item, driveId) {
  const isFolder = !!item.folder;
  return {
    id: item.id,
    name: item.name,
    kind: isFolder ? "folder" : "file",
    modifiedAt: item.lastModifiedDateTime,
    size: item.size ?? null,
    providerExtras: {
      tier: isFolder ? "folder" : "file",
      driveId,
      webUrl: item.webUrl,
    },
  };
}

function throwIfGraphError(res, fallback) {
  if (!res || res.error == null) return;
  if (typeof res.error === "string") throw new Error(res.error);
  throw new Error(res.error.message || fallback || "Graph call failed");
}

export function filterByExtension(nodes, extensions) {
  if (!extensions || extensions.length === 0) return nodes;
  const lowered = extensions.map((e) => e.toLowerCase());
  return (nodes || []).filter((n) => {
    if (!n) return false;
    if (n.kind !== "file") return true;
    const dot = (n.name || "").lastIndexOf(".");
    if (dot < 0) return false;
    return lowered.includes(n.name.slice(dot).toLowerCase());
  });
}

export function formatSize(node) {
  if (!node || node.kind !== "file") return "";
  const b = node.size;
  if (b == null) return "";
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(1)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

export const PROVIDERS = [DropboxProvider, SharePointProvider];

export const SHAREPOINT_INGEST_DISABLED = false;
