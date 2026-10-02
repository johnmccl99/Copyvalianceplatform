import { supabase, ORG_ID } from "./supabaseClient.js";

export async function fetchFolderTree() {
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .eq("org_id", ORG_ID)
    .order("path");

  if (error) {
    console.error("fetchFolderTree error:", error);
    return { tree: [], byId: new Map(), byPath: new Map(), error };
  }

  const byId = new Map();
  const byPath = new Map();
  const childrenByParent = new Map();

  for (const row of data || []) {
    const node = {
      id: row.id,
      name: row.name,
      path: row.path,
      library: row.library,
      parent_id: row.parent_id,
      created_at: row.created_at,
      children: [],
    };
    byId.set(row.id, node);
    byPath.set(row.path, node);
    if (!childrenByParent.has(row.parent_id)) {
      childrenByParent.set(row.parent_id, []);
    }
    childrenByParent.get(row.parent_id).push(node);
  }

  for (const [parentId, children] of childrenByParent) {
    if (parentId && byId.has(parentId)) {
      byId.get(parentId).children = children;
    }
  }

  const tree = childrenByParent.get(null) || [];

  return { tree, byId, byPath };
}

export async function fetchFolderByPath(path) {
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .eq("org_id", ORG_ID)
    .eq("path", path)
    .maybeSingle();
  return { folder: data, error };
}

export async function fetchFolderById(id) {
  if (!id) return { folder: null, error: { message: "no id" } };
  const { data, error } = await supabase
    .from("folders")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  return { folder: data, error };
}

export async function createFolder(parentId, name) {
  if (!name || typeof name !== "string" || !name.trim()) {
    return { folder: null, error: { message: "Folder name is required" } };
  }
  if (name.includes("/")) {
    return {
      folder: null,
      error: { message: "Folder name cannot contain '/'" },
    };
  }

  const { folder: parent, error: pErr } = await fetchFolderById(parentId);
  if (pErr || !parent) {
    return {
      folder: null,
      error: pErr || { message: "Parent folder not found" },
    };
  }

  const trimmedName = name.trim();
  const newPath = parent.path + "/" + trimmedName;

  const { data, error } = await supabase
    .from("folders")
    .insert({
      org_id: ORG_ID,
      parent_id: parent.id,
      name: trimmedName,
      library: parent.library,
      path: newPath,
    })
    .select()
    .single();

  if (error) return { folder: null, error };
  return { folder: data, error: null };
}

