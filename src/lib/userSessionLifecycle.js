export const SESSION_ROW_STORAGE_KEY = "user_session_row_id";
export const SESSION_HEARTBEAT_MS = 60 * 1000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readStored(storage) {
  try {
    const v = storage?.getItem(SESSION_ROW_STORAGE_KEY);
    return typeof v === "string" && UUID_RE.test(v) ? v : null;
  } catch {
    return null;
  }
}

function writeStored(storage, id) {
  try {
    if (id) storage?.setItem(SESSION_ROW_STORAGE_KEY, id);
    else storage?.removeItem(SESSION_ROW_STORAGE_KEY);
  } catch {}
}

export function createSessionLifecycle({
  start,
  touch,
  end,
  storage = null,
  isHidden = () => false,
}) {
  let rowId = null;
  let starting = null;

  return {
    get rowId() {
      return rowId;
    },

    async begin(profile) {
      if (rowId) return rowId;
      if (starting) return starting;
      starting = (async () => {
        const stored = readStored(storage);
        if (stored) {
          rowId = stored;
          await touch(rowId);
          return rowId;
        }
        const id = await start(profile);
        rowId = id || null;
        writeStored(storage, rowId);
        return rowId;
      })();
      try {
        return await starting;
      } finally {
        starting = null;
      }
    },

    async heartbeat() {
      if (!rowId) return false;
      if (isHidden()) return false;
      await touch(rowId);
      return true;
    },

    async finish(reason = "user_sign_out") {
      const id = rowId;
      rowId = null;
      writeStored(storage, null);
      if (!id) return false;
      await end(id, reason);
      return true;
    },
  };
}
