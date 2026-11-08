(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.BLProjectionInventoryContract = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // Generated projection of #891 only; the repository inventory stays authoritative.
  const fields = [
    {"canonicalId":"plmId","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"orderCode","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"fabricComposition","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"cashRetailPrice","classification":"belirsiz","removable":false}, // i18n-ignore
    {"canonicalId":"modelName","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"productDescription","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"productMainDefinition","classification":"belirsiz","removable":false}, // i18n-ignore
    {"canonicalId":"setPieceCount","classification":"belirsiz","removable":false}, // i18n-ignore
    {"canonicalId":"category","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"colourCode","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"colour","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"specialCode","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"mag","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"mmyg","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"buyingGroup","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"buyer","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"season","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"collectionName","classification":"belirsiz","removable":false}, // i18n-ignore
    {"canonicalId":"country","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"orderStatus","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"license","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"licensor","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"manufacturer","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"subManufacturer","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"buyingSampleManufacturer","classification":"belirsiz","removable":false}, // i18n-ignore
    {"canonicalId":"productGroup","classification":"belirsiz","removable":false}, // i18n-ignore
    {"canonicalId":"line","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"importance","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"brandDirectorate","classification":"belirsiz","removable":false}, // i18n-ignore
    {"canonicalId":"currency","classification":"belirsiz","removable":false}, // i18n-ignore
    {"canonicalId":"orderQuantity","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"shipmentQuantity","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"remainingUnits","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"deliveryType","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"collectionQuantity","classification":"belirsiz","removable":false}, // i18n-ignore
    {"canonicalId":"fob","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"supplierFob","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"inStoreMonth","classification":"belirsiz","removable":false}, // i18n-ignore
    {"canonicalId":"inStore","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"exFactory","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"orderPlacementDate","classification":"ince satırda gerekli","removable":false}, // i18n-ignore
    {"canonicalId":"retailDate","classification":"ince satırda gerekli","removable":false} // i18n-ignore
  ];
  fields.forEach(Object.freeze);
  return Object.freeze({
    formatVersion: 1,
    ref: Object.freeze({ pr: 891, head: '5736f3370fb55bbd62414585956ca8c53d37ce82' }),
    source: Object.freeze({ path: 'docs/performance-program/phase-6a/field-inventory.json', sha256: '9ddb58477db99ce381dd57f311eced5e09c3b2176f3b9b58349456a92b6cb352' }),
    fields: Object.freeze(fields)
  });
});
