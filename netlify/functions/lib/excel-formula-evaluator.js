const TOKEN_TYPES = {
  NUMBER: "NUMBER",
  STRING: "STRING",
  BOOLEAN: "BOOLEAN",
  ERROR: "ERROR",
  REF: "REF",
  RANGE: "RANGE",
  IDENT: "IDENT",
  LPAREN: "LPAREN",
  RPAREN: "RPAREN",
  COMMA: "COMMA",
  OP: "OP",
};

const SHEET_NAME_RE = /^(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_]*))!/;
const CELL_REF_RE = /^\$?([A-Za-z]+)\$?(\d+)/;

function tokenize(formula) {
  let s = formula.trim();
  if (s.startsWith("=")) s = s.slice(1);
  if (s.startsWith("+")) s = s.slice(1);
  s = s.replace(/\[\d+\](?=['$A-Za-z_])/g, "");
  const tokens = [];
  let i = 0;
  const n = s.length;

  while (i < n) {
    const ch = s[i];

    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }

    if (/[0-9]/.test(ch) || (ch === "." && /[0-9]/.test(s[i + 1]))) {
      let j = i;
      while (j < n && /[0-9.]/.test(s[j])) j += 1;
      if (s[j] === "%") {
        const num = parseFloat(s.slice(i, j)) / 100;
        tokens.push({ type: TOKEN_TYPES.NUMBER, value: num });
        i = j + 1;
      } else {
        tokens.push({
          type: TOKEN_TYPES.NUMBER,
          value: parseFloat(s.slice(i, j)),
        });
        i = j;
      }
      continue;
    }

    if (ch === '"') {
      let j = i + 1,
        str = "";
      while (j < n) {
        if (s[j] === '"' && s[j + 1] === '"') {
          str += '"';
          j += 2;
          continue;
        }
        if (s[j] === '"') break;
        str += s[j];
        j += 1;
      }
      tokens.push({ type: TOKEN_TYPES.STRING, value: str });
      i = j + 1;
      continue;
    }

    if (ch === "#") {
      const errMatch = s
        .slice(i)
        .match(/^#(DIV\/0!|REF!|N\/A|NAME\?|NUM!|NULL!|VALUE!|GETTING_DATA)/);
      if (errMatch) {
        tokens.push({ type: TOKEN_TYPES.ERROR, value: "#" + errMatch[1] });
        i += errMatch[0].length;
        continue;
      }
    }

    const WHOLE_ROW_RE = /^\$?(\d+):\$?(\d+)/;
    const WHOLE_COL_RE = /^\$?([A-Za-z]{1,3}):\$?([A-Za-z]{1,3})/;
    const EXCEL_MAX_COL = "XFD";
    const EXCEL_MAX_ROW = 1048576;

    if (ch === "'" || ch === "$" || /[A-Za-z_]/.test(ch)) {
      const sheetMatch = s.slice(i).match(SHEET_NAME_RE);
      if (sheetMatch) {
        const sheetName = (sheetMatch[1] || sheetMatch[2])
          .replace(/''/g, "'")
          .trim();
        const afterSheet = i + sheetMatch[0].length;
        const rest = s.slice(afterSheet);
        const wholeRow = rest.match(WHOLE_ROW_RE);
        if (wholeRow && rest[wholeRow[0].length] !== "!") {
          tokens.push({
            type: TOKEN_TYPES.RANGE,
            sheet: sheetName,
            start: { col: "A", row: parseInt(wholeRow[1], 10) },
            end: { col: EXCEL_MAX_COL, row: parseInt(wholeRow[2], 10) },
            kind: "wholeRow",
          });
          i = afterSheet + wholeRow[0].length;
          continue;
        }
        const wholeCol = rest.match(WHOLE_COL_RE);
        if (wholeCol && !/^[0-9]/.test(rest[wholeCol[0].length] || "")) {
          tokens.push({
            type: TOKEN_TYPES.RANGE,
            sheet: sheetName,
            start: { col: wholeCol[1].toUpperCase(), row: 1 },
            end: { col: wholeCol[2].toUpperCase(), row: EXCEL_MAX_ROW },
            kind: "wholeCol",
          });
          i = afterSheet + wholeCol[0].length;
          continue;
        }
        const cellMatch = rest.match(CELL_REF_RE);
        if (cellMatch) {
          const startCol = cellMatch[1].toUpperCase();
          const startRow = cellMatch[2];
          const startEnd = afterSheet + cellMatch[0].length;
          if (s[startEnd] === ":") {
            const rangeRest = s.slice(startEnd + 1);
            const endMatch = rangeRest.match(CELL_REF_RE);
            if (endMatch) {
              tokens.push({
                type: TOKEN_TYPES.RANGE,
                sheet: sheetName,
                start: { col: startCol, row: parseInt(startRow, 10) },
                end: {
                  col: endMatch[1].toUpperCase(),
                  row: parseInt(endMatch[2], 10),
                },
              });
              i = startEnd + 1 + endMatch[0].length;
              continue;
            }
          }
          tokens.push({
            type: TOKEN_TYPES.REF,
            sheet: sheetName,
            col: startCol,
            row: parseInt(startRow, 10),
          });
          i = startEnd;
          continue;
        }
      }

      const cellMatch = s.slice(i).match(/^\$?([A-Za-z]{1,3})\$?(\d+)/);
      if (cellMatch && !/[A-Za-z_0-9]/.test(s[i + cellMatch[0].length] || "")) {
        const startEnd = i + cellMatch[0].length;
        if (s[startEnd] === ":") {
          const endMatch = s
            .slice(startEnd + 1)
            .match(/^\$?([A-Za-z]{1,3})\$?(\d+)/);
          if (endMatch) {
            tokens.push({
              type: TOKEN_TYPES.RANGE,
              sheet: null,
              start: {
                col: cellMatch[1].toUpperCase(),
                row: parseInt(cellMatch[2], 10),
              },
              end: {
                col: endMatch[1].toUpperCase(),
                row: parseInt(endMatch[2], 10),
              },
            });
            i = startEnd + 1 + endMatch[0].length;
            continue;
          }
        }
        tokens.push({
          type: TOKEN_TYPES.REF,
          sheet: null,
          col: cellMatch[1].toUpperCase(),
          row: parseInt(cellMatch[2], 10),
        });
        i = startEnd;
        continue;
      }

      const plainWholeCol = s.slice(i).match(WHOLE_COL_RE);
      if (
        plainWholeCol &&
        !/^[0-9]/.test(s[i + plainWholeCol[0].length] || "")
      ) {
        tokens.push({
          type: TOKEN_TYPES.RANGE,
          sheet: null,
          start: { col: plainWholeCol[1].toUpperCase(), row: 1 },
          end: { col: plainWholeCol[2].toUpperCase(), row: EXCEL_MAX_ROW },
          kind: "wholeCol",
        });
        i += plainWholeCol[0].length;
        continue;
      }

      let j = i;
      while (j < n && /[A-Za-z0-9_.]/.test(s[j])) j += 1;
      if (j === i) {
        throw new Error(
          `tokenizer: unexpected char '${ch}' at position ${i} in: ${formula}`,
        );
      }
      const ident = s.slice(i, j);
      const upper = ident.toUpperCase();

      if (s[j] === "[") {
        let depth = 1,
          k = j + 1;
        while (k < n && depth > 0) {
          if (s[k] === "[") depth += 1;
          else if (s[k] === "]") depth -= 1;
          k += 1;
        }
        if (depth === 0) {
          tokens.push({
            type: TOKEN_TYPES.IDENT,
            value: "__TABLE_REF__",
            tableName: ident,
            body: s.slice(j, k),
          });
          i = k;
          continue;
        }
      }

      if (upper === "TRUE")
        tokens.push({ type: TOKEN_TYPES.BOOLEAN, value: true });
      else if (upper === "FALSE")
        tokens.push({ type: TOKEN_TYPES.BOOLEAN, value: false });
      else
        tokens.push({
          type: TOKEN_TYPES.IDENT,
          value: upper,
          isPlainIdent: true,
        });
      i = j;
      continue;
    }

    if (ch === "<" && s[i + 1] === "=") {
      tokens.push({ type: TOKEN_TYPES.OP, value: "<=" });
      i += 2;
      continue;
    }
    if (ch === ">" && s[i + 1] === "=") {
      tokens.push({ type: TOKEN_TYPES.OP, value: ">=" });
      i += 2;
      continue;
    }
    if (ch === "<" && s[i + 1] === ">") {
      tokens.push({ type: TOKEN_TYPES.OP, value: "<>" });
      i += 2;
      continue;
    }
    if ("+-*/^&=<>%".includes(ch)) {
      tokens.push({ type: TOKEN_TYPES.OP, value: ch });
      i += 1;
      continue;
    }
    if (ch === "(") {
      tokens.push({ type: TOKEN_TYPES.LPAREN });
      i += 1;
      continue;
    }
    if (ch === ")") {
      tokens.push({ type: TOKEN_TYPES.RPAREN });
      i += 1;
      continue;
    }
    if (ch === ",") {
      tokens.push({ type: TOKEN_TYPES.COMMA });
      i += 1;
      continue;
    }

    throw new Error(
      `tokenizer: unexpected char '${ch}' at position ${i} in: ${formula}`,
    );
  }
  return tokens;
}

const PRECEDENCE = {
  "<": 2,
  ">": 2,
  "=": 2,
  "<=": 2,
  ">=": 2,
  "<>": 2,
  "&": 3,
  "+": 4,
  "-": 4,
  "*": 5,
  "/": 5,
  "^": 6,
};

function parseFormula(formula, currentSheet) {
  const tokens = tokenize(formula);
  let i = 0;

  function peek() {
    return tokens[i];
  }
  function eat() {
    return tokens[i++];
  }

  function parseExpression(minPrec = 1) {
    let left = parseUnary();
    while (i < tokens.length) {
      const t = peek();
      if (!t || t.type !== TOKEN_TYPES.OP) break;
      const prec = PRECEDENCE[t.value];
      if (!prec || prec < minPrec) break;
      eat();
      const right = parseExpression(prec + 1);
      left = { type: "BIN", op: t.value, left, right };
    }
    return left;
  }

  function parseUnary() {
    const t = peek();
    if (t?.type === TOKEN_TYPES.OP && (t.value === "-" || t.value === "+")) {
      eat();
      const operand = parseUnary();
      return { type: "UN", op: t.value, operand };
    }
    let primary = parsePrimary();
    if (
      i < tokens.length &&
      peek()?.type === TOKEN_TYPES.OP &&
      peek().value === "%"
    ) {
      eat();
      primary = {
        type: "BIN",
        op: "/",
        left: primary,
        right: { type: "NUM", value: 100 },
      };
    }
    return primary;
  }

  function parsePrimary() {
    const t = eat();
    if (!t) throw new Error("parser: unexpected end of input");
    if (t.type === TOKEN_TYPES.NUMBER) return { type: "NUM", value: t.value };
    if (t.type === TOKEN_TYPES.STRING) return { type: "STR", value: t.value };
    if (t.type === TOKEN_TYPES.BOOLEAN) return { type: "BOOL", value: t.value };
    if (t.type === TOKEN_TYPES.ERROR) return { type: "ERR", value: t.value };
    if (t.type === TOKEN_TYPES.REF)
      return {
        type: "REF",
        sheet: t.sheet || currentSheet,
        col: t.col,
        row: t.row,
      };
    if (t.type === TOKEN_TYPES.RANGE)
      return {
        type: "RANGE",
        sheet: t.sheet || currentSheet,
        start: t.start,
        end: t.end,
      };
    if (t.type === TOKEN_TYPES.LPAREN) {
      const expr = parseExpression();
      const close = eat();
      if (!close || close.type !== TOKEN_TYPES.RPAREN)
        throw new Error("parser: missing )");
      return expr;
    }
    if (t.type === TOKEN_TYPES.IDENT) {
      if (t.value === "__TABLE_REF__") {
        return { type: "TABLE_REF", tableName: t.tableName, body: t.body };
      }
      const next = peek();
      if (next?.type === TOKEN_TYPES.LPAREN) {
        eat();
        const args = [];
        if (peek()?.type !== TOKEN_TYPES.RPAREN) {
          args.push(parseExpression());
          while (peek()?.type === TOKEN_TYPES.COMMA) {
            eat();
            args.push(parseExpression());
          }
        }
        const close = eat();
        if (!close || close.type !== TOKEN_TYPES.RPAREN)
          throw new Error("parser: missing ) for function call");
        return { type: "CALL", name: t.value, args };
      }
      return { type: "NAMED_REF", name: t.value };
    }
    throw new Error(`parser: unexpected token ${t.type}`);
  }

  const ast = parseExpression();
  if (i !== tokens.length)
    throw new Error(`parser: trailing tokens at position ${i}`);
  return ast;
}

function asNumber(v) {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (v === null || v === undefined || v === "") return 0;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error("#VALUE!");
  return n;
}

function flatten1D(x) {
  if (!Array.isArray(x)) return [x];
  const out = [];
  for (const v of x) {
    if (Array.isArray(v)) for (const u of v) out.push(u);
    else out.push(v);
  }
  return out;
}

function flattenForAggregation(args) {
  const out = [];
  function visit(v) {
    if (v == null || v === "") return;
    if (Array.isArray(v)) {
      for (const x of v) visit(x);
      return;
    }
    if (typeof v === "number" || typeof v === "boolean") {
      out.push(v);
    } else if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n)) out.push(n);
    }
  }
  for (const a of args) visit(a);
  return out;
}

