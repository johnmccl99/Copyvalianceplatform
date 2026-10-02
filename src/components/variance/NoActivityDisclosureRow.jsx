import React from "react";

export default function NoActivityDisclosureRow({
  count,
  open,
  onToggle,
  colSpan,
  noun = "account",
  theme = {},
}) {
  if (!count) return null;

  const {
    sub = "#6b7280",
    subtle = "#f9fafb",
    border = "#e5e7eb",
    text = "#111827",
  } = theme;
  const plural = count === 1 ? noun : `${noun}s`;

  return (
    <tr style={{ background: subtle, borderTop: `1px solid ${border}` }}>
      <td colSpan={colSpan} style={{ padding: 0 }}>
        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          title={
            open
              ? "Hide the accounts with no budget and no actual"
              : "Show the accounts with no budget and no actual"
          }
          style={{
            display: "block",
            width: "100%",
            textAlign: "left",
            padding: "7px 10px",
            background: "transparent",
            border: "none",
            color: sub,
            font: "inherit",
            fontSize: 12,
            cursor: "pointer",
          }}
        >
          <span aria-hidden="true">{open ? "▾" : "▸"}</span>{" "}
          <span
            style={{ color: text, fontWeight: 600 }}
          >{`${count} ${plural} with no activity`}</span>
          <span
            style={{ color: sub }}
          >{` — no budget and no actual${open ? "" : ". Show"}`}</span>
        </button>
      </td>
    </tr>
  );
}
