import React from "react";
import { T } from "../../lib/theme.js";
import {
  AdjustmentsIntro,
  RentRollAdjustmentsInner,
} from "./RentRollAdjustmentsPage.jsx";

export default function RentRollAdjustmentsPropertyView({
  property,
  C = {},
  userProfile,
  showIntro = true,
  showOverlayPreview = true,
  newAdjustmentSeed = null,
  onAdjustmentsChanged = null,
  reloadToken = 0,
} = {}) {
  const sub = C.textSecondary || T.textSecondary;
  const propertyId = property?.id || null;

  return (
    <div
      style={{
        maxWidth: 1040,
        margin: "0 auto",
        padding: showIntro ? "20px 16px" : "0 16px",
      }}
    >
      {showIntro && <AdjustmentsIntro C={C} />}

      {!propertyId ? (
        <div
          style={{
            padding: 20,
            fontSize: 13,
            color: sub,
            lineHeight: 1.6,
            border: `1px solid ${C.border || T.border}`,
            borderRadius: 10,
          }}
        >
          No property selected. Open a property from the portfolio, then return
          to its Leasing tab to layer rent-roll adjustments on its
          Entrata-synced roll.
        </div>
      ) : (
        <RentRollAdjustmentsInner
          propertyId={propertyId}
          propertyEntrataId={property?.entrataPropertyId}
          propertyName={property?.name}
          C={C}
          userProfile={userProfile}
          showOverlayPreview={showOverlayPreview}
          newAdjustmentSeed={newAdjustmentSeed}
          onAdjustmentsChanged={onAdjustmentsChanged}
          reloadToken={reloadToken}
        />
      )}
    </div>
  );
}
