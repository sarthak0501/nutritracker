-- CreateTable
CREATE TABLE "Food" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "kcalPer100g" REAL NOT NULL,
    "proteinPer100g" REAL NOT NULL,
    "carbsPer100g" REAL NOT NULL,
    "fatPer100g" REAL NOT NULL,
    "fiberPer100g" REAL,
    "sodiumMgPer100g" REAL,
    "servingName" TEXT,
    "servingGrams" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "LogEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "date" TEXT NOT NULL,
    "mealType" TEXT NOT NULL,
    "mealName" TEXT,
    "amount" REAL NOT NULL,
    "unit" TEXT NOT NULL DEFAULT 'GRAM',
    "sourceText" TEXT,
    "isEstimated" BOOLEAN NOT NULL DEFAULT false,
    "estimationMeta" JSONB,
    "foodId" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "LogEntry_foodId_fkey" FOREIGN KEY ("foodId") REFERENCES "Food" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Profile" (
    "id" INTEGER NOT NULL PRIMARY KEY DEFAULT 1,
    "kcalTarget" REAL NOT NULL DEFAULT 2000,
    "proteinTarget" REAL NOT NULL DEFAULT 120,
    "carbsTarget" REAL NOT NULL DEFAULT 250,
    "fatTarget" REAL NOT NULL DEFAULT 70,
    "fiberTarget" REAL DEFAULT 30,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateIndex
CREATE INDEX "Food_name_idx" ON "Food"("name");

-- CreateIndex
CREATE INDEX "LogEntry_date_idx" ON "LogEntry"("date");

-- CreateIndex
CREATE INDEX "LogEntry_mealType_date_idx" ON "LogEntry"("mealType", "date");

