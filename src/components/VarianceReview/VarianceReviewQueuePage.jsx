import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchVarianceReviewItems,
  fetchVarianceReviewSummary,
  fetchVarianceReviewEvents,
  listAssignableUsers,
  assignVarianceReviewItem,
  setVarianceReviewStatus,
  addVarianceReviewNote,
  EMPTY_SUMMARY,
  ITEM_FETCH_LIMIT,
} from "../../lib/varianceReview.js";
import { formatPercent, EMPTY } from "../../lib/numberFormat.js";
import { T } from "../../lib/theme.js";

export const NOTE_MAX_CHARS = 4000;

export const OPEN_STATUSES = Object.freeze(["to_review", "in_review"]);
export const TERMINAL_STATUSES = Object.freeze([
  "resolved",
  "accepted_variance",
]);

export const STATUS_LABELS = Object.freeze({
  to_review: "To review",
  in_review: "In review",
  resolved: "Resolved",
  accepted_variance: "Accepted variance",
});

export const EVENT_KIND_LABELS = Object.freeze({
  created: "opened",
  note: "note",
  assigned: "assigned",
  unassigned: "released",
  status_change: "status change",
  flag_update: "flag update",
  resolved: "resolved",
  accepted: "accepted variance",
});

export function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

export function validTransitions(status) {
  if (status === "to_review")
    return ["in_review", "resolved", "accepted_variance"];
  if (status === "in_review")
    return ["to_review", "resolved", "accepted_variance"];
  return [];
}

const MONTH_NAMES = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

export function formatMonthEnd(monthEnd) {
  if (!monthEnd || typeof monthEnd !== "string") return EMPTY;
  const [y, m] = monthEnd.split("-");
  const idx = Number(m) - 1;
  if (!y || !Number.isInteger(idx) || idx < 0 || idx > 11) return EMPTY;
  return `${MONTH_NAMES[idx]} ${y}`;
}

export function ageDays(createdAt, nowMs = Date.now()) {
  const t = Date.parse(createdAt);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((nowMs - t) / 86400000));
}

export function itemAccountLabel(item) {
  if (!item) return { label: EMPTY, isGroup: false };
  if (item.account_number == null) {
    return { label: item.group_key || EMPTY, isGroup: true };
  }
  return { label: item.account_name || item.account_number, isGroup: false };
}

export const RENDER_PAGE_SIZE = 200;

export function buildItemQuery({
  scopeCodes = null,
  property = "",
  status = "open",
  assignee = "anyone",
  flag = "all",
  currentUserId = null,
} = {}) {
  const q = {};
  const scoped =
    Array.isArray(scopeCodes) && scopeCodes.length > 0 ? scopeCodes : null;

  if (property)
    q.propertyCodes = scoped
      ? scoped.filter((c) => c === property)
      : [property];
  else if (scoped) q.propertyCodes = scoped;

  if (status === "open") q.statuses = [...OPEN_STATUSES];
  else if (status !== "all") q.statuses = [status];

  if (assignee === "unassigned") q.assignedTo = "unassigned";
  else if (assignee === "me") {
    if (currentUserId) q.assignedTo = currentUserId;
  } else if (assignee !== "anyone") q.assignedTo = assignee;

  if (flag === "red" || flag === "orange") q.flag = flag;

  return q;
}

export function filterItems(items, filters = {}) {
  const {
    property = "",
    status = "open",
    assignee = "anyone",
    flag = "all",
    currentUserId = null,
  } = filters;
  const list = Array.isArray(items) ? items : [];
  return list.filter((it) => {
    if (!it) return false;
    if (property && it.property_code !== property) return false;
    if (status === "open") {
      if (!OPEN_STATUSES.includes(it.status)) return false;
    } else if (status !== "all" && it.status !== status) return false;
    if (assignee === "unassigned") {
      if (it.assigned_to != null) return false;
    } else if (assignee === "me") {
      if (!currentUserId || it.assigned_to !== currentUserId) return false;
    } else if (assignee !== "anyone" && it.assigned_to !== assignee)
      return false;
    if (flag !== "all" && it.flag_at_open !== flag) return false;
    return true;
  });
}

export function sortItems(items) {
  const list = Array.isArray(items) ? [...items] : [];
  list.sort((a, b) => {
    const am = a?.month_end || "";
    const bm = b?.month_end || "";
    if (am !== bm) return am < bm ? 1 : -1;
    const ap = a?.property_code || "";
    const bp = b?.property_code || "";
    if (ap !== bp) return ap < bp ? -1 : 1;
    const ag = a?.group_key || "";
    const bg = b?.group_key || "";
    if (ag !== bg) return ag < bg ? -1 : 1;
    const aAcct = a?.account_number;
    const bAcct = b?.account_number;
    if (aAcct == null && bAcct != null) return -1;
    if (aAcct != null && bAcct == null) return 1;
    const as = aAcct || "";
    const bs = bAcct || "";
    if (as !== bs) return as < bs ? -1 : 1;
    return 0;
  });
  return list;
}