export async function renameFolder(id, newName) {
  if (!newName || typeof newName !== "string" || !newName.trim()) {
    return { folder: null, error: { message: "New name is required" } };
  }
  if (newName.includes("/")) {
    return {
      folder: null,
      error: { message: "Folder name cannot contain '/'" },
    };
  }

  const { folder: current } = await fetchFolderById(id);
  if (!current) return { folder: null, error: { message: "Folder not found" } };

  if (!current.parent_id) {
    return {
      folder: null,
      error: { message: "Top-level libraries cannot be renamed" },
    };
  }

  const trimmed = newName.trim();
  const oldPath = current.path;
  const parentPath = oldPath.substring(0, oldPath.lastIndexOf("/"));
  const newPath = parentPath + "/" + trimmed;

  const { data: updated, error: uErr } = await supabase
    .from("folders")
    .update({
      name: trimmed,
      path: newPath,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (uErr) return { folder: null, error: uErr };

  const { data: descendants } = await supabase
    .from("folders")
    .select("id, path")
    .eq("org_id", ORG_ID)
    .like("path", oldPath + "/%");

  if (descendants && descendants.length) {
    for (const d of descendants) {
      const updatedPath = newPath + d.path.substring(oldPath.length);
      await supabase
        .from("folders")
        .update({ path: updatedPath, updated_at: new Date().toISOString() })
        .eq("id", d.id);
    }
  }

  return { folder: updated, error: null };
}

export async function moveFolder(id, newParentId) {
  if (id === newParentId) {
    return {
      folder: null,
      error: { message: "Cannot move a folder into itself" },
    };
  }

  const { folder: current } = await fetchFolderById(id);
  const { folder: newParent } = await fetchFolderById(newParentId);
  if (!current || !newParent) {
    return {
      folder: null,
      error: { message: "Folder or new parent not found" },
    };
  }
  if (!current.parent_id) {
    return {
      folder: null,
      error: { message: "Top-level libraries cannot be moved" },
    };
  }
  if (newParent.path.startsWith(current.path + "/")) {
    return {
      folder: null,
      error: { message: "Cannot move a folder into its own descendant" },
    };
  }

  const oldPath = current.path;
  const newPath = newParent.path + "/" + current.name;
  const newLibrary = newParent.library;

  const { data: updated, error: uErr } = await supabase
    .from("folders")
    .update({
      parent_id: newParent.id,
      path: newPath,
      library: newLibrary,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .single();
  if (uErr) return { folder: null, error: uErr };

  const { data: descendants } = await supabase
    .from("folders")
    .select("id, path")
    .eq("org_id", ORG_ID)
    .like("path", oldPath + "/%");

  if (descendants && descendants.length) {
    for (const d of descendants) {
      const updatedPath = newPath + d.path.substring(oldPath.length);
      await supabase
        .from("folders")
        .update({
          path: updatedPath,
          library: newLibrary,
          updated_at: new Date().toISOString(),
        })
        .eq("id", d.id);
    }
  }

  return { folder: updated, error: null };
}

export async function listDocumentsInFolder(folderId) {
  let query = supabase.from("documents").select("*").order("file_name");
  if (folderId === null || folderId === undefined) {
    query = query.is("folder_id", null);
  } else {
    query = query.eq("folder_id", folderId);
  }
  const { data, error } = await query;
  if (error) {
    console.error("listDocumentsInFolder error:", error);
    return [];
  }
  return data || [];
}

export async function countDocumentsPerFolder() {
  const { data, error } = await supabase
    .from("documents")
    .select("folder_id")
    .not("folder_id", "is", null);
  if (error) return {};
  const counts = {};
  for (const r of data || []) {
    counts[r.folder_id] = (counts[r.folder_id] || 0) + 1;
  }
  return counts;
}

export async function createFolderInAllProperties(folderName) {
  if (!folderName || typeof folderName !== "string" || !folderName.trim()) {
    return {
      created: 0,
      skipped: 0,
      errors: [{ message: "folderName required" }],
    };
  }
  if (folderName.includes("/")) {
    return {
      created: 0,
      skipped: 0,
      errors: [{ message: "folderName cannot contain '/'" }],
    };
  }
  const trimmed = folderName.trim();

  const { data: propertiesRoot, error: rootErr } = await supabase
    .from("folders")
    .select("id")
    .eq("org_id", ORG_ID)
    .eq("path", "/Properties")
    .maybeSingle();
  if (rootErr || !propertiesRoot) {
    return {
      created: 0,
      skipped: 0,
      errors: [rootErr || { message: "/Properties folder not found" }],
    };
  }

  const { data: propertyFolders, error: childErr } = await supabase
    .from("folders")
    .select("id, name, path")
    .eq("org_id", ORG_ID)
    .eq("parent_id", propertiesRoot.id);
  if (childErr) return { created: 0, skipped: 0, errors: [childErr] };

  let created = 0;
  let skipped = 0;
  const errors = [];

  for (const prop of propertyFolders || []) {
    const targetPath = `${prop.path}/${trimmed}`;
    const { data: existing } = await supabase
      .from("folders")
      .select("id")
      .eq("org_id", ORG_ID)
      .eq("path", targetPath)
      .maybeSingle();
    if (existing) {
      skipped += 1;
      continue;
    }

    const { error: insErr } = await supabase.from("folders").insert({
      org_id: ORG_ID,
      parent_id: prop.id,
      name: trimmed,
      library: "properties",
      path: targetPath,
    });
    if (insErr) errors.push({ property: prop.name, error: insErr });
    else created += 1;
  }

  return { created, skipped, errors };
}

export async function resolveContextFolder(ctx = {}) {
  let targetPath = null;

  if (ctx.propertyName && ctx.category) {
    targetPath = `/Properties/${ctx.propertyName}/${ctx.category}`;
  } else if (ctx.propertyName) {
    targetPath = `/Properties/${ctx.propertyName}`;
  } else if (ctx.dealName && ctx.stage) {
    targetPath = `/Deals/${ctx.dealName}/${ctx.stage}`;
  } else if (ctx.dealName) {
    targetPath = `/Deals/${ctx.dealName}`;
  } else if (ctx.fundName && ctx.vintage) {
    targetPath = `/Funds/${ctx.fundName}/${ctx.vintage}`;
  } else if (ctx.fundName) {
    targetPath = `/Funds/${ctx.fundName}`;
  } else if (ctx.investorName && ctx.category) {
    targetPath = `/Investors/${ctx.investorName}/${ctx.category}`;
  } else if (ctx.investorName) {
    targetPath = `/Investors/${ctx.investorName}`;
  } else if (ctx.library) {
    const libraryPaths = {
      funds: "/Funds",
      properties: "/Properties",
      deals: "/Deals",
      corporate: "/Corporate",
      debt: "/Debt",
      investors: "/Investors",
      operations: "/Operations",
      market_intel: "/Market Intel",
      personal: "/Personal",
    };
    targetPath = libraryPaths[ctx.library] || null;
  }

  if (!targetPath) return { folder_id: null, path: null, auto: false };

  const { folder } = await fetchFolderByPath(targetPath);
  if (folder) return { folder_id: folder.id, path: folder.path, auto: true };

  return { folder_id: null, path: targetPath, auto: false };
}
