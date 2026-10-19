ALTER TABLE "DeliveryZone" ADD COLUMN "priorityFee" int CHECK("priorityFee">=0),ADD COLUMN "priorityDescription" text,ADD COLUMN "priorityUntil" timestamptz,ADD COLUMN "priorityProofAssetId" text REFERENCES "MediaAsset"(id);
ALTER TABLE "DeliveryZone" ADD CHECK(num_nonnulls("priorityFee","priorityDescription","priorityUntil","priorityProofAssetId") IN (0,4));
