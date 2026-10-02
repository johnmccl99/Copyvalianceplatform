import {
  ITEMIZED_CATEGORIES,
  FREQUENCY_VALUES,
} from "./_budget-workbook-parser.js";

export const ITEMIZED_FIELD_ELIGIBILITY = Object.freeze({
  amount: Object.freeze({
    status: "opt_in_with_warning",
    numeric: "live",
    type: "number",
    dollar: true,
  }),
  frequency: Object.freeze({
    status: "opt_in_with_warning",
    numeric: "live",
    type: "frequency",
    dollar: false,
  }),
  first_month: Object.freeze({
    status: "opt_in_with_warning",
    numeric: "live",
    type: "date",
    dollar: false,
  }),
  last_month: Object.freeze({
    status: "opt_in_with_warning",
    numeric: "live",
    type: "date",
    dollar: false,
  }),
  growth: Object.freeze({ status: "excluded", reason: "v2_metadata_only" }),
  adjustments: Object.freeze({
    status: "excluded",
    reason: "v2_metadata_only",
  }),
  active_beds_pct: Object.freeze({
    status: "excluded",
    reason: "v2_metadata_only",
  }),
  increase_frequency: Object.freeze({
    status: "excluded",
    reason: "v2_metadata_only",
  }),
  increase_interval_months: Object.freeze({
    status: "excluded",
    reason: "v2_metadata_only",
  }),
  line_description: Object.freeze({ status: "excluded", reason: "identity" }),
  data_source: Object.freeze({ status: "excluded", reason: "identity" }),
  reference: Object.freeze({ status: "excluded", reason: "identity" }),
  function_2: Object.freeze({ status: "excluded", reason: "identity" }),
  category_label: Object.freeze({ status: "excluded", reason: "identity" }),
  account_number: Object.freeze({ status: "excluded", reason: "identity" }),
  noi_build_bucket: Object.freeze({ status: "excluded", reason: "identity" }),
});

export const PDPQ_FIELD_ELIGIBILITY = Object.freeze({
  assumption_value: Object.freeze({
    status: "opt_in_with_warning",
    numeric: "metadata_only",
    type: "number",
    dollar: false,
  }),
});

export const PROPAGATABLE_FIELDS = Object.freeze({
  itemized: Object.freeze(
    Object.keys(ITEMIZED_FIELD_ELIGIBILITY).filter(
      (f) => ITEMIZED_FIELD_ELIGIBILITY[f].status !== "excluded",
    ),
  ),
  pdpq: Object.freeze(
    Object.keys(PDPQ_FIELD_ELIGIBILITY).filter(
      (f) => PDPQ_FIELD_ELIGIBILITY[f].status !== "excluded",
    ),
  ),
});

export const CHANGE_SET_MAX_CHANGES = 50;
export const CHANGE_SET_NAME_MAX = 200;
export const MATCH_STRING_MAX = 300;

function isPlainObject(v) {
  return v != null && typeof v === "object" && !Array.isArray(v);
}

function cleanStr(v) {
  return typeof v === "string" ? v.trim() : "";
}

function validateValue(field, spec, newValue, path, errors) {
  if (newValue === null || newValue === undefined || newValue === "") {
    if (field === "last_month" && newValue === null) return;
    errors.push(`${path}: new_value is required for field "${field}"`);
    return;
  }
  if (spec.type === "number") {
    if (typeof newValue !== "number" || !Number.isFinite(newValue)) {
      errors.push(
        `${path}: new_value must be a finite number for field "${field}"`,
      );
    }
    return;
  }
  if (spec.type === "date") {
    if (typeof newValue !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(newValue)) {
      errors.push(
        `${path}: new_value must be an ISO date (YYYY-MM-DD) for field "${field}"`,
      );
    }
    return;
  }
  if (spec.type === "frequency") {
    if (typeof newValue !== "string" || !FREQUENCY_VALUES.has(newValue)) {
      errors.push(
        `${path}: new_value must be one of ${[...FREQUENCY_VALUES].join(", ")}`,
      );
    }
    return;
  }
  errors.push(`${path}: unsupported field type "${spec.type}"`);
}

