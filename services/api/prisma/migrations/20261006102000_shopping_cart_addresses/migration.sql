ALTER TABLE "Product" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
CREATE TABLE "ProductSku" (
  "id" TEXT PRIMARY KEY, "productId" TEXT NOT NULL REFERENCES "Product"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL, "price" INTEGER NOT NULL CHECK ("price" >= 0),
  "stock" INTEGER NOT NULL DEFAULT 0, "reserved" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT false, "version" INTEGER NOT NULL DEFAULT 1,
  CONSTRAINT "ProductSku_inventory_check" CHECK ("stock" >= "reserved" AND "reserved" >= 0)
);
CREATE INDEX "ProductSku_productId_active_idx" ON "ProductSku"("productId", "active");
CREATE TABLE "CartItem" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "skuId" TEXT NOT NULL REFERENCES "ProductSku"("id") ON DELETE CASCADE,
  "quantity" INTEGER NOT NULL CHECK ("quantity" BETWEEN 1 AND 99),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "CartItem_userId_skuId_key" ON "CartItem"("userId", "skuId");
CREATE TABLE "Address" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "recipient" TEXT NOT NULL, "phone" TEXT NOT NULL, "province" TEXT NOT NULL, "city" TEXT NOT NULL,
  "district" TEXT NOT NULL, "detail" TEXT NOT NULL, "isDefault" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Address_userId_isDefault_idx" ON "Address"("userId", "isDefault");
CREATE UNIQUE INDEX "Address_one_default_per_user" ON "Address"("userId") WHERE "isDefault" = true;