export function shapeAssignableUsers(rows) {
  const list = Array.isArray(rows) ? rows : [];
  const out = [];
  for (const r of list) {
    if (!r || !r.id) continue;
    const name = (r.display_name || "").trim();
    out.push({
      id: r.id,
      label: name || (r.role ? `(${r.role})` : "Unnamed member"),
      role: r.role || null,
    });
  }
  out.sort((a, b) => a.label.localeCompare(b.label));
  return out;
}

export default function VarianceReviewQueuePage({
  C = {},
  userProfile,
  propertyCodes = null,
  onOpenProperty = null,
} = {}) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const subtle = C.subtleBg || T.inset;
  const red = C.red || T.dangerText;
  const amber = C.amber || C.warning || T.warningText;
  const redChipBg = C.dangerBg || T.dangerBg;
  const amberChipBg = C.warningBg || T.warningBg;

  const currentUserId = userProfile?.id || null;

  const [items, setItems] = useState([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const itemsReq = useRef(0);
  const summaryReq = useRef(0);
  const [error, setError] = useState(null);
  const [users, setUsers] = useState([]);
  const [usersError, setUsersError] = useState(null);

  const [summary, setSummary] = useState(EMPTY_SUMMARY);
  const [summaryError, setSummaryError] = useState(null);

  const [shownCount, setShownCount] = useState(RENDER_PAGE_SIZE);

  const [propertyFilter, setPropertyFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("open");
  const [assigneeFilter, setAssigneeFilter] = useState("anyone");
  const [flagFilter, setFlagFilter] = useState("all");

  const [openItemId, setOpenItemId] = useState(null);
  const [events, setEvents] = useState({
    forId: null,
    rows: [],
    loading: false,
    error: null,
  });
  const [noteText, setNoteText] = useState("");

  const [actionError, setActionError] = useState(null);
  const [busyItemId, setBusyItemId] = useState(null);

  const [pendingResolution, setPendingResolution] = useState(null);

  const emptySelection =
    Array.isArray(propertyCodes) && propertyCodes.length === 0;
  const codesKey = Array.isArray(propertyCodes)
    ? propertyCodes.join("\u0000")
    : null;

  const loadItems = useCallback(async () => {
    const req = ++itemsReq.current;
    if (emptySelection) {
      setItems([]);
      setTruncated(false);
      setError(null);
      setLoading(false);
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    setError(null);
    const {
      data,
      truncated: cut,
      error: err,
    } = await fetchVarianceReviewItems(
      buildItemQuery({
        scopeCodes: propertyCodes,
        property: propertyFilter,
        status: statusFilter,
        assignee: assigneeFilter,
        flag: flagFilter,
        currentUserId,
      }),
    );
    if (req !== itemsReq.current) return;
    if (err) {
      setError(err);
      setItems([]);
      setTruncated(false);
    } else {
      setItems(data);
      setTruncated(Boolean(cut));
    }
    setShownCount(RENDER_PAGE_SIZE);
    setLoading(false);
    setRefreshing(false);
  }, [
    codesKey,
    emptySelection,
    propertyFilter,
    statusFilter,
    assigneeFilter,
    flagFilter,
    currentUserId,
  ]);

  const loadSummary = useCallback(async () => {
    const req = ++summaryReq.current;
    if (emptySelection) {
      setSummary(EMPTY_SUMMARY);
      setSummaryError(null);
      return;
    }
    const { data, error: err } = await fetchVarianceReviewSummary({
      propertyCodes:
        Array.isArray(propertyCodes) && propertyCodes.length > 0
          ? propertyCodes
          : null,
    });
    if (req !== summaryReq.current) return;
    setSummary(data || EMPTY_SUMMARY);
    setSummaryError(err || null);
  }, [codesKey, emptySelection]);

  const loadEvents = useCallback(async (itemId) => {
    setEvents({ forId: itemId, rows: [], loading: true, error: null });
    const { data, error: err } = await fetchVarianceReviewEvents(itemId);
    setEvents({
      forId: itemId,
      rows: data || [],
      loading: false,
      error: err || null,
    });
  }, []);

  useEffect(() => {
    loadItems();
  }, [loadItems]);

  useEffect(() => {
    loadSummary();
  }, [loadSummary]);

  useEffect(() => {
    let alive = true;
    listAssignableUsers().then(({ data, error: err }) => {
      if (!alive) return;
      if (err) setUsersError(err);
      setUsers(shapeAssignableUsers(data));
    });
    return () => {
      alive = false;
    };
  }, []);

  const usersById = useMemo(() => {
    const m = new Map();
    for (const u of users) m.set(u.id, u.label);
    return m;
  }, [users]);

  const assigneeName = useCallback(
    (id) => (id == null ? null : usersById.get(id) || "Team member"),
    [usersById],
  );

  const propertyOptions = summary.propertyCodes;
  const visibleItems = useMemo(
    () =>
      sortItems(
        filterItems(items, {
          property: propertyFilter,
          status: statusFilter,
          assignee: assigneeFilter,
          flag: flagFilter,
          currentUserId,
        }),
      ),
    [
      items,
      propertyFilter,
      statusFilter,
      assigneeFilter,
      flagFilter,
      currentUserId,
    ],
  );
  const renderedItems = useMemo(
    () => visibleItems.slice(0, shownCount),
    [visibleItems, shownCount],
  );

  const nothingInScope =
    !summaryError && summary.total === 0 && items.length === 0;
  const nothingMatches = !nothingInScope && visibleItems.length === 0;
  const openItem = useMemo(
    () => items.find((it) => it.id === openItemId) || null,
    [items, openItemId],
  );

  const runAction = useCallback(
    async (itemId, fn) => {
      setBusyItemId(itemId);
      setActionError(null);
      try {
        const { data: updated, error: err } = await fn();
        if (err) {
          setActionError({
            itemId,
            message: err.message ? String(err.message) : String(err),
          });
        } else {
          if (updated && updated.id) {
            setItems((prev) =>
              prev.map((it) =>
                it.id === updated.id ? { ...it, ...updated } : it,
              ),
            );
          } else {
            await loadItems();
          }
          await loadSummary();
          if (openItemId === itemId || events.forId === itemId)
            await loadEvents(itemId);
        }
      } catch (e) {
        setActionError({ itemId, message: String(e?.message || e) });
      } finally {
        setBusyItemId(null);
      }
    },
    [loadItems, loadSummary, loadEvents, openItemId, events.forId],
  );

  const doAssign = (itemId, assigneeId) =>
    runAction(itemId, () => assignVarianceReviewItem(itemId, assigneeId));

  const doStatus = (itemId, status, note = null) =>
    runAction(itemId, () => setVarianceReviewStatus(itemId, status, note));

  const submitNote = async (itemId) => {
    const clean = noteText.trim();
    if (!clean) {
      setActionError({ itemId, message: "Write the note first." });
      return;
    }
    setBusyItemId(itemId);
    setActionError(null);
    const { error: err } = await addVarianceReviewNote(itemId, clean);
    setBusyItemId(null);
    if (err) {
      setActionError({
        itemId,
        message: err.message ? String(err.message) : String(err),
      });
      return;
    }
    setNoteText("");
    await loadEvents(itemId);
  };

  const confirmResolution = async () => {
    if (!pendingResolution) return;
    const { itemId, status, note } = pendingResolution;
    setPendingResolution(null);
    await doStatus(itemId, status, note.trim() || null);
  };

  const openDetail = (itemId) => {
    setOpenItemId(itemId);
    setNoteText("");
    setPendingResolution(null);
    setActionError(null);
    loadEvents(itemId);
  };

  const closeDetail = () => {
    setOpenItemId(null);
    setPendingResolution(null);
    setNoteText("");
  };

  const th = {
    textAlign: "left",
    padding: "8px 10px",
    fontSize: 12,
    color: sub,
    fontWeight: 600,
    borderBottom: `1px solid ${border}`,
    whiteSpace: "nowrap",
  };
  const thNum = { ...th, textAlign: "right" };
  const td = {
    padding: "7px 10px",
    fontSize: 13,
    color: text,
    borderBottom: `1px solid ${border}`,
    verticalAlign: "middle",
  };
  const tdNum = {
    ...td,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  };
  const inputStyle = {
    fontSize: 12.5,
    padding: "5px 8px",
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: subtle,
    color: text,
  };
  const quietBtn = {
    fontSize: 12,
    padding: "4px 10px",
    borderRadius: 6,
    border: `1px solid ${border}`,
    background: "transparent",
    color: text,
    cursor: "pointer",
    whiteSpace: "nowrap",
  };
  const primaryBtn = (enabled) => ({
    fontSize: 12.5,
    fontWeight: 600,
    padding: "5px 12px",
    borderRadius: 6,
    border: `1px solid ${border}`,
    cursor: enabled ? "pointer" : "not-allowed",
    opacity: enabled ? 1 : 0.5,
    background: T.accentFill,
    color: T.accentFillText,
    whiteSpace: "nowrap",
  });

  const flagPill = (flag) => {
    if (flag !== "red" && flag !== "orange") return null;
    const isRed = flag === "red";
    return (
      <span
        title={
          isRed
            ? "Red at open: the account-group variance exceeded the group threshold"
            : "Orange at open: an offsetting account exceeded the account threshold inside an on-track group"
        }
        style={{
          display: "inline-block",
          padding: "1px 7px",
          fontSize: 10,
          fontWeight: 700,
          lineHeight: 1.6,
          letterSpacing: "0.03em",
          borderRadius: 999,
          color: isRed ? red : amber,
          background: isRed ? redChipBg : amberChipBg,
          border: `1px solid ${isRed ? red : amber}`,
          verticalAlign: "middle",
          whiteSpace: "nowrap",
        }}
      >
        {isRed ? "MATERIAL" : "REVIEW"}
      </span>
    );
  };

  const statusPill = (status) => {
    const palette = {
      to_review: { bg: T.neutralBg, fg: sub },
      in_review: { bg: T.infoBg, fg: T.infoText },
      resolved: { bg: T.successBg, fg: T.successText },
      accepted_variance: { bg: subtle, fg: sub },
    }[status] || { bg: subtle, fg: sub };
    return (
      <span
        style={{
          display: "inline-block",
          fontSize: 10.5,
          fontWeight: 600,
          padding: "2px 8px",
          borderRadius: 999,
          background: palette.bg,
          color: palette.fg,
          whiteSpace: "nowrap",
        }}
      >
        {STATUS_LABELS[status] || status}
      </span>
    );
  };

  const groupPill = (
    <span
      style={{
        display: "inline-block",
        marginLeft: 6,
        fontSize: 10,
        fontWeight: 600,
        padding: "1px 7px",
        borderRadius: 999,
        background: subtle,
        color: sub,
        border: `1px solid ${border}`,
        whiteSpace: "nowrap",
      }}
    >
      group
    </span>
  );

  const flagClearedBadge = (
    <span
      title="The underlying variance flag recovered on a later evaluation while this item was open. Items close by human action only."
      style={{
        display: "inline-block",
        marginLeft: 6,
        fontSize: 10,
        fontWeight: 600,
        padding: "1px 7px",
        borderRadius: 999,
        background: T.successBg,
        color: T.successText,
        whiteSpace: "nowrap",
      }}
    >
      flag cleared
    </span>
  );

  const inlineError = (itemId) =>
    actionError && actionError.itemId === itemId ? (
      <div style={{ color: red, fontSize: 12, marginTop: 4 }}>
        {actionError.message}
      </div>
    ) : null;

  const assignSelect = (item) => (
    <select
      style={{ ...inputStyle, maxWidth: 150 }}
      value={item.assigned_to || ""}
      disabled={busyItemId === item.id}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => {
        e.stopPropagation();
        const v = e.target.value || null;
        if (v !== (item.assigned_to || null)) doAssign(item.id, v);
      }}
    >
      <option value="">Unassigned</option>
      {users.map((u) => (
        <option key={u.id} value={u.id}>
          {u.id === currentUserId ? `${u.label} (me)` : u.label}
        </option>
      ))}
    </select>
  );

  const transitionButtons = (item, { inPanel = false } = {}) => {
    const moves = validTransitions(item.status);
    if (moves.length === 0) return null;
    const busy = busyItemId === item.id;
    const btns = [];
    if (item.status === "to_review" && !item.assigned_to) {
      btns.push(
        <button
          key="self"
          style={quietBtn}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            doAssign(item.id, currentUserId);
          }}
          title="Assign this item to yourself (moves it to In review)"
        >
          Self-assign
        </button>,
      );
    }
    if (moves.includes("in_review") && item.assigned_to) {
      btns.push(
        <button
          key="start"
          style={quietBtn}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            doStatus(item.id, "in_review");
          }}
        >
          Start review
        </button>,
      );
    }
    if (moves.includes("to_review")) {
      btns.push(
        <button
          key="release"
          style={quietBtn}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            doStatus(item.id, "to_review");
          }}
          title="Return the item to the queue and clear the assignment"
        >
          Release
        </button>,
      );
    }
    if (moves.includes("resolved")) {
      btns.push(
        <button
          key="resolve"
          style={quietBtn}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            setPendingResolution({
              itemId: item.id,
              status: "resolved",
              note: "",
            });
            if (!inPanel) openDetail(item.id);
            else setOpenItemId(item.id);
          }}
          title="Close the item: the variance was addressed"
        >
          Resolve
        </button>,
      );
    }
    if (moves.includes("accepted_variance")) {
      btns.push(
        <button
          key="accept"
          style={quietBtn}
          disabled={busy}
          onClick={(e) => {
            e.stopPropagation();
            setPendingResolution({
              itemId: item.id,
              status: "accepted_variance",
              note: "",
            });
            if (!inPanel) openDetail(item.id);
            else setOpenItemId(item.id);
          }}
          title="Close the item: the variance is understood and tolerated"
        >
          Accept variance
        </button>,
      );
    }
    if (btns.length === 0) return null;
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>{btns}</div>
    );
  };

  const detailPanel = () => {
    if (!openItem) return null;
    const acct = itemAccountLabel(openItem);
    const busy = busyItemId === openItem.id;
    const isResolving =
      pendingResolution && pendingResolution.itemId === openItem.id;
    return (
      <>
        <div
          onClick={closeDetail}
          style={{
            position: "fixed",
            inset: 0,
            background: T.scrim,
            zIndex: 40,
          }}
          aria-hidden="true"
        />
        <div
          role="dialog"
          aria-label="Variance review item detail"
          style={{
            position: "fixed",
            top: 0,
            right: 0,
            bottom: 0,
            zIndex: 41,
            width: "min(480px, 100vw)",
            background: card,
            borderLeft: `1px solid ${border}`,
            boxShadow: T.shadowModal,
            overflowY: "auto",
            padding: 20,
            boxSizing: "border-box",
            color: text,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 10,
            }}
          >
            <div>
              <div style={{ fontSize: 15, fontWeight: 700 }}>
                {openItem.property_code} - {acct.label}
                {acct.isGroup && groupPill}
              </div>
              <div style={{ fontSize: 12, color: sub, marginTop: 3 }}>
                {formatMonthEnd(openItem.month_end)} - group{" "}
                {openItem.group_key}
                {!acct.isGroup && openItem.account_number
                  ? ` - account ${openItem.account_number}`
                  : ""}
              </div>
            </div>
            <button
              style={quietBtn}
              onClick={closeDetail}
              aria-label="Close detail panel"
            >
              Close
            </button>
          </div>

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "center",
              margin: "12px 0",
            }}
          >
            {flagPill(openItem.flag_at_open)}
            {statusPill(openItem.status)}
            {openItem.flag_cleared_at != null && flagClearedBadge}
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: sub,
              lineHeight: 1.7,
              marginBottom: 12,
            }}
          >
            <div>
              Variance at open:{" "}
              <span style={{ color: text, fontVariantNumeric: "tabular-nums" }}>
                {formatPercent(openItem.pct_at_open, { signed: true })}
              </span>
            </div>
            <div>
              Opened: {String(openItem.created_at).slice(0, 10)} (
              {ageDays(openItem.created_at) ?? EMPTY} days ago)
            </div>
            <div>
              Assignee: {assigneeName(openItem.assigned_to) || "Unassigned"}
            </div>
            {openItem.resolved_at != null && (
              <div>
                Closed: {String(openItem.resolved_at).slice(0, 10)} by{" "}
                {assigneeName(openItem.resolved_by) || "a team member"}
              </div>
            )}
          </div>

          {!isTerminalStatus(openItem.status) && !isResolving && (
            <div
              style={{
                display: "flex",
                gap: 8,
                flexWrap: "wrap",
                alignItems: "center",
                marginBottom: 8,
              }}
            >
              {assignSelect(openItem)}
              {transitionButtons(openItem, { inPanel: true })}
            </div>
          )}
          {typeof onOpenProperty === "function" && (
            <div style={{ marginBottom: 8 }}>
              <button
                style={quietBtn}
                onClick={() =>
                  onOpenProperty(openItem.property_code, "variance")
                }
              >
                Open property
              </button>
            </div>
          )}
          {inlineError(openItem.id)}

          {isResolving && (
            <div
              style={{
                border: `1px solid ${border}`,
                borderRadius: 8,
                padding: 12,
                margin: "10px 0",
                background: subtle,
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
                {pendingResolution.status === "resolved"
                  ? "Resolve this item"
                  : "Accept this variance"}
              </div>
              <textarea
                style={{
                  ...inputStyle,
                  width: "100%",
                  minHeight: 64,
                  boxSizing: "border-box",
                  background: card,
                }}
                maxLength={NOTE_MAX_CHARS}
                placeholder={
                  pendingResolution.status === "resolved"
                    ? "Optional: what was done to address the variance"
                    : "Optional: why this variance is accepted"
                }
                value={pendingResolution.note}
                disabled={busy}
                onChange={(e) =>
                  setPendingResolution({
                    ...pendingResolution,
                    note: e.target.value,
                  })
                }
              />
              <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
                <button
                  style={primaryBtn(!busy)}
                  disabled={busy}
                  onClick={confirmResolution}
                >
                  {busy
                    ? "Closing..."
                    : pendingResolution.status === "resolved"
                      ? "Confirm resolve"
                      : "Confirm accept"}
                </button>
                <button
                  style={quietBtn}
                  disabled={busy}
                  onClick={() => setPendingResolution(null)}
                >
                  Cancel
                </button>
              </div>
              <div style={{ fontSize: 11, color: sub, marginTop: 6 }}>
                Closing is permanent - a later breach on this line opens a new
                item.
              </div>
            </div>
          )}

          <h3 style={{ fontSize: 13, fontWeight: 700, margin: "16px 0 6px" }}>
            History
          </h3>
          {events.loading && (
            <div style={{ color: sub, fontSize: 12.5 }} role="status">
              Loading history...
            </div>
          )}
          {!events.loading && events.error && (
            <div style={{ color: red, fontSize: 12.5 }}>
              Could not load the history.{" "}
              {events.error.message ? String(events.error.message) : ""}
            </div>
          )}
          {!events.loading && !events.error && events.rows.length === 0 && (
            <div style={{ color: sub, fontSize: 12.5 }}>
              No events recorded for this item yet.
            </div>
          )}
          {!events.loading &&
            !events.error &&
            events.rows.map((ev) => (
              <div
                key={ev.id}
                style={{
                  padding: "7px 0",
                  borderTop: `1px dashed ${border}`,
                  fontSize: 12,
                  color: sub,
                  lineHeight: 1.6,
                }}
              >
                <div>
                  <span style={{ color: text, fontWeight: 600 }}>
                    {EVENT_KIND_LABELS[ev.event_kind] || ev.event_kind}
                  </span>
                  {ev.from_status &&
                    ev.to_status &&
                    ev.from_status !== ev.to_status && (
                      <span>
                        {" "}
                        - {STATUS_LABELS[ev.from_status] ||
                          ev.from_status} to{" "}
                        {STATUS_LABELS[ev.to_status] || ev.to_status}
                      </span>
                    )}
                </div>
                {ev.note && (
                  <div style={{ color: text, whiteSpace: "pre-wrap" }}>
                    {ev.note}
                  </div>
                )}
                <div>
                  {ev.created_by == null
                    ? "system"
                    : assigneeName(ev.created_by) || "Team member"}
                  {" - "}
                  {String(ev.created_at).slice(0, 16).replace("T", " ")}
                </div>
              </div>
            ))}

          <div style={{ marginTop: 12 }}>
            <textarea
              style={{
                ...inputStyle,
                width: "100%",
                minHeight: 56,
                boxSizing: "border-box",
              }}
              maxLength={NOTE_MAX_CHARS}
              placeholder="Add a note to this item's history (append-only, attributed to you)"
              value={noteText}
              disabled={busy}
              onChange={(e) => setNoteText(e.target.value)}
            />
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                marginTop: 6,
              }}
            >
              <button
                style={primaryBtn(!busy && noteText.trim().length > 0)}
                disabled={busy || noteText.trim().length === 0}
                onClick={() => submitNote(openItem.id)}
              >
                {busy ? "Appending..." : "Append note"}
              </button>
              <span style={{ fontSize: 11, color: sub }}>
                {noteText.length}/{NOTE_MAX_CHARS}
              </span>
            </div>
          </div>
        </div>
      </>
    );
  };

  return (
    <div style={{ padding: 20, color: text }}>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 14,
        }}
      >
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 700, margin: 0 }}>
            Variance Review Queue
          </h1>
          <p
            style={{
              fontSize: 13,
              color: sub,
              margin: "4px 0 0",
              maxWidth: 720,
              lineHeight: 1.5,
            }}
          >
            Every red or orange budget breach the nightly variance evaluation
            flags opens a review item here. Pick an item up, work it, and close
            it as resolved or as an accepted variance - every step lands in the
            item's history. Items stay open until a person closes them, even if
            the flag later recovers.
          </p>
        </div>
        <button
          style={quietBtn}
          onClick={() => {
            loadItems();
            loadSummary();
          }}
          disabled={loading || refreshing}
        >
          {loading || refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {loading && (
        <div style={{ padding: 24, color: sub, fontSize: 14 }} role="status">
          Loading review queue...
        </div>
      )}
      {!loading && error && (
        <div
          style={{
            padding: 16,
            border: `1px solid ${red}`,
            borderRadius: 8,
            color: red,
            fontSize: 13,
          }}
        >
          Could not load the review queue.{" "}
          {error.message ? String(error.message) : ""}
        </div>
      )}

      {!loading && !error && (
        <>
          <div
            style={{
              display: "flex",
              gap: 12,
              flexWrap: "wrap",
              marginBottom: 14,
            }}
          >
            {[
              ["Open", summary.open],
              ["To review", summary.toReview],
              ["In review", summary.inReview],
              ["Red (open)", summary.redOpen],
              ["Orange (open)", summary.orangeOpen],
              ["Closed", summary.closed],
            ].map(([label, value]) => (
              <div
                key={label}
                style={{
                  background: card,
                  border: `1px solid ${border}`,
                  borderRadius: 8,
                  padding: "10px 16px",
                  minWidth: 96,
                }}
              >
                <div
                  style={{
                    fontSize: 19,
                    fontWeight: 700,
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {value}
                </div>
                <div style={{ fontSize: 11, color: sub }}>{label}</div>
              </div>
            ))}
          </div>

          {summaryError && (
            <div
              style={{
                padding: "10px 14px",
                border: `1px solid ${amber}`,
                borderRadius: 8,
                color: amber,
                fontSize: 12.5,
                marginBottom: 12,
                maxWidth: 720,
                lineHeight: 1.55,
              }}
            >
              The counts above could not be loaded, so they are not reliable
              right now. The items listed below are accurate.{" "}
              {summaryError.message ? String(summaryError.message) : ""}
            </div>
          )}

          {truncated && (
            <div
              style={{
                padding: "10px 14px",
                border: `1px solid ${amber}`,
                borderRadius: 8,
                color: amber,
                fontSize: 12.5,
                marginBottom: 12,
                maxWidth: 720,
                lineHeight: 1.55,
              }}
            >
              This view is showing the first {ITEM_FETCH_LIMIT.toLocaleString()}{" "}
              matching items and there are more. The counts above still cover
              every item in scope. Narrow the property, status, assignee or flag
              filter to see the rest.
            </div>
          )}

          <div
            style={{
              display: "flex",
              gap: 10,
              flexWrap: "wrap",
              alignItems: "flex-end",
              marginBottom: 12,
            }}
          >
            <label style={{ fontSize: 12, color: sub }}>
              Property
              <br />
              <select
                style={inputStyle}
                value={propertyFilter}
                onChange={(e) => setPropertyFilter(e.target.value)}
              >
                <option value="">All properties</option>
                {propertyOptions.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label style={{ fontSize: 12, color: sub }}>
              Status
              <br />
              <select
                style={inputStyle}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
              >
                <option value="open">Open (to review + in review)</option>
                <option value="to_review">To review</option>
                <option value="in_review">In review</option>
                <option value="resolved">Resolved</option>
                <option value="accepted_variance">Accepted variance</option>
                <option value="all">All</option>
              </select>
            </label>
            <label style={{ fontSize: 12, color: sub }}>
              Assignee
              <br />
              <select
                style={inputStyle}
                value={assigneeFilter}
                onChange={(e) => setAssigneeFilter(e.target.value)}
              >
                <option value="anyone">Anyone</option>
                <option value="unassigned">Unassigned</option>
                {currentUserId && <option value="me">Me</option>}
                {users
                  .filter((u) => u.id !== currentUserId)
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.label}
                    </option>
                  ))}
              </select>
            </label>
            <label style={{ fontSize: 12, color: sub }}>
              Flag
              <br />
              <select
                style={inputStyle}
                value={flagFilter}
                onChange={(e) => setFlagFilter(e.target.value)}
              >
                <option value="all">All</option>
                <option value="red">Red (material)</option>
                <option value="orange">Orange (review)</option>
              </select>
            </label>
            {usersError && (
              <span style={{ fontSize: 11.5, color: amber }}>
                Assignee list could not be loaded - assignment is unavailable
                until it refreshes.
              </span>
            )}
          </div>

          {emptySelection && (
            <div
              style={{
                padding: 24,
                border: `1px dashed ${border}`,
                borderRadius: 8,
                color: sub,
                fontSize: 13.5,
                lineHeight: 1.6,
                maxWidth: 720,
              }}
            >
              No properties selected. Pick one or more properties in the scope
              selector above to see their open review items.
            </div>
          )}
          {!emptySelection && nothingInScope && (
            <div
              style={{
                padding: 24,
                border: `1px dashed ${border}`,
                borderRadius: 8,
                color: sub,
                fontSize: 13.5,
                lineHeight: 1.6,
                maxWidth: 720,
              }}
            >
              No review items yet. Items are opened by the nightly variance
              evaluation: when a property's actuals breach the budget
              materiality thresholds (a red group-level breach or an orange
              offsetting-account breach), a review item appears here the next
              morning. A quiet queue means no property is currently over its
              thresholds - the underlying variance detail lives on each
              property's Budget Analysis tab.
            </div>
          )}
          {!emptySelection && nothingMatches && (
            <div
              style={{
                padding: 24,
                border: `1px dashed ${border}`,
                borderRadius: 8,
                color: sub,
                fontSize: 13.5,
                maxWidth: 720,
              }}
            >
              No items match the current filters.
              {summaryError
                ? ""
                : ` ${summary.open} open and ${summary.closed} closed item(s) exist -`}{" "}
              widen the status, property, assignee, or flag filter to see them.
            </div>
          )}

          {visibleItems.length > 0 && (
            <div
              style={{
                overflowX: "auto",
                border: `1px solid ${border}`,
                borderRadius: 8,
              }}
            >
              <table
                style={{
                  width: "100%",
                  borderCollapse: "collapse",
                  background: card,
                }}
              >
                <thead style={{ background: subtle }}>
                  <tr>
                    <th style={th}>Property</th>
                    <th style={th}>Account</th>
                    <th style={th}>Month</th>
                    <th style={th}>Flag</th>
                    <th style={thNum}>% at open</th>
                    <th style={th}>Status</th>
                    <th style={th}>Assignee</th>
                    <th style={thNum}>Age</th>
                    <th style={th}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {renderedItems.map((item) => {
                    const acct = itemAccountLabel(item);
                    const age = ageDays(item.created_at);
                    const terminal = isTerminalStatus(item.status);
                    return (
                      <tr
                        key={item.id}
                        onClick={() => openDetail(item.id)}
                        style={{
                          cursor: "pointer",
                          background:
                            openItemId === item.id ? subtle : undefined,
                        }}
                      >
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {item.property_code}
                          {typeof onOpenProperty === "function" && (
                            <button
                              style={{
                                ...quietBtn,
                                marginLeft: 8,
                                fontSize: 11,
                                padding: "2px 7px",
                              }}
                              onClick={(e) => {
                                e.stopPropagation();
                                onOpenProperty(item.property_code, "variance");
                              }}
                              title="Open this property's Budget Analysis tab"
                            >
                              Open property
                            </button>
                          )}
                        </td>
                        <td style={td}>
                          {acct.label}
                          {acct.isGroup && groupPill}
                          {item.flag_cleared_at != null && flagClearedBadge}
                        </td>
                        <td style={{ ...td, whiteSpace: "nowrap" }}>
                          {formatMonthEnd(item.month_end)}
                        </td>
                        <td style={td}>{flagPill(item.flag_at_open)}</td>
                        <td style={tdNum}>
                          {formatPercent(item.pct_at_open, { signed: true })}
                        </td>
                        <td style={td}>{statusPill(item.status)}</td>
                        <td
                          style={{
                            ...td,
                            color: item.assigned_to ? text : sub,
                          }}
                        >
                          {assigneeName(item.assigned_to) || "Unassigned"}
                        </td>
                        <td style={tdNum}>{age == null ? EMPTY : `${age}d`}</td>
                        <td style={td} onClick={(e) => e.stopPropagation()}>
                          {terminal ? (
                            <span style={{ fontSize: 11.5, color: sub }}>
                              Closed
                            </span>
                          ) : (
                            <div
                              style={{
                                display: "flex",
                                gap: 6,
                                flexWrap: "wrap",
                                alignItems: "center",
                              }}
                            >
                              {assignSelect(item)}
                              {transitionButtons(item)}
                            </div>
                          )}
                          {inlineError(item.id)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {visibleItems.length > renderedItems.length && (
            <div
              style={{
                display: "flex",
                gap: 10,
                alignItems: "center",
                marginTop: 10,
              }}
            >
              <button
                style={quietBtn}
                onClick={() => setShownCount((n) => n + RENDER_PAGE_SIZE)}
              >
                Show{" "}
                {Math.min(
                  RENDER_PAGE_SIZE,
                  visibleItems.length - renderedItems.length,
                )}{" "}
                more
              </button>
              <span style={{ fontSize: 11.5, color: sub }}>
                Showing {renderedItems.length.toLocaleString()} of{" "}
                {visibleItems.length.toLocaleString()} matching items.
              </span>
            </div>
          )}
        </>
      )}

      {detailPanel()}
    </div>
  );
}

export function VarianceReviewQueueTenant({
  selectedProperties = [],
  scopeVersion = 0,
  C,
  userProfile,
  onOpenProperty = null,
} = {}) {
  const codes = useMemo(
    () => selectedProperties.map((p) => p.code).filter(Boolean),
    [scopeVersion],
  );
  const openByCode = useCallback(
    (code) => {
      if (!onOpenProperty) return;
      const hit = selectedProperties.find((p) => p.code === code);
      if (hit && hit.name) onOpenProperty(hit.name);
    },
    [selectedProperties, onOpenProperty],
  );
  return (
    <VarianceReviewQueuePage
      C={C}
      userProfile={userProfile}
      propertyCodes={codes}
      onOpenProperty={openByCode}
    />
  );
}