const FUNCTIONS = {
  SUM(args) {
    return flattenForAggregation(args).reduce((a, b) => a + b, 0);
  },
  AVERAGE(args) {
    const xs = flattenForAggregation(args);
    return xs.length
      ? xs.reduce((a, b) => a + b, 0) / xs.length
      : (() => {
          throw new Error("#DIV/0!");
        })();
  },
  MAX(args) {
    const xs = flattenForAggregation(args);
    if (!xs.length) return 0;
    return Math.max(...xs);
  },
  MIN(args) {
    const xs = flattenForAggregation(args);
    if (!xs.length) return 0;
    return Math.min(...xs);
  },
  COUNT(args) {
    return flattenForAggregation(args).length;
  },
  COUNTA(args) {
    let n = 0;
    for (const a of args) {
      if (Array.isArray(a)) {
        for (const v of a) if (v != null && v !== "") n += 1;
      } else if (a != null && a !== "") n += 1;
    }
    return n;
  },
  PRODUCT(args) {
    return flattenForAggregation(args).reduce((a, b) => a * b, 1);
  },

  ABS(args) {
    return Math.abs(asNumber(args[0]));
  },
  ROUND(args) {
    const v = asNumber(args[0]);
    const d = Math.trunc(asNumber(args[1] ?? 0));
    const m = Math.pow(10, d);
    return Math.round(v * m) / m;
  },
  ROUNDUP(args) {
    const v = asNumber(args[0]);
    const d = Math.trunc(asNumber(args[1] ?? 0));
    const m = Math.pow(10, d);
    return v >= 0 ? Math.ceil(v * m) / m : Math.floor(v * m) / m;
  },
  ROUNDDOWN(args) {
    const v = asNumber(args[0]);
    const d = Math.trunc(asNumber(args[1] ?? 0));
    const m = Math.pow(10, d);
    return v >= 0 ? Math.floor(v * m) / m : Math.ceil(v * m) / m;
  },
  CEILING(args) {
    const v = asNumber(args[0]);
    const sig = asNumber(args[1] ?? 1);
    if (sig === 0) return 0;
    return Math.ceil(v / sig) * sig;
  },
  FLOOR(args) {
    const v = asNumber(args[0]);
    const sig = asNumber(args[1] ?? 1);
    if (sig === 0) return 0;
    return Math.floor(v / sig) * sig;
  },
  INT(args) {
    return Math.floor(asNumber(args[0]));
  },
  TRUNC(args) {
    return Math.trunc(asNumber(args[0]));
  },
  POWER(args) {
    return Math.pow(asNumber(args[0]), asNumber(args[1]));
  },
  SQRT(args) {
    const v = asNumber(args[0]);
    if (v < 0) throw new Error("#NUM!");
    return Math.sqrt(v);
  },
  EXP(args) {
    return Math.exp(asNumber(args[0]));
  },
  LN(args) {
    const v = asNumber(args[0]);
    if (v <= 0) throw new Error("#NUM!");
    return Math.log(v);
  },
  LOG10(args) {
    const v = asNumber(args[0]);
    if (v <= 0) throw new Error("#NUM!");
    return Math.log10(v);
  },
  MOD(args) {
    const a = asNumber(args[0]);
    const b = asNumber(args[1]);
    if (b === 0) throw new Error("#DIV/0!");
    return a - Math.floor(a / b) * b;
  },

  IF(args) {
    const cond = args[0];
    const truthy =
      typeof cond === "boolean"
        ? cond
        : typeof cond === "number"
          ? cond !== 0
          : cond != null && cond !== "";
    return truthy ? args[1] : (args[2] ?? false);
  },
  IFERROR(args) {
    if (args[0] && typeof args[0] === "object" && args[0].__error)
      return args[1] ?? "";
    return args[0];
  },
  IFNA(args) {
    if (args[0] && typeof args[0] === "object" && args[0].__error === "#N/A")
      return args[1] ?? "";
    return args[0];
  },
  AND(args) {
    return flattenForAggregation(args).every((v) => v && v !== 0);
  },
  OR(args) {
    return flattenForAggregation(args).some((v) => v && v !== 0);
  },
  NOT(args) {
    const v = args[0];
    return !(typeof v === "boolean" ? v : v != null && v !== "" && v !== 0);
  },
  XOR(args) {
    let count = 0;
    for (const v of flattenForAggregation(args)) if (v && v !== 0) count += 1;
    return count % 2 === 1;
  },

  SUMIF(args) {
    const range = flatten1D(args[0]);
    const criterion = args[1];
    const sumRange = args[2] !== undefined ? flatten1D(args[2]) : range;
    let total = 0;
    for (let k = 0; k < range.length; k++) {
      if (matchesCriterion(range[k], criterion)) {
        const v = sumRange[k];
        if (v != null && v !== "") total += asNumber(v);
      }
    }
    return total;
  },
  COUNTIF(args) {
    const range = flatten1D(args[0]);
    const criterion = args[1];
    let count = 0;
    for (const v of range) if (matchesCriterion(v, criterion)) count += 1;
    return count;
  },

  SUMIFS(args) {
    if (args.length < 3 || (args.length - 1) % 2 !== 0)
      throw new Error("#VALUE!");
    const sumRange = flatten1D(args[0]);
    const pairs = [];
    for (let i = 1; i < args.length; i += 2) {
      pairs.push([flatten1D(args[i]), args[i + 1]]);
    }
    let total = 0;
    const len = sumRange.length;
    for (let k = 0; k < len; k++) {
      let allMatch = true;
      for (const [r, c] of pairs) {
        if (!matchesCriterion(r[k], c)) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        const v = sumRange[k];
        if (v != null && v !== "") total += asNumber(v);
      }
    }
    return total;
  },
  COUNTIFS(args) {
    if (args.length < 2 || args.length % 2 !== 0) throw new Error("#VALUE!");
    const pairs = [];
    for (let i = 0; i < args.length; i += 2) {
      pairs.push([flatten1D(args[i]), args[i + 1]]);
    }
    const len = pairs[0][0].length;
    let count = 0;
    for (let k = 0; k < len; k++) {
      let allMatch = true;
      for (const [r, c] of pairs) {
        if (!matchesCriterion(r[k], c)) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) count += 1;
    }
    return count;
  },
  AVERAGEIFS(args) {
    if (args.length < 3 || (args.length - 1) % 2 !== 0)
      throw new Error("#VALUE!");
    const avgRange = flatten1D(args[0]);
    const pairs = [];
    for (let i = 1; i < args.length; i += 2) {
      pairs.push([flatten1D(args[i]), args[i + 1]]);
    }
    let sum = 0,
      count = 0;
    const len = avgRange.length;
    for (let k = 0; k < len; k++) {
      let allMatch = true;
      for (const [r, c] of pairs) {
        if (!matchesCriterion(r[k], c)) {
          allMatch = false;
          break;
        }
      }
      if (allMatch) {
        const v = avgRange[k];
        if (typeof v === "number" && Number.isFinite(v)) {
          sum += v;
          count += 1;
        } else if (v != null && v !== "") {
          const n = Number(v);
          if (Number.isFinite(n)) {
            sum += n;
            count += 1;
          }
        }
      }
    }
    if (count === 0) throw new Error("#DIV/0!");
    return sum / count;
  },
  AVERAGEIF(args) {
    const range = flatten1D(args[0]);
    const criterion = args[1];
    const avgRange = args[2] !== undefined ? flatten1D(args[2]) : range;
    let sum = 0,
      count = 0;
    for (let k = 0; k < range.length; k++) {
      if (matchesCriterion(range[k], criterion)) {
        const v = avgRange[k];
        if (typeof v === "number" && Number.isFinite(v)) {
          sum += v;
          count += 1;
        } else if (v != null && v !== "") {
          const n = Number(v);
          if (Number.isFinite(n)) {
            sum += n;
            count += 1;
          }
        }
      }
    }
    if (count === 0) throw new Error("#DIV/0!");
    return sum / count;
  },

  TEXT(args) {
    let v = args[0];
    const fmt = String(args[1] ?? "");
    if (v == null || v === "") {
      if (/[#0%\$]/.test(fmt) || /[ymdhs]/.test(fmt)) v = 0;
      else return "";
    }
    if (typeof v === "string") {
      const n = Number(v);
      if (Number.isFinite(n) && v.trim() !== "") v = n;
    }
    if (typeof v === "boolean") v = v ? 1 : 0;
    function tailLiteral(f) {
      let i = f.length;
      const isFormatChar = (ch) => /[#0\.,;\?Ee\+\-\$\(\)%]/.test(ch);
      while (i > 0 && !isFormatChar(f[i - 1])) i--;
      let lit = f.slice(i);
      lit = lit.replace(/^\\/, "");
      const m = lit.match(/^"(.*)"$/);
      if (m) lit = m[1];
      return { core: f.slice(0, i), tail: lit };
    }
    if (typeof v === "number" && Number.isFinite(v)) {
      if (/%/.test(fmt)) {
        const decM = fmt.match(/0\.(0+)%/);
        const dec = decM ? decM[1].length : 0;
        const idx = fmt.indexOf("%");
        const trailing = idx >= 0 ? fmt.slice(idx + 1) : "";
        const litMatch = trailing.match(/^(?:\\(.)|"([^"]*)"|(.*))$/);
        const trail = litMatch
          ? litMatch[1] || litMatch[2] || litMatch[3] || ""
          : "";
        return (v * 100).toFixed(dec) + "%" + trail;
      }
      if (/^\$/.test(fmt) || /\$#,/.test(fmt)) {
        const dec = (fmt.match(/0\.(0+)/) || [, ""])[1].length;
        const sign = v < 0 ? "-" : "";
        const abs = Math.abs(v).toLocaleString("en-US", {
          minimumFractionDigits: dec,
          maximumFractionDigits: dec,
        });
        return sign + "$" + abs;
      }
      if (/[ymdhs]/.test(fmt) && !/^0+\.0+$/.test(fmt) && !/^#,##0/.test(fmt)) {
        try {
          const d = excelSerialToJSDate(v);
          const Y = d.getUTCFullYear();
          const M = d.getUTCMonth() + 1;
          const D = d.getUTCDate();
          let out = fmt;
          out = out.replace(/yyyy/gi, String(Y));
          out = out.replace(/yy/gi, String(Y).slice(-2));
          out = out.replace(
            /mmmm/g,
            [
              "January",
              "February",
              "March",
              "April",
              "May",
              "June",
              "July",
              "August",
              "September",
              "October",
              "November",
              "December",
            ][M - 1],
          );
          out = out.replace(
            /mmm/g,
            [
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
            ][M - 1],
          );
          out = out.replace(/mm/g, String(M).padStart(2, "0"));
          out = out.replace(/m/g, String(M));
          out = out.replace(/dd/g, String(D).padStart(2, "0"));
          out = out.replace(/d/g, String(D));
          return out;
        } catch {}
      }
      if (/[#0]/.test(fmt)) {
        const { core, tail } = tailLiteral(fmt);
        const dec = (core.match(/0\.(0+)/) || [, ""])[1].length;
        const useComma = /,/.test(core);
        const num = v.toLocaleString("en-US", {
          useGrouping: useComma,
          minimumFractionDigits: dec,
          maximumFractionDigits: dec,
        });
        return num + tail;
      }
    }
    return String(v);
  },

  INDIRECT(args) {
    throw new UnsupportedFunctionError("INDIRECT");
  },
  SUMPRODUCT(args) {
    const arrs = args.map((a) => (Array.isArray(a) ? a.flat() : [a]));
    if (!arrs.length) return 0;
    const len = Math.max(...arrs.map((a) => a.length));
    let total = 0;
    for (let k = 0; k < len; k++) {
      let p = 1;
      for (const a of arrs) {
        const v = a[k];
        if (v == null || v === "") {
          p = 0;
          break;
        }
        const n =
          typeof v === "number"
            ? v
            : typeof v === "boolean"
              ? v
                ? 1
                : 0
              : Number(v);
        if (!Number.isFinite(n)) {
          p = 0;
          break;
        }
        p *= n;
      }
      total += p;
    }
    return total;
  },

  VLOOKUP(args) {
    const lookup = args[0];
    const table = args[1];
    const colIndex = Math.trunc(asNumber(args[2]));
    const exact = args[3] === false || args[3] === 0;
    if (!Array.isArray(table) || !Array.isArray(table[0]))
      throw new Error("#VALUE!");
    for (let r = 0; r < table.length; r++) {
      const cell = table[r][0];
      if (exact ? cell === lookup : cell == lookup || cell <= lookup) {
        if (exact && cell !== lookup) continue;
        return table[r][colIndex - 1];
      }
    }
    throw new Error("#N/A");
  },
  HLOOKUP(args) {
    const lookup = args[0];
    const table = args[1];
    const rowIndex = Math.trunc(asNumber(args[2]));
    if (!Array.isArray(table) || !Array.isArray(table[0]))
      throw new Error("#VALUE!");
    for (let c = 0; c < table[0].length; c++) {
      if (table[0][c] === lookup) return table[rowIndex - 1][c];
    }
    throw new Error("#N/A");
  },
  INDEX(args) {
    const arr = args[0];
    const r = Math.trunc(asNumber(args[1]));
    const c = args[2] !== undefined ? Math.trunc(asNumber(args[2])) : 1;
    if (Array.isArray(arr) && Array.isArray(arr[0])) {
      const row = arr[r - 1];
      if (!row) throw new Error("#REF!");
      return row[c - 1];
    }
    if (Array.isArray(arr)) return arr[r - 1];
    return arr;
  },
  MATCH(args) {
    const lookup = args[0];
    const range = Array.isArray(args[1]) ? flatten1D(args[1]) : [args[1]];
    const matchType = args[2] !== undefined ? Math.trunc(asNumber(args[2])) : 1;
    if (matchType === 0) {
      for (let k = 0; k < range.length; k++)
        if (range[k] === lookup) return k + 1;
      throw new Error("#N/A");
    }
    if (matchType === 1) {
      let last = -1;
      for (let k = 0; k < range.length; k++) {
        if (range[k] != null && range[k] <= lookup) last = k;
        else break;
      }
      if (last === -1) throw new Error("#N/A");
      return last + 1;
    }
    if (matchType === -1) {
      let last = -1;
      for (let k = 0; k < range.length; k++) {
        if (range[k] != null && range[k] >= lookup) last = k;
        else break;
      }
      if (last === -1) throw new Error("#N/A");
      return last + 1;
    }
    throw new Error("#VALUE!");
  },

  XLOOKUP(args) {
    const lookup = args[0];
    const lookupArr = flatten1D(args[1]);
    const returnArrRaw = args[2];
    const get = (i) => {
      if (Array.isArray(returnArrRaw) && Array.isArray(returnArrRaw[0])) {
        if (returnArrRaw.length === lookupArr.length)
          return returnArrRaw[i].length === 1
            ? returnArrRaw[i][0]
            : returnArrRaw[i];
        if (returnArrRaw[0].length === lookupArr.length)
          return returnArrRaw.length === 1
            ? returnArrRaw[0][i]
            : returnArrRaw.map((r) => r[i]);
      }
      return Array.isArray(returnArrRaw) ? returnArrRaw[i] : returnArrRaw;
    };
    const ifNotFound = args.length > 3 ? args[3] : undefined;
    const matchMode = args.length > 4 ? Math.trunc(asNumber(args[4])) : 0;
    const searchMode = args.length > 5 ? Math.trunc(asNumber(args[5])) : 1;
    const start = searchMode === -1 ? lookupArr.length - 1 : 0;
    const end = searchMode === -1 ? -1 : lookupArr.length;
    const step = searchMode === -1 ? -1 : 1;
    let bestExactIdx = -1;
    let bestPrevIdx = -1,
      bestPrevVal = null;
    let bestNextIdx = -1,
      bestNextVal = null;
    const lookupEq = (a, b) => {
      if (a === b) return true;
      if (a == null || b == null) return false;
      const aIsNum = typeof a === "number";
      const bIsNum = typeof b === "number";
      if (aIsNum || bIsNum) {
        const an = aIsNum ? a : Number(a);
        const bn = bIsNum ? b : Number(b);
        if (Number.isFinite(an) && Number.isFinite(bn)) return an === bn;
        return false;
      }
      return String(a).toLowerCase() === String(b).toLowerCase();
    };
    for (let i = start; i !== end; i += step) {
      const v = lookupArr[i];
      if (lookupEq(v, lookup)) {
        bestExactIdx = i;
        break;
      }
      if (
        matchMode === -1 &&
        v != null &&
        v <= lookup &&
        (bestPrevVal === null || v >= bestPrevVal)
      ) {
        bestPrevIdx = i;
        bestPrevVal = v;
      }
      if (
        matchMode === 1 &&
        v != null &&
        v >= lookup &&
        (bestNextVal === null || v <= bestNextVal)
      ) {
        bestNextIdx = i;
        bestNextVal = v;
      }
      if (
        matchMode === 2 &&
        typeof lookup === "string" &&
        typeof v === "string"
      ) {
        const pattern =
          "^" +
          lookup
            .replace(/[.+^${}()|[\]\\]/g, "\\$&")
            .replace(/\?/g, ".")
            .replace(/\*/g, ".*") +
          "$";
        if (new RegExp(pattern, "i").test(v)) {
          bestExactIdx = i;
          break;
        }
      }
    }
    const idx =
      bestExactIdx >= 0
        ? bestExactIdx
        : matchMode === -1
          ? bestPrevIdx
          : matchMode === 1
            ? bestNextIdx
            : -1;
    if (idx < 0) {
      if (ifNotFound !== undefined) return ifNotFound;
      throw new Error("#N/A");
    }
    return get(idx);
  },

  IFS(args) {
    if (args.length % 2 !== 0) throw new Error("#VALUE!");
    for (let i = 0; i < args.length; i += 2) {
      const cond = args[i];
      const isTrue =
        typeof cond === "boolean"
          ? cond
          : typeof cond === "number"
            ? cond !== 0
            : !!cond;
      if (isTrue) return args[i + 1];
    }
    throw new Error("#N/A");
  },

  SWITCH(args) {
    if (args.length < 3) throw new Error("#VALUE!");
    const target = args[0];
    let i = 1;
    while (i + 1 < args.length) {
      if (args[i] === target) return args[i + 1];
      i += 2;
    }
    if ((args.length - 1) % 2 === 1) return args[args.length - 1];
    throw new Error("#N/A");
  },

  RANK(args) {
    const v = asNumber(args[0]);
    const range = flatten1D(args[1]).filter(
      (x) => typeof x === "number" && Number.isFinite(x),
    );
    const ascending = args[2] !== undefined && asNumber(args[2]) !== 0;
    const sorted = [...range].sort((a, b) => (ascending ? a - b : b - a));
    const idx = sorted.indexOf(v);
    if (idx < 0) throw new Error("#N/A");
    return idx + 1;
  },
  "RANK.EQ"(args) {
    return this.RANK(args);
  },
  "RANK.AVG"(args) {
    const v = asNumber(args[0]);
    const range = flatten1D(args[1]).filter(
      (x) => typeof x === "number" && Number.isFinite(x),
    );
    const ascending = args[2] !== undefined && asNumber(args[2]) !== 0;
    const sorted = [...range].sort((a, b) => (ascending ? a - b : b - a));
    const first = sorted.indexOf(v);
    if (first < 0) throw new Error("#N/A");
    let last = first;
    while (last + 1 < sorted.length && sorted[last + 1] === v) last += 1;
    return (first + 1 + (last + 1)) / 2;
  },

  PMT(args) {
    const rate = asNumber(args[0]);
    const nper = asNumber(args[1]);
    const pv = asNumber(args[2]);
    const fv = asNumber(args[3] ?? 0);
    const type = asNumber(args[4] ?? 0);
    if (rate === 0) return -(pv + fv) / nper;
    const pvf = Math.pow(1 + rate, nper);
    const pmt = (rate * (pv * pvf + fv)) / ((1 + rate * type) * (pvf - 1));
    return -pmt;
  },
  IPMT(args) {
    const rate = asNumber(args[0]);
    const per = asNumber(args[1]);
    const nper = asNumber(args[2]);
    const pv = asNumber(args[3]);
    const fv = asNumber(args[4] ?? 0);
    const type = asNumber(args[5] ?? 0);
    const pmt = FUNCTIONS.PMT([rate, nper, pv, fv, type]);
    if (per === 1 && type === 1) return 0;
    let bal = pv;
    for (let k = 1; k < per; k++) {
      const interest = bal * rate;
      const principal = -pmt - interest;
      bal -= principal;
    }
    return -bal * rate;
  },
  PPMT(args) {
    const pmt = FUNCTIONS.PMT(args);
    const rate = asNumber(args[0]);
    const per = asNumber(args[1]);
    const nper = asNumber(args[2]);
    const pv = asNumber(args[3]);
    const fv = asNumber(args[4] ?? 0);
    const type = asNumber(args[5] ?? 0);
    const ipmt = FUNCTIONS.IPMT([rate, per, nper, pv, fv, type]);
    return pmt - ipmt;
  },
  NPV(args) {
    const rate = asNumber(args[0]);
    const vals = flattenForAggregation(args.slice(1));
    let total = 0;
    for (let k = 0; k < vals.length; k++)
      total += vals[k] / Math.pow(1 + rate, k + 1);
    return total;
  },
  IRR(args, ctx) {
    const vals = flattenForAggregation([args[0]]).map(asNumber);
    let guess = args[1] !== undefined ? asNumber(args[1]) : 0.1;
    return solveIRR(vals, guess, ctx);
  },
  XIRR(args, ctx) {
    const vals = flattenForAggregation([args[0]]).map(asNumber);
    const dates = flattenForAggregation([args[1]]).map((d) =>
      excelSerialToJSDate(asNumber(d)),
    );
    let guess = args[2] !== undefined ? asNumber(args[2]) : 0.1;
    return solveXIRR(vals, dates, guess, ctx);
  },
  RATE(args, ctx) {
    const nper = asNumber(args[0]);
    const pmt = asNumber(args[1]);
    const pv = asNumber(args[2]);
    const fv = asNumber(args[3] ?? 0);
    const type = asNumber(args[4] ?? 0);
    let guess = args[5] !== undefined ? asNumber(args[5]) : 0.1;
    return solveRATE(nper, pmt, pv, fv, type, guess, ctx);
  },
  PV(args) {
    const rate = asNumber(args[0]);
    const nper = asNumber(args[1]);
    const pmt = asNumber(args[2] ?? 0);
    const fv = asNumber(args[3] ?? 0);
    const type = asNumber(args[4] ?? 0);
    if (rate === 0) return -(pmt * nper + fv);
    const pvf = Math.pow(1 + rate, nper);
    return -((pmt * (1 + rate * type) * (pvf - 1)) / rate + fv) / pvf;
  },
  FV(args) {
    const rate = asNumber(args[0]);
    const nper = asNumber(args[1]);
    const pmt = asNumber(args[2] ?? 0);
    const pv = asNumber(args[3] ?? 0);
    const type = asNumber(args[4] ?? 0);
    if (rate === 0) return -(pv + pmt * nper);
    const pvf = Math.pow(1 + rate, nper);
    return -(pv * pvf + (pmt * (1 + rate * type) * (pvf - 1)) / rate);
  },

  YEAR(args) {
    return excelSerialToJSDate(asNumber(args[0])).getUTCFullYear();
  },
  MONTH(args) {
    return excelSerialToJSDate(asNumber(args[0])).getUTCMonth() + 1;
  },
  DAY(args) {
    return excelSerialToJSDate(asNumber(args[0])).getUTCDate();
  },
  DATE(args) {
    const y = Math.trunc(asNumber(args[0]));
    const m = Math.trunc(asNumber(args[1]));
    const d = Math.trunc(asNumber(args[2]));
    return jsDateToExcelSerial(new Date(Date.UTC(y, m - 1, d)));
  },
  TODAY() {
    const t = new Date();
    return jsDateToExcelSerial(
      new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate())),
    );
  },
  EOMONTH(args) {
    const start = excelSerialToJSDate(asNumber(args[0]));
    const m = Math.trunc(asNumber(args[1]));
    const d = new Date(
      Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + m + 1, 0),
    );
    return jsDateToExcelSerial(d);
  },
  EDATE(args) {
    const start = excelSerialToJSDate(asNumber(args[0]));
    const m = Math.trunc(asNumber(args[1]));
    const d = new Date(
      Date.UTC(
        start.getUTCFullYear(),
        start.getUTCMonth() + m,
        start.getUTCDate(),
      ),
    );
    return jsDateToExcelSerial(d);
  },

  CONCATENATE(args) {
    return args.map((a) => (a == null ? "" : String(a))).join("");
  },
  CONCAT(args) {
    return args
      .map((a) => (Array.isArray(a) ? a.join("") : a == null ? "" : String(a)))
      .join("");
  },
  LEFT(args) {
    return String(args[0] ?? "").slice(0, Math.trunc(asNumber(args[1] ?? 1)));
  },
  RIGHT(args) {
    const s = String(args[0] ?? "");
    const n = Math.trunc(asNumber(args[1] ?? 1));
    return s.slice(s.length - n);
  },
  MID(args) {
    const s = String(args[0] ?? "");
    const start = Math.max(1, Math.trunc(asNumber(args[1])));
    const len = Math.trunc(asNumber(args[2]));
    return s.slice(start - 1, start - 1 + len);
  },
  LEN(args) {
    return String(args[0] ?? "").length;
  },
  UPPER(args) {
    return String(args[0] ?? "").toUpperCase();
  },
  LOWER(args) {
    return String(args[0] ?? "").toLowerCase();
  },
  TRIM(args) {
    return String(args[0] ?? "")
      .trim()
      .replace(/\s+/g, " ");
  },

  ISNUMBER(args) {
    return typeof args[0] === "number";
  },
  ISBLANK(args) {
    return args[0] == null || args[0] === "";
  },
  ISERROR(args) {
    return args[0] && typeof args[0] === "object" && args[0].__error != null;
  },
  ISTEXT(args) {
    return typeof args[0] === "string";
  },
  ISLOGICAL(args) {
    return typeof args[0] === "boolean";
  },
  N(args) {
    try {
      return asNumber(args[0]);
    } catch {
      return 0;
    }
  },
};

function matchesCriterion(value, criterion) {
  if (criterion == null) return value == null;
  if (typeof criterion === "number" || typeof criterion === "boolean")
    return value === criterion;
  const s = String(criterion);
  const opMatch = s.match(/^(>=|<=|<>|>|<|=)\s*(.*)$/);
  if (opMatch) {
    const op = opMatch[1];
    let target = opMatch[2];
    const targetN = Number(target);
    const useNum = Number.isFinite(targetN);
    const valN = typeof value === "number" ? value : Number(value);
    const valIsBlank = value == null || value === "";
    if (valIsBlank) return false;
    const cmp = useNum ? targetN : target;
    if (useNum && Number.isFinite(valN)) {
      switch (op) {
        case "=":
          return valN === cmp;
        case "<>":
          return valN !== cmp;
        case ">":
          return valN > cmp;
        case "<":
          return valN < cmp;
        case ">=":
          return valN >= cmp;
        case "<=":
          return valN <= cmp;
      }
    }
    const sv = String(value);
    const sc = String(cmp);
    switch (op) {
      case "=":
        return sv == sc;
      case "<>":
        return sv != sc;
      case ">":
        return sv > sc;
      case "<":
        return sv < sc;
      case ">=":
        return sv >= sc;
      case "<=":
        return sv <= sc;
    }
  }
  if (s.includes("*") || s.includes("?")) {
    const re = new RegExp(
      "^" +
        s
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".") +
        "$",
      "i",
    );
    return re.test(String(value));
  }
  return value == s;
}

