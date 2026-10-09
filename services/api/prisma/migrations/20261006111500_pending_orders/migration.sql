CREATE TYPE "OrderStatus" AS ENUM ('PENDING', 'CLOSED');
CREATE TABLE "DeliveryZone" (
  "province" TEXT PRIMARY KEY, "fee" INTEGER NOT NULL CHECK ("fee" >= 0),
  "surcharge" INTEGER NOT NULL DEFAULT 0 CHECK ("surcharge" >= 0),
  "freeAbove" INTEGER CHECK ("freeAbove" >= 0), "enabled" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE "Order" (
  "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id"),
  "requestId" TEXT NOT NULL, "requestHash" TEXT NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING', "address" JSONB NOT NULL,
  "subtotal" INTEGER NOT NULL CHECK ("subtotal" >= 0), "shipping" INTEGER NOT NULL CHECK ("shipping" >= 0),
  "total" INTEGER NOT NULL CHECK ("total" = "subtotal" + "shipping"), "quoteId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL, "closedAt" TIMESTAMP(3), "closeReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Order_closed_state" CHECK (("status" = 'CLOSED') = ("closedAt" IS NOT NULL))
);
CREATE UNIQUE INDEX "Order_userId_requestId_key" ON "Order"("userId", "requestId");
CREATE INDEX "Order_status_expiresAt_idx" ON "Order"("status", "expiresAt");
CREATE INDEX "Order_userId_createdAt_idx" ON "Order"("userId", "createdAt");
CREATE TABLE "OrderItem" (
  "id" TEXT PRIMARY KEY, "orderId" TEXT NOT NULL REFERENCES "Order"("id") ON DELETE CASCADE,
  "skuId" TEXT NOT NULL REFERENCES "ProductSku"("id"), "productId" TEXT NOT NULL,
  "title" TEXT NOT NULL, "skuTitle" TEXT NOT NULL, "cover" TEXT NOT NULL,
  "unitPrice" INTEGER NOT NULL CHECK ("unitPrice" >= 0), "quantity" INTEGER NOT NULL CHECK ("quantity" BETWEEN 1 AND 99),
  "subtotal" INTEGER NOT NULL CHECK ("subtotal" = "unitPrice" * "quantity")
);
CREATE UNIQUE INDEX "OrderItem_orderId_skuId_key" ON "OrderItem"("orderId", "skuId");
