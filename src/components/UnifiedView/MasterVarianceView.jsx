import React, { useEffect, useMemo, useState } from "react";
import {
  fetchBudgetVarianceSet,
  buildScopeCoverage,
} from "../../lib/unifiedViewLoaders.js";
import {
  fetchPlatformSettings,
  downloadCSV,
} from "../../lib/supabaseClient.js";
import { resolveVarianceAlertConfig } from "../../lib/varianceAlertConfig.js";
import { classifyMateriality } from "../../lib/varianceMateriality.js";
import {
  partitionByActivity,
  budgetVarianceRowHasActivity,
  isNoActivityDivider,
  withNoActivitySection,
  readShowNoActivity,
  writeShowNoActivity,
} from "../../lib/varianceRowActivity.js";
import NoActivityDisclosureRow from "../variance/NoActivityDisclosureRow.jsx";
import { isBalanceClassAccount } from "../../lib/glAccountClass.js";
import { isFavorable } from "../../lib/budgetVariance.js";
import {
  formatCurrencyFull,
  formatPercent,
  EMPTY,
} from "../../lib/numberFormat.js";
import { T } from "../../lib/theme.js";

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

export function formatMonthYear(isoDate) {
  if (typeof isoDate !== "string") return null;
  const m = isoDate.match(/^(\d{4})-(\d{2})/);
  if (!m) return null;
  const monthIdx = Number(m[2]) - 1;
  if (monthIdx < 0 || monthIdx > 11) return null;
  return `${MONTH_NAMES[monthIdx]} ${m[1]}`;
}

export function buildScopeCoverageNotice(coverage) {
  if (!coverage || !Array.isArray(coverage.unregistered)) return null;
  const count = coverage.unregistered.length;
  if (count === 0) return null;
  const names = coverage.unregistered.map((p) => p.name).join(", ");
  const isOne = count === 1;
  if (coverage.verified !== true) {
    return {
      verified: false,
      count,
      text:
        `Coverage of this portfolio could not be verified: the entity matrix that classifies ` +
        `properties did not load, so this page cannot say whether the ${count} ` +
        `${isOne ? "property" : "properties"} it could not compare ` +
        `(${names}) ${isOne ? "is" : "are"} out of scope or missing a registered budget. ` +
        `It compares the ${coverage.inScopeCount} ` +
        `${coverage.inScopeCount === 1 ? "property" : "properties"} the Budget Module has registered.`,
    };
  }
  const reportable = coverage.inScopeCount + count;
  const aop = Number(coverage.aopExcludedCount) || 0;
  return {
    verified: true,
    count,
    text:
      `${count} of ${reportable} properties in this portfolio ${isOne ? "was" : "were"} ` +
      `not examined: no budget is registered for ${isOne ? "it" : "them"} in the Budget Module, so there ` +
      `is nothing to compare actuals against. Not examined: ${names}.` +
      (aop > 0
        ? ` (${aop} further ${aop === 1 ? "entity is" : "entities are"} classified as AOP and excluded ` +
          `from real-property reporting by design.)`
        : ""),
  };
}