export function validateChangeSet(changeSet) {
  const errors = [];
  if (!isPlainObject(changeSet)) {
    return { ok: false, errors: ["change_set must be an object"] };
  }
  if (
    changeSet.name != null &&
    (typeof changeSet.name !== "string" ||
      changeSet.name.length > CHANGE_SET_NAME_MAX)
  ) {
    errors.push(
      `name must be a string of at most ${CHANGE_SET_NAME_MAX} characters`,
    );
  }
  const changes = changeSet.changes;
  if (!Array.isArray(changes) || changes.length === 0) {
    errors.push("changes must be a non-empty array");
    return { ok: false, errors };
  }
  if (changes.length > CHANGE_SET_MAX_CHANGES) {
    errors.push(
      `changes exceeds the maximum of ${CHANGE_SET_MAX_CHANGES} per change-set`,
    );
    return { ok: false, errors };
  }
  changes.forEach((chg, i) => {
    const path = `changes[${i}]`;
    if (!isPlainObject(chg)) {
      errors.push(`${path}: must be an object`);
      return;
    }
    const target = chg.target;
    if (target !== "itemized" && target !== "pdpq") {
      errors.push(`${path}: target must be "itemized" or "pdpq"`);
      return;
    }
    const registry =
      target === "itemized"
        ? ITEMIZED_FIELD_ELIGIBILITY
        : PDPQ_FIELD_ELIGIBILITY;
    const field = cleanStr(chg.field);
    const spec = registry[field];
    if (!spec) {
      errors.push(
        `${path}: unknown field "${chg.field}" for target "${target}"`,
      );
      return;
    }
    if (spec.status === "excluded") {
      errors.push(
        `${path}: field "${field}" is not propagatable (${spec.reason})`,
      );
      return;
    }
    if (!isPlainObject(chg.match)) {
      errors.push(`${path}: match rule is required`);
      return;
    }
    if (target === "itemized") {
      const category = cleanStr(chg.category);
      if (!ITEMIZED_CATEGORIES.includes(category)) {
        errors.push(
          `${path}: category must be one of the ${ITEMIZED_CATEGORIES.length} canonical itemized categories`,
        );
      }
      const acct = cleanStr(chg.match.account_number);
      if (!acct) {
        errors.push(
          `${path}: match.account_number is required for itemized changes`,
        );
      } else if (acct.length > MATCH_STRING_MAX) {
        errors.push(
          `${path}: match.account_number exceeds ${MATCH_STRING_MAX} characters`,
        );
      }
      if (
        "line_description" in chg.match &&
        chg.match.line_description !== null
      ) {
        const desc = cleanStr(chg.match.line_description);
        if (!desc || desc.length > MATCH_STRING_MAX) {
          errors.push(
            `${path}: match.line_description, when present, must be null or a non-empty string of at most ${MATCH_STRING_MAX} characters`,
          );
        }
      }
      const extraKeys = Object.keys(chg.match).filter(
        (k) => k !== "account_number" && k !== "line_description",
      );
      if (extraKeys.length)
        errors.push(`${path}: unsupported match keys: ${extraKeys.join(", ")}`);
    } else {
      const key = cleanStr(chg.match.assumption_key);
      if (!key || key.length > MATCH_STRING_MAX) {
        errors.push(
          `${path}: match.assumption_key is required for pdpq changes`,
        );
      }
      const extraKeys = Object.keys(chg.match).filter(
        (k) => k !== "assumption_key",
      );
      if (extraKeys.length)
        errors.push(`${path}: unsupported match keys: ${extraKeys.join(", ")}`);
    }
    validateValue(field, spec, chg.new_value, path, errors);
  });

  for (let i = 1; i < changes.length; i++) {
    for (let j = 0; j < i; j++) {
      if (changeScopesCollide(changes[i], changes[j])) {
        errors.push(
          `changes[${i}] overlaps changes[${j}]: both target the same rows ` +
            `(${describeScope(changes[j])}) — split them into separate propagations`,
        );
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function changeScopesCollide(a, b) {
  if (!isPlainObject(a) || !isPlainObject(b)) return false;
  if (a.target !== b.target) return false;
  const ma = isPlainObject(a.match) ? a.match : {};
  const mb = isPlainObject(b.match) ? b.match : {};
  if (a.target === "itemized") {
    if (cleanStr(a.category) !== cleanStr(b.category)) return false;
    if (cleanStr(ma.account_number) !== cleanStr(mb.account_number))
      return false;
    const hasA = "line_description" in ma;
    const hasB = "line_description" in mb;
    if (!hasA || !hasB) return true;
    const da =
      ma.line_description === null ? null : cleanStr(ma.line_description);
    const db =
      mb.line_description === null ? null : cleanStr(mb.line_description);
    return da === db;
  }
  if (a.target === "pdpq") {
    return cleanStr(ma.assumption_key) === cleanStr(mb.assumption_key);
  }
  return false;
}

function describeScope(chg) {
  if (!isPlainObject(chg)) return "unknown scope";
  const m = isPlainObject(chg.match) ? chg.match : {};
  if (chg.target === "itemized") {
    const line = !("line_description" in m)
      ? "all lines"
      : m.line_description === null
        ? "lines with no description"
        : `line "${m.line_description}"`;
    return `itemized ${cleanStr(chg.category)} account ${cleanStr(m.account_number)}, ${line}`;
  }
  return `pdpq key ${cleanStr(m.assumption_key)}`;
}

export function changeSetTouchesDollarAmount(changeSet) {
  if (!isPlainObject(changeSet) || !Array.isArray(changeSet.changes))
    return false;
  return changeSet.changes.some((chg) => {
    if (!isPlainObject(chg)) return false;
    const registry =
      chg.target === "itemized"
        ? ITEMIZED_FIELD_ELIGIBILITY
        : PDPQ_FIELD_ELIGIBILITY;
    const spec = registry[cleanStr(chg.field)];
    return !!(spec && spec.dollar);
  });
}

export function changeSetIsFullyLive(changeSet) {
  if (!isPlainObject(changeSet) || !Array.isArray(changeSet.changes))
    return false;
  return changeSet.changes.every((chg) => {
    if (!isPlainObject(chg)) return false;
    const registry =
      chg.target === "itemized"
        ? ITEMIZED_FIELD_ELIGIBILITY
        : PDPQ_FIELD_ELIGIBILITY;
    const spec = registry[cleanStr(chg.field)];
    return !!(spec && spec.numeric === "live");
  });
}
