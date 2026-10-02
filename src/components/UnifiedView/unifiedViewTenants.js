import React from "react";
import MasterVarianceView from "./MasterVarianceView.jsx";
import SetOccupancyView from "./SetOccupancyView.jsx";
import { VarianceReviewQueueTenant } from "../VarianceReview/VarianceReviewQueuePage.jsx";

export const UNIFIED_VIEW_TENANTS = [
  {
    key: "masterVariance",
    label: "Variance",
    roles: ["gp", "admin"],
    render: (props) => React.createElement(MasterVarianceView, props),
  },
  {
    key: "setOccupancy",
    label: "Occupancy",
    roles: ["gp", "admin"],
    render: (props) => React.createElement(SetOccupancyView, props),
  },
  {
    key: "varianceReviewQueue",
    label: "Review Queue",
    roles: ["gp", "admin"],
    render: (props) => React.createElement(VarianceReviewQueueTenant, props),
  },
];

export default UNIFIED_VIEW_TENANTS;