export function formatRefreshTimestamp(iso) {
  if (typeof iso !== "string" || !iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const month = MONTH_NAMES[d.getMonth()];
  const mins = String(d.getMinutes()).padStart(2, "0");
  return `${month} ${d.getDate()}, ${d.getHours()}:${mins}`;
}

export const VARIANCE_CSV_HEADERS = [
  "Property",
  "Bucket",
  "Account",
  "Account Name",
  "Budget",
  "Actual",
  "Variance",
  "Pct Variance",
  "Flag",
];

export function buildVarianceCsvRows(blocks) {
  const out = [];
  for (const b of blocks || []) {
    const comparable = b.comparable !== false;
    for (const g of b.groups || []) {
      const bucket = g.noi_build_bucket || "Unmapped";
      for (const a of g.accounts || []) {
        out.push([
          b.name,
          bucket,
          a.account_number,
          a.account_name || "",
          a.budget,
          comparable ? a.actual : "",
          comparable ? a.variance : "",
          comparable && a.pct != null ? a.pct : "",
          a.flag || "",
        ]);
      }
    }
  }
  return out;
}

function stripFlags(groups) {
  return (groups || []).map((g) => ({
    ...g,
    flag: null,
    accounts: (g.accounts || []).map((a) => ({ ...a, flag: null })),
  }));
}

export function buildPropertyBlock(property, rows, meta, thresholds) {
  const cls = classifyMateriality(rows, thresholds);
  const sectionByBucket = new Map();
  const sectionByAccount = new Map();
  for (const r of rows || []) {
    if (!r) continue;
    if (
      r.noi_build_bucket != null &&
      r.noi_section != null &&
      !sectionByBucket.has(r.noi_build_bucket)
    ) {
      sectionByBucket.set(r.noi_build_bucket, r.noi_section);
    }
    if (
      r.account_number != null &&
      r.noi_section != null &&
      !sectionByAccount.has(r.account_number)
    ) {
      sectionByAccount.set(r.account_number, r.noi_section);
    }
  }
  const actualsThroughKnown = meta?.actualsThroughKnown !== false;
  const comparable = actualsThroughKnown || (rows || []).length === 0;
  if (!comparable) {
    return {
      code: property.code,
      name: property.name,
      hasData: (rows || []).length > 0,
      comparable: false,
      actualsThrough: meta?.actualsThrough ?? null,
      actualsThroughKnown: false,
      dataRefreshedAt: meta?.dataRefreshedAt ?? null,
      groups: stripFlags(cls.groups),
      sectionByBucket,
      sectionByAccount,
      materialCount: 0,
      reviewCount: 0,
      worstPct: 0,
    };
  }

  const materialGroups = cls.groups.filter((g) => g.flag === "red");
  const reviewAccounts = cls.groups
    .filter((g) => g.flag !== "red")
    .flatMap((g) => g.accounts.filter((a) => a.flag === "orange"));
  const pctPool = (materialGroups.length ? materialGroups : cls.groups)
    .map((g) => (g.pct == null ? null : Math.abs(g.pct)))
    .filter((v) => v != null);
  const worstPct = pctPool.length ? Math.max(...pctPool) : 0;
  return {
    code: property.code,
    name: property.name,
    hasData: (rows || []).length > 0,
    comparable: true,
    actualsThrough: meta?.actualsThrough ?? null,
    actualsThroughKnown,
    dataRefreshedAt: meta?.dataRefreshedAt ?? null,
    groups: cls.groups,
    sectionByBucket,
    sectionByAccount,
    materialCount: materialGroups.length,
    reviewCount: reviewAccounts.length,
    worstPct,
  };
}

export function sortPropertyBlocks(blocks) {
  const tier = (b) => {
    if (!b.hasData) return 4;
    if (b.comparable === false) return 3;
    if (b.materialCount > 0) return 0;
    if (b.reviewCount > 0) return 1;
    return 2;
  };
  return [...(blocks || [])].sort((a, b) => {
    const t = tier(a) - tier(b);
    if (t !== 0) return t;
    if (b.worstPct !== a.worstPct) return b.worstPct - a.worstPct;
    return String(a.name).localeCompare(String(b.name));
  });
}

export default function MasterVarianceView({
  selectedProperties = [],
  scopeVersion = 0,
  C = {},
  userProfile: _userProfile = null,
  onOpenProperty,
} = {}) {
  const text = C.textPrimary || C.text || T.textPrimary;
  const sub = C.textSecondary || T.textSecondary;
  const border = C.border || T.border;
  const card = C.card || C.cardBg || T.surface;
  const subtle = C.subtleBg || T.inset;
  const red = C.red || T.dangerText;
  const green = C.green || T.successText;
  const amber = C.amber || C.warning || T.warningText;
  const redChipBg = C.dangerBg || T.dangerBg;
  const amberChipBg = C.warningBg || T.warningBg;

  const [loading, setLoading] = useState(false);
  const [loadedCodes, setLoadedCodes] = useState(() => new Set());
  const [showBalanceSheet, setShowBalanceSheet] = useState(false);
  const [error, setError] = useState(null);
  const [rows, setRows] = useState([]);
  const [metaByProperty, setMetaByProperty] = useState({});
  const [retryNonce, setRetryNonce] = useState(0);
  const [coverage, setCoverage] = useState(null);
  const [showClean, setShowClean] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set());
  const [showNoActivity, setShowNoActivity] = useState(readShowNoActivity);
  const toggleNoActivity = () =>
    setShowNoActivity((prev) => {
      writeShowNoActivity(!prev);
      return !prev;
    });

  useEffect(() => {
    let alive = true;
    buildScopeCoverage()
      .then((c) => {
        if (alive) setCoverage(c || null);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const [alertConfig, setAlertConfig] = useState(() =>
    resolveVarianceAlertConfig(null),
  );
  useEffect(() => {
    let alive = true;
    fetchPlatformSettings()
      .then((r) => {
        if (alive) setAlertConfig(resolveVarianceAlertConfig(r?.settings));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!selectedProperties.length) {
      setRows([]);
      setMetaByProperty({});
      setError(null);
      setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setError(null);
    setExpanded(new Set());
    setRows([]);
    setMetaByProperty({});
    setLoadedCodes(new Set());
    fetchBudgetVarianceSet(
      selectedProperties.map((p) => p.code),
      {
        onChunk: (chunk) => {
          if (!alive || chunk.error) return;
          if (chunk.rows.length) {
            setRows((prev) => [...prev, ...chunk.rows]);
            setMetaByProperty((prev) => ({ ...prev, ...chunk.metaByProperty }));
          }
          setLoadedCodes((prev) => new Set([...prev, ...chunk.chunkCodes]));
        },
      },
    )
      .then((res) => {
        if (!alive) return;
        if (res?.error) {
          setError(res.error);
        } else {
          setRows(res?.data || []);
          setMetaByProperty(res?.metaByProperty || {});
        }
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [scopeVersion, retryNonce]);

  const thresholds = useMemo(
    () => ({
      groupPctThreshold: alertConfig.groupPctThreshold,
      accountPctThreshold: alertConfig.accountPctThreshold,
    }),
    [alertConfig],
  );

  const scopedRows = useMemo(
    () =>
      showBalanceSheet
        ? rows
        : rows.filter((r) => !isBalanceClassAccount(r?.account_number)),
    [rows, showBalanceSheet],
  );

  const blocks = useMemo(() => {
    const byCode = new Map();
    for (const r of scopedRows) {
      if (!r || r.property_code == null) continue;
      let list = byCode.get(r.property_code);
      if (!list) {
        list = [];
        byCode.set(r.property_code, list);
      }
      list.push(r);
    }
    return sortPropertyBlocks(
      selectedProperties.map((p) =>
        buildPropertyBlock(
          p,
          byCode.get(p.code) || [],
          metaByProperty[p.code],
          thresholds,
        ),
      ),
    );
  }, [scopedRows, metaByProperty, selectedProperties, thresholds]);

  const groupSplitByCode = useMemo(() => {
    const by = new Map();
    for (const b of blocks) {
      const entries = (b.groups || []).map((g, gi) => ({ g, gi }));
      by.set(
        b.code,
        partitionByActivity(entries, {
          hasActivity: (e) => budgetVarianceRowHasActivity(e.g),
        }),
      );
    }
    return by;
  }, [blocks]);

  const coverageNotice = useMemo(
    () => buildScopeCoverageNotice(coverage),
    [coverage],
  );

  const summary = useMemo(() => {
    const scoped = loading
      ? blocks.filter((b) => loadedCodes.has(b.code))
      : blocks;
    const withData = scoped.filter((b) => b.hasData);
    const classified = withData.filter((b) => b.comparable !== false);
    return {
      inScope: blocks.length,
      material: classified.filter((b) => b.materialCount > 0).length,
      reviewOnly: classified.filter(
        (b) => b.materialCount === 0 && b.reviewCount > 0,
      ).length,
      clean: classified.filter(
        (b) => b.materialCount === 0 && b.reviewCount === 0,
      ).length,
      noActuals: withData.length - classified.length,
      noData: scoped.length - withData.length,
    };
  }, [blocks, loading, loadedCodes]);

  const groupSplit = (code) =>
    groupSplitByCode.get(code) || { active: [], inactive: [] };

  const varColor = (variance, section) => {
    const fav = isFavorable(variance, section);
    if (fav === null) return text;
    return fav ? green : red;
  };

  const flagChip = (flag) => {
    if (flag !== "red" && flag !== "orange") return null;
    const isRed = flag === "red";
    return (
      <span
        title={
          isRed
            ? `Material: account-group variance exceeds the ${alertConfig.groupPctThreshold}% threshold`
            : `Material: account variance exceeds ${alertConfig.accountPctThreshold}% inside an on-track group (offsetting line)`
        }
        style={{
          display: "inline-block",
          marginLeft: 8,
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

  const toggleGroup = (key) => {
    setExpanded((cur) => {
      const next = new Set(cur);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleExportCsv = () => {
    try {
      downloadCSV(
        `master-variance_${new Date().toISOString().slice(0, 10)}.csv`,
        VARIANCE_CSV_HEADERS,
        buildVarianceCsvRows(blocks.filter((b) => b.hasData)),
      );
    } catch (err) {
      console.error("Master variance CSV export failed:", err);
    }
  };

  const th = {
    textAlign: "left",
    padding: "7px 10px",
    fontSize: 12,
    color: sub,
    fontWeight: 600,
    borderBottom: `1px solid ${border}`,
    whiteSpace: "nowrap",
  };
  const thNum = { ...th, textAlign: "right" };
  const td = {
    padding: "6px 10px",
    fontSize: 13,
    color: text,
    borderBottom: `1px solid ${border}`,
  };
  const tdNum = {
    ...td,
    textAlign: "right",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  };

  if (!selectedProperties.length) {
    return (
      <div
        style={{
          padding: 20,
          border: `1px dashed ${border}`,
          borderRadius: 8,
          color: sub,
          fontSize: 13,
          maxWidth: 560,
        }}
      >
        No properties selected. Choose a set with the scope picker above —
        variance for every selected property renders here, grouped by property
        and flagged where it deviates from budget in either direction.
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          padding: 16,
          border: `1px solid ${red}`,
          borderRadius: 8,
          fontSize: 13,
          maxWidth: 640,
        }}
      >
        <div style={{ color: red, fontWeight: 600, marginBottom: 4 }}>
          Could not load variance for the selected set.
        </div>
        <div style={{ color: sub, marginBottom: 10 }}>
          {error?.message ? String(error.message) : String(error)}
        </div>
        <button
          type="button"
          onClick={() => setRetryNonce((n) => n + 1)}
          style={{
            padding: "6px 14px",
            borderRadius: 6,
            border: `1px solid ${border}`,
            background: card,
            color: text,
            cursor: "pointer",
            fontSize: 12,
            fontWeight: 600,
          }}
        >
          Retry
        </button>
      </div>
    );
  }

  const noDataAtAll = blocks.every((b) => !b.hasData);
  if (noDataAtAll && !loading) {
    return (
      <div
        style={{
          padding: 24,
          border: `1px dashed ${border}`,
          borderRadius: 8,
          color: sub,
          fontSize: 14,
          maxWidth: 640,
        }}
      >
        None of the selected properties have a sealed budget snapshot to compare
        against. Seal a snapshot of each approved budget first; variance
        compares live GL actuals against it.
      </div>
    );
  }

  const loadedBlocks = loading
    ? blocks.filter((b) => loadedCodes.has(b.code))
    : blocks;
  const pendingProperties = loading
    ? selectedProperties.filter((p) => !loadedCodes.has(p.code))
    : [];

  const cleanBlocks = loadedBlocks.filter(
    (b) =>
      b.hasData &&
      b.comparable !== false &&
      b.materialCount === 0 &&
      b.reviewCount === 0,
  );
  const visibleBlocks = loadedBlocks.filter((b) => {
    if (!b.hasData) return true;
    if (b.comparable === false) return true;
    if (b.materialCount > 0 || b.reviewCount > 0) return true;
    return showClean;
  });

  return (
    <div>
      {loading && (
        <div
          role="status"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            color: sub,
            marginBottom: 12,
          }}
        >
          <span
            aria-hidden="true"
            style={{
              width: 10,
              height: 10,
              borderRadius: "50%",
              border: `2px solid ${border}`,
              borderTopColor: text,
              display: "inline-block",
              animation: "uvspin 0.9s linear infinite",
            }}
          />
          <style>
            {"@keyframes uvspin { to { transform: rotate(360deg); } }"}
          </style>
          Loading variance — {loadedCodes.size} of {selectedProperties.length}{" "}
          properties loaded.
          {loadedCodes.size === 0
            ? " Large selections load in batches of 10; first results land shortly."
            : " Remaining properties fill in below as their batch returns."}
        </div>
      )}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))",
          gap: 12,
          marginBottom: 12,
        }}
      >
        {[
          { label: "Properties in scope", value: summary.inScope },
          {
            label: "Flagged material",
            value: summary.material,
            color: summary.material > 0 ? red : undefined,
          },
          {
            label: "Review only",
            value: summary.reviewOnly,
            color: summary.reviewOnly > 0 ? amber : undefined,
          },
          { label: "Clean", value: summary.clean },
        ].map((s) => (
          <div
            key={s.label}
            style={{
              background: card,
              border: `1px solid ${border}`,
              borderRadius: 8,
              padding: "10px 14px",
            }}
          >
            <div style={{ fontSize: 12, color: sub }}>{s.label}</div>
            <div
              style={{
                fontSize: 19,
                fontWeight: 700,
                marginTop: 2,
                color: s.color || text,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {s.value}
            </div>
          </div>
        ))}
      </div>

      {coverageNotice && (
        <p
          data-testid="scope-coverage-notice"
          style={{
            fontSize: 12,
            color: coverageNotice.verified ? amber : sub,
            margin: "0 0 10px",
          }}
        >
          {coverageNotice.text}
        </p>
      )}

      {summary.noActuals > 0 && (
        <p style={{ fontSize: 12, color: amber, margin: "0 0 10px" }}>
          {summary.noActuals} of {summary.inScope} selected{" "}
          {summary.noActuals === 1 ? "property has" : "properties have"} a
          sealed budget but no GL actuals to compare against, so{" "}
          {summary.noActuals === 1 ? "it is" : "they are"} neither flagged nor
          counted as clean — their budget against a zero actual would report a
          shortfall nobody measured.
        </p>
      )}

      {summary.noData > 0 && (
        <p style={{ fontSize: 12, color: sub, margin: "0 0 10px" }}>
          {summary.noData} of {summary.inScope} selected{" "}
          {summary.noData === 1 ? "property has" : "properties have"} no sealed
          budget snapshot to compare;{" "}
          {summary.noData === 1 ? "it is" : "they are"} listed below without
          numbers.
        </p>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: 12,
          margin: "0 0 10px",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
            fontSize: 11,
            color: sub,
          }}
        >
          <span>
            {flagChip("red")} build-bucket group off &gt;
            {alertConfig.groupPctThreshold}%
          </span>
          <span>
            {flagChip("orange")} offsetting account &gt;
            {alertConfig.accountPctThreshold}% within an on-track group
          </span>
          <span>
            Flags are magnitude-based (over and under both flag); the number
            color shows over/under favorability.
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: sub,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={showClean}
              onChange={(e) => setShowClean(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            Show clean properties
          </label>
          <label
            title="Balance-sheet accounts (1/2/3xxxx) are excluded by default, matching the single-property variance page — unbudgeted cash movement otherwise flags every property"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              fontSize: 12,
              color: sub,
              cursor: "pointer",
              userSelect: "none",
            }}
          >
            <input
              type="checkbox"
              checked={showBalanceSheet}
              onChange={(e) => setShowBalanceSheet(e.target.checked)}
              style={{ cursor: "pointer" }}
            />
            Show balance-sheet accounts
          </label>
          <button
            type="button"
            onClick={handleExportCsv}
            title="Download the current scope's variance rows as a CSV"
            style={{
              padding: "6px 14px",
              borderRadius: 6,
              border: `1px solid ${border}`,
              background: card,
              color: text,
              cursor: "pointer",
              fontSize: 12,
              fontWeight: 600,
            }}
          >
            Export CSV
          </button>
        </div>
      </div>

      {!showClean && cleanBlocks.length > 0 && (
        <div
          style={{
            padding: "8px 14px",
            background: card,
            border: `1px solid ${border}`,
            borderRadius: 8,
            marginBottom: 12,
            fontSize: 13,
            color: sub,
          }}
        >
          {cleanBlocks.length}{" "}
          {cleanBlocks.length === 1 ? "property is" : "properties are"} on track
          — no material groups, no review accounts.
        </div>
      )}

      {visibleBlocks.map((b) => (
        <div
          key={b.code}
          style={{
            background: card,
            border: `1px solid ${border}`,
            borderRadius: 8,
            marginBottom: 12,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              flexWrap: "wrap",
              gap: 8,
              padding: "10px 14px",
              borderBottom: b.hasData ? `1px solid ${border}` : "none",
            }}
          >
            <div>
              <button
                type="button"
                onClick={() => onOpenProperty && onOpenProperty(b.name)}
                title={`Open ${b.name}`}
                style={{
                  background: "transparent",
                  border: "none",
                  padding: 0,
                  cursor: "pointer",
                  fontSize: 15,
                  fontWeight: 700,
                  color: text,
                  textAlign: "left",
                }}
              >
                {b.name}
              </button>
              <div style={{ fontSize: 12, color: sub, marginTop: 2 }}>
                {!b.hasData ? (
                  "No sealed budget snapshot — nothing to compare yet."
                ) : b.comparable === false ? (
                  "No GL actuals for this property — its budget is not compared, so nothing is flagged."
                ) : b.materialCount > 0 || b.reviewCount > 0 ? (
                  <>
                    {b.materialCount > 0 && (
                      <span style={{ color: red, fontWeight: 600 }}>
                        {b.materialCount} material{" "}
                        {b.materialCount === 1 ? "group" : "groups"}
                      </span>
                    )}
                    {b.materialCount > 0 && b.reviewCount > 0 && ", "}
                    {b.reviewCount > 0 && (
                      <span style={{ color: amber, fontWeight: 600 }}>
                        {b.reviewCount} review{" "}
                        {b.reviewCount === 1 ? "account" : "accounts"}
                      </span>
                    )}
                  </>
                ) : (
                  "On track — no material or review flags"
                )}
              </div>
            </div>
            {b.hasData && (
              <div style={{ fontSize: 12, color: sub, textAlign: "right" }}>
                {b.actualsThrough && b.actualsThroughKnown && (
                  <span>
                    Actuals through{" "}
                    {formatMonthYear(b.actualsThrough) || b.actualsThrough}
                  </span>
                )}
                {!b.actualsThroughKnown && (
                  <span style={{ color: amber }}>
                    Actuals coverage unverified — no GL actuals found for this
                    property, so the comparison window falls back to the
                    calendar bound.
                  </span>
                )}
                {b.dataRefreshedAt && (
                  <span title="This view reads cached actuals, refreshed on ingest and on a 6-hour cycle. The single-property variance page reads live data.">
                    {" "}
                    · Data as of{" "}
                    {formatRefreshTimestamp(b.dataRefreshedAt) ||
                      b.dataRefreshedAt}
                  </span>
                )}
              </div>
            )}
          </div>

          {b.hasData && (
            <table style={{ width: "100%", borderCollapse: "collapse" }}>
              <thead style={{ background: subtle }}>
                <tr>
                  <th style={th}>Group</th>
                  <th style={thNum}>Budget</th>
                  <th style={thNum}>Actual</th>
                  <th style={thNum}>Variance</th>
                  <th style={thNum}>%</th>
                </tr>
              </thead>
              <tbody>
                {withNoActivitySection(
                  groupSplit(b.code).active,
                  groupSplit(b.code).inactive,
                  showNoActivity,
                ).map((entry) => {
                  if (isNoActivityDivider(entry)) {
                    return (
                      <NoActivityDisclosureRow
                        key="__no_activity__"
                        count={groupSplit(b.code).inactive.length}
                        open={showNoActivity}
                        onToggle={toggleNoActivity}
                        colSpan={5}
                        noun="group"
                        theme={{ text, sub, border, subtle }}
                      />
                    );
                  }
                  const { g, gi } = entry;
                  const key = `${b.code}|${gi}`;
                  const isOpen = expanded.has(key);
                  const bucketLabel =
                    g.noi_build_bucket ||
                    (g.accounts.length === 1
                      ? `${g.accounts[0].account_number}${g.accounts[0].account_name ? ` · ${g.accounts[0].account_name}` : ""}`
                      : "Unmapped");
                  const gSection = g.noi_build_bucket
                    ? b.sectionByBucket.get(g.noi_build_bucket)
                    : b.sectionByAccount.get(g.accounts[0]?.account_number);
                  return (
                    <React.Fragment key={key}>
                      <tr
                        onClick={() => toggleGroup(key)}
                        style={{
                          cursor: "pointer",
                          background: isOpen ? subtle : undefined,
                        }}
                      >
                        <td style={td}>
                          {isOpen ? "▾" : "▸"} {bucketLabel}
                          {flagChip(g.flag)}
                        </td>
                        <td style={tdNum}>{formatCurrencyFull(g.budget)}</td>
                        <td style={tdNum}>
                          {b.comparable === false
                            ? EMPTY
                            : formatCurrencyFull(g.actual)}
                        </td>
                        <td
                          style={{
                            ...tdNum,
                            color:
                              b.comparable === false
                                ? sub
                                : varColor(g.variance, gSection),
                            fontWeight: 600,
                          }}
                        >
                          {b.comparable === false
                            ? EMPTY
                            : formatCurrencyFull(g.variance)}
                        </td>
                        <td style={tdNum}>
                          {b.comparable === false || g.pct == null
                            ? EMPTY
                            : formatPercent(g.pct, { signed: true })}
                        </td>
                      </tr>
                      {isOpen &&
                        g.accounts.map((a) => (
                          <tr key={`${key}|${a.account_number}`}>
                            <td style={{ ...td, paddingLeft: 28, color: sub }}>
                              {a.account_number}
                              {a.account_name ? ` · ${a.account_name}` : ""}
                              {flagChip(a.flag)}
                            </td>
                            <td style={tdNum}>
                              {formatCurrencyFull(a.budget)}
                            </td>
                            <td style={tdNum}>
                              {b.comparable === false
                                ? EMPTY
                                : formatCurrencyFull(a.actual)}
                            </td>
                            <td
                              style={{
                                ...tdNum,
                                color:
                                  b.comparable === false
                                    ? sub
                                    : varColor(
                                        a.variance,
                                        b.sectionByAccount.get(
                                          a.account_number,
                                        ),
                                      ),
                              }}
                            >
                              {b.comparable === false
                                ? EMPTY
                                : formatCurrencyFull(a.variance)}
                            </td>
                            <td style={tdNum}>
                              {b.comparable === false || a.pct == null
                                ? EMPTY
                                : formatPercent(a.pct, { signed: true })}
                            </td>
                          </tr>
                        ))}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      ))}

      {pendingProperties.map((p) => (
        <div
          key={p.code}
          data-testid={`variance-skeleton-${p.code}`}
          style={{
            background: card,
            border: `1px solid ${border}`,
            borderRadius: 8,
            marginBottom: 12,
            padding: "10px 14px",
            opacity: 0.75,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, color: sub }}>
            {p.name}
          </div>
          <div aria-hidden="true" style={{ marginTop: 8 }}>
            <div
              style={{
                height: 10,
                width: "42%",
                background: border,
                borderRadius: 4,
                marginBottom: 6,
              }}
            />
            <div
              style={{
                height: 10,
                width: "63%",
                background: border,
                borderRadius: 4,
              }}
            />
          </div>
          <div style={{ fontSize: 11, color: sub, marginTop: 8 }}>
            Waiting for this property's batch…
          </div>
        </div>
      ))}
    </div>
  );
}