const EXCEL_EPOCH_UTC = Date.UTC(1899, 11, 30);

function excelSerialToJSDate(serial) {
  const ms = EXCEL_EPOCH_UTC + serial * 86_400_000;
  return new Date(ms);
}

function jsDateToExcelSerial(d) {
  return Math.round((d.getTime() - EXCEL_EPOCH_UTC) / 86_400_000);
}

function solveIRR(values, guess, ctx) {
  let x = guess;
  for (let iter = 0; iter < 50; iter++) {
    if (ctx) checkDeadline(ctx);
    let f = 0,
      df = 0;
    for (let k = 0; k < values.length; k++) {
      const denom = Math.pow(1 + x, k);
      f += values[k] / denom;
      if (k > 0) df += (-k * values[k]) / Math.pow(1 + x, k + 1);
    }
    if (Math.abs(f) < 1e-7) return x;
    if (df === 0) break;
    const next = x - f / df;
    if (Math.abs(next - x) < 1e-9) return next;
    if (!Number.isFinite(next) || next < -1) break;
    x = next;
  }
  let lo = -0.99,
    hi = 10;
  function npv(rate) {
    let s = 0;
    for (let k = 0; k < values.length; k++)
      s += values[k] / Math.pow(1 + rate, k);
    return s;
  }
  if (npv(lo) * npv(hi) > 0) throw new Error("#NUM!");
  for (let iter = 0; iter < 100; iter++) {
    if (ctx) checkDeadline(ctx);
    const mid = (lo + hi) / 2;
    const f = npv(mid);
    if (Math.abs(f) < 1e-7) return mid;
    if (npv(lo) * f < 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function solveXIRR(values, dates, guess, ctx) {
  if (values.length !== dates.length || values.length < 2)
    throw new Error("#NUM!");
  const t0 = dates[0].getTime();
  const days = dates.map((d) => (d.getTime() - t0) / 86_400_000);
  function npv(rate) {
    let s = 0;
    for (let k = 0; k < values.length; k++)
      s += values[k] / Math.pow(1 + rate, days[k] / 365);
    return s;
  }
  function dnpv(rate) {
    let s = 0;
    for (let k = 0; k < values.length; k++) {
      const t = days[k] / 365;
      s += (-t * values[k]) / Math.pow(1 + rate, t + 1);
    }
    return s;
  }
  let x = guess;
  for (let iter = 0; iter < 100; iter++) {
    if (ctx) checkDeadline(ctx);
    const f = npv(x);
    if (Math.abs(f) < 1e-7) return x;
    const df = dnpv(x);
    if (df === 0) break;
    const next = x - f / df;
    if (Math.abs(next - x) < 1e-10) return next;
    if (!Number.isFinite(next) || next < -0.99) break;
    x = next;
  }
  let lo = -0.99,
    hi = 10;
  if (npv(lo) * npv(hi) > 0) throw new Error("#NUM!");
  for (let iter = 0; iter < 200; iter++) {
    if (ctx) checkDeadline(ctx);
    const mid = (lo + hi) / 2;
    const f = npv(mid);
    if (Math.abs(f) < 1e-8) return mid;
    if (npv(lo) * f < 0) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

function solveRATE(nper, pmt, pv, fv, type, guess, ctx) {
  function f(r) {
    if (r === 0) return pv + pmt * nper + fv;
    const pvf = Math.pow(1 + r, nper);
    return pv * pvf + (pmt * (1 + r * type) * (pvf - 1)) / r + fv;
  }
  let x = guess;
  for (let iter = 0; iter < 100; iter++) {
    if (ctx) checkDeadline(ctx);
    const fx = f(x);
    if (Math.abs(fx) < 1e-7) return x;
    const dfx = (f(x + 1e-7) - fx) / 1e-7;
    if (dfx === 0) break;
    const next = x - fx / dfx;
    if (!Number.isFinite(next)) break;
    if (Math.abs(next - x) < 1e-10) return next;
    x = next;
  }
  throw new Error("#NUM!");
}

function evaluateAST(ast, ctx) {
  checkDeadline(ctx);
  switch (ast.type) {
    case "NUM":
      return ast.value;
    case "STR":
      return ast.value;
    case "BOOL":
      return ast.value;
    case "ERR":
      return { __error: ast.value };
    case "REF":
      return ctx.resolveCell(ast.sheet, `${ast.col}${ast.row}`);
    case "RANGE":
      return resolveRange(ast, ctx);
    case "TABLE_REF":
      throw new UnsupportedFunctionError(
        `structured_ref:${ast.tableName}${ast.body}`,
      );
    case "NAMED_REF": {
      const map = ctx.namedRanges;
      if (map) {
        let target = map[ast.name];
        if (!target) {
          const lname = ast.name.toLowerCase();
          for (const k of Object.keys(map)) {
            if (k.toLowerCase() === lname) {
              target = map[k];
              break;
            }
          }
        }
        if (target) {
          if (target.isRange) {
            return resolveRange(
              {
                type: "RANGE",
                sheet: target.sheet,
                start: {
                  col: target.start.replace(/\d+/g, ""),
                  row: parseInt(target.start.match(/\d+/)?.[0] || "0", 10),
                },
                end: {
                  col: target.end.replace(/\d+/g, ""),
                  row: parseInt(target.end.match(/\d+/)?.[0] || "0", 10),
                },
              },
              ctx,
            );
          }
          return ctx.resolveCell(target.sheet, target.cell);
        }
      }
      throw new UnsupportedFunctionError(`named_range:${ast.name}`);
    }
    case "BIN": {
      const left = evaluateAST(ast.left, ctx);
      const right = evaluateAST(ast.right, ctx);
      return applyBinOp(ast.op, left, right);
    }
    case "UN": {
      const v = evaluateAST(ast.operand, ctx);
      if (ast.op === "-") return -asNumber(v);
      return asNumber(v);
    }
    case "CALL": {
      const name = ast.name;
      if (name === "IFS") {
        if (ast.args.length % 2 !== 0) throw new Error("#VALUE!");
        for (let i = 0; i < ast.args.length; i += 2) {
          const cond = evaluateAST(ast.args[i], ctx);
          const isTrue =
            typeof cond === "boolean"
              ? cond
              : typeof cond === "number"
                ? cond !== 0
                : !!cond;
          if (isTrue) return evaluateAST(ast.args[i + 1], ctx);
        }
        throw new Error("#N/A");
      }
      if (name === "IF") {
        const cond = evaluateAST(ast.args[0], ctx);
        const isTrue =
          typeof cond === "boolean"
            ? cond
            : typeof cond === "number"
              ? cond !== 0
              : !!cond;
        if (isTrue)
          return ast.args[1] !== undefined
            ? evaluateAST(ast.args[1], ctx)
            : true;
        return ast.args[2] !== undefined
          ? evaluateAST(ast.args[2], ctx)
          : false;
      }
      if (name === "IFERROR" || name === "IFNA") {
        const matchOnly_NA = name === "IFNA";
        try {
          const v = evaluateAST(ast.args[0], ctx);
          if (v && typeof v === "object" && v.__error) {
            if (!matchOnly_NA || v.__error === "#N/A") {
              return ast.args[1] !== undefined
                ? evaluateAST(ast.args[1], ctx)
                : "";
            }
          }
          return v;
        } catch (e) {
          if (e?.message?.startsWith("#")) {
            if (!matchOnly_NA || e.message === "#N/A") {
              return ast.args[1] !== undefined
                ? evaluateAST(ast.args[1], ctx)
                : "";
            }
          }
          throw e;
        }
      }
      if (name === "SWITCH") {
        if (ast.args.length < 3) throw new Error("#VALUE!");
        const target = evaluateAST(ast.args[0], ctx);
        let i = 1;
        while (i + 1 < ast.args.length) {
          const v = evaluateAST(ast.args[i], ctx);
          if (v === target) return evaluateAST(ast.args[i + 1], ctx);
          i += 2;
        }
        if ((ast.args.length - 1) % 2 === 1)
          return evaluateAST(ast.args[ast.args.length - 1], ctx);
        throw new Error("#N/A");
      }
      if (name === "CHOOSE") {
        if (ast.args.length < 2) throw new Error("#VALUE!");
        const idx = Math.trunc(asNumber(evaluateAST(ast.args[0], ctx)));
        if (idx < 1 || idx >= ast.args.length) throw new Error("#VALUE!");
        return evaluateAST(ast.args[idx], ctx);
      }

      const fn = FUNCTIONS[name];
      if (!fn) throw new UnsupportedFunctionError(name);
      const args = ast.args.map((a) => evaluateAST(a, ctx));
      return fn(args, ctx);
    }
    default:
      throw new Error(`evaluator: unknown AST node ${ast.type}`);
  }
}

const ARITHMETIC_OPS = new Set(["+", "-", "*", "/", "^"]);

function applyBinOp(op, l, r) {
  if (ARITHMETIC_OPS.has(op) && (Array.isArray(l) || Array.isArray(r))) {
    return arithBroadcast(op, l, r);
  }
  switch (op) {
    case "+":
      return asNumber(l) + asNumber(r);
    case "-":
      return asNumber(l) - asNumber(r);
    case "*":
      return asNumber(l) * asNumber(r);
    case "/": {
      const rv = asNumber(r);
      if (rv === 0) throw new Error("#DIV/0!");
      return asNumber(l) / rv;
    }
    case "^":
      return Math.pow(asNumber(l), asNumber(r));
    case "&":
      return (l == null ? "" : String(l)) + (r == null ? "" : String(r));
    case "=":
      return l == r;
    case "<>":
      return l != r;
    case "<":
      return asNumber(l) < asNumber(r);
    case ">":
      return asNumber(l) > asNumber(r);
    case "<=":
      return asNumber(l) <= asNumber(r);
    case ">=":
      return asNumber(l) >= asNumber(r);
    default:
      throw new Error(`unknown op ${op}`);
  }
}

function arithBroadcast(op, l, r) {
  const lIs = Array.isArray(l);
  const rIs = Array.isArray(r);
  if (lIs && Array.isArray(l[0]) && !rIs) {
    return l.map((row) => row.map((v) => scalarOp(op, v, r)));
  }
  if (rIs && Array.isArray(r[0]) && !lIs) {
    return r.map((row) => row.map((v) => scalarOp(op, l, v)));
  }
  if (lIs && !rIs)
    return l.map((v) =>
      Array.isArray(v) ? v.map((x) => scalarOp(op, x, r)) : scalarOp(op, v, r),
    );
  if (rIs && !lIs)
    return r.map((v) =>
      Array.isArray(v) ? v.map((x) => scalarOp(op, l, x)) : scalarOp(op, l, v),
    );
  const len = Math.max(l.length, r.length);
  const out = [];
  for (let i = 0; i < len; i++) {
    const lv = l[i % l.length];
    const rv = r[i % r.length];
    if (Array.isArray(lv) || Array.isArray(rv))
      out.push(arithBroadcast(op, lv, rv));
    else out.push(scalarOp(op, lv, rv));
  }
  return out;
}

function scalarOp(op, l, r) {
  switch (op) {
    case "+":
      return asNumber(l) + asNumber(r);
    case "-":
      return asNumber(l) - asNumber(r);
    case "*":
      return asNumber(l) * asNumber(r);
    case "/": {
      const rv = asNumber(r);
      if (rv === 0) throw new Error("#DIV/0!");
      return asNumber(l) / rv;
    }
    case "^":
      return Math.pow(asNumber(l), asNumber(r));
    default:
      throw new Error(`unknown scalar op ${op}`);
  }
}

const MAX_RANGE_CELLS = 100_000;

class RangeTooLargeError extends Error {
  constructor(cells) {
    super(`range too large: ${cells} cells (cap ${MAX_RANGE_CELLS})`);
    this.name = "RangeTooLargeError";
    this.cells = cells;
  }
}

function resolveRange(ast, ctx) {
  const startCol = colToNum(ast.start.col);
  const endCol = colToNum(ast.end.col);
  const cellCount = (ast.end.row - ast.start.row + 1) * (endCol - startCol + 1);
  if (cellCount > MAX_RANGE_CELLS) {
    throw new RangeTooLargeError(cellCount);
  }
  const out = [];
  let cellsResolved = 0;
  for (let r = ast.start.row; r <= ast.end.row; r++) {
    if (ast.start.col === ast.end.col || startCol === endCol) {
      out.push(ctx.resolveCell(ast.sheet, `${ast.start.col}${r}`));
      cellsResolved += 1;
    } else {
      const row = [];
      for (let c = startCol; c <= endCol; c++) {
        row.push(ctx.resolveCell(ast.sheet, `${numToCol(c)}${r}`));
      }
      out.push(row);
      cellsResolved += endCol - startCol + 1;
    }
    if ((cellsResolved & 0xff) === 0) checkDeadline(ctx);
  }
  return out;
}

function colToNum(c) {
  let n = 0;
  for (const ch of c.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}
function numToCol(n) {
  let s = "";
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

class UnsupportedFunctionError extends Error {
  constructor(name) {
    super(`Unsupported function: ${name}`);
    this.name = "UnsupportedFunctionError";
    this.functionName = name;
  }
}

class EvaluatorBudgetError extends Error {
  constructor(elapsedMs, deadlineMs) {
    super(
      `evaluator deadline exceeded after ${elapsedMs}ms (budget ${deadlineMs}ms)`,
    );
    this.name = "EvaluatorBudgetError";
    this.elapsedMs = elapsedMs;
    this.deadlineMs = deadlineMs;
  }
}

function checkDeadline(ctx) {
  if (ctx.deadline != null && Date.now() >= ctx.deadline) {
    throw new EvaluatorBudgetError(
      Date.now() - ctx.startTime,
      ctx.deadline - ctx.startTime,
    );
  }
}

const MAX_FORMULA_TOTAL_CELLS = 10_000;

const WHOLE_RANGE_ESTIMATE = 256;

const HEAVY_FUNCTIONS = new Set();
const HEAVY_FN_MULTIPLIER = 1;

function estimateFormulaWork(ast) {
  let total = 0;
  function visit(n, multiplier = 1) {
    if (!n) return;
    if (n.type === "RANGE") {
      if (n.kind === "wholeRow" || n.kind === "wholeCol") {
        total += WHOLE_RANGE_ESTIMATE * multiplier;
        return;
      }
      const startCol = colToNum(n.start.col);
      const endCol = colToNum(n.end.col);
      total +=
        (n.end.row - n.start.row + 1) * (endCol - startCol + 1) * multiplier;
      return;
    }
    if (n.type === "REF") {
      total += multiplier;
      return;
    }
    if (
      n.type === "CALL" &&
      typeof n.name === "string" &&
      HEAVY_FUNCTIONS.has(n.name.toUpperCase())
    ) {
      const m = multiplier * HEAVY_FN_MULTIPLIER;
      if (Array.isArray(n.args)) for (const a of n.args) visit(a, m);
      return;
    }
    if (Array.isArray(n.args)) for (const a of n.args) visit(a, multiplier);
    if (n.left) visit(n.left, multiplier);
    if (n.right) visit(n.right, multiplier);
    if (n.expr) visit(n.expr, multiplier);
    if (n.value && typeof n.value === "object") visit(n.value, multiplier);
  }
  visit(ast);
  return total;
}

export function evaluateFormula(
  formula,
  currentSheet,
  resolveCell,
  options = {},
) {
  let ast;
  try {
    ast = parseFormula(formula, currentSheet);
  } catch (e) {
    return { skipped: true, reason: `parse: ${e?.message || String(e)}` };
  }
  const estCells = estimateFormulaWork(ast);
  if (estCells > MAX_FORMULA_TOTAL_CELLS) {
    return {
      skipped: true,
      reason: `formula_too_heavy:${estCells}cells_estimated`,
    };
  }
  const startTime = Date.now();
  const deadline =
    typeof options.timeoutMs === "number"
      ? startTime + options.timeoutMs
      : null;
  const ctx = {
    resolveCell,
    deadline,
    startTime,
    namedRanges: options.namedRanges || null,
  };
  try {
    const value = evaluateAST(ast, ctx);
    if (value && typeof value === "object" && value.__error) {
      return { error: value.__error };
    }
    return { value };
  } catch (e) {
    if (e instanceof EvaluatorBudgetError) {
      return { skipped: true, reason: `cell_eval_timeout:${e.elapsedMs}ms` };
    }
    if (e instanceof UnsupportedFunctionError) {
      return {
        skipped: true,
        reason: `unsupported function: ${e.functionName}`,
      };
    }
    if (e instanceof RangeTooLargeError) {
      return { skipped: true, reason: `range_too_large:${e.cells}cells` };
    }
    if (e?.message?.startsWith("#")) {
      return { error: e.message };
    }
    return { skipped: true, reason: `eval: ${e?.message || String(e)}` };
  }
}

export function extractCellRefs(formula, currentSheet) {
  let ast;
  try {
    ast = parseFormula(formula, currentSheet);
  } catch {
    return [];
  }
  const refs = [];
  walk(ast);
  return refs;

  function walk(node) {
    if (!node) return;
    if (node.type === "REF") {
      refs.push({
        sheet: node.sheet,
        cell: `${node.col}${node.row}`,
        kind: "cell",
      });
    } else if (node.type === "RANGE") {
      refs.push({
        sheet: node.sheet,
        cell: `${node.start.col}${node.start.row}:${node.end.col}${node.end.row}`,
        kind: "range",
        range: {
          startCol: node.start.col,
          startRow: node.start.row,
          endCol: node.end.col,
          endRow: node.end.row,
        },
      });
    } else if (node.type === "BIN") {
      walk(node.left);
      walk(node.right);
    } else if (node.type === "UN") {
      walk(node.operand);
    } else if (node.type === "CALL") {
      for (const a of node.args || []) walk(a);
    }
  }
}

export const _internal = {
  tokenize,
  parseFormula,
  evaluateAST,
  FUNCTIONS,
  colToNum,
  numToCol,
  excelSerialToJSDate,
  jsDateToExcelSerial,
};
