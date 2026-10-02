import React from "react";

export const BALANCE_SECONDARY_COLOR = "var(--ds-text-tertiary)";

export const BALANCE_CELL_LEGEND =
  "Each account row leads with that month\u2019s change; the lighter figure beneath it is the ending balance. Subtotal and Total figures are balances.";

export const BALANCE_ACTIVITY_ABSENT_TITLE =
  "Blank change line \u2014 no budget or actual row exists for that month. The ending balance beneath it is carried forward and still stands.";

export function balanceCellContent({
  change,
  balance,
  changePresent = true,
  fmtCell,
}) {
  return [
    React.createElement(
      "div",
      { key: "change" },
      fmtCell(change, { present: changePresent }),
    ),
    React.createElement(
      "div",
      {
        key: "balance",
        "data-role": "ending-balance",
        style: {
          fontSize: 10,
          lineHeight: 1.3,
          fontWeight: 400,
          color: BALANCE_SECONDARY_COLOR,
        },
      },
      fmtCell(balance, { present: true }),
    ),
  ];
}
