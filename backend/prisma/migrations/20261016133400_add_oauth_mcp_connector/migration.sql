-- CreateTable
CREATE TABLE "OAuthClient" (
    "clientId" TEXT NOT NULL PRIMARY KEY,
    "secretHash" TEXT,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "OAuthCode" (
    "codeHash" TEXT NOT NULL PRIMARY KEY,
    "clientId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "challenge" TEXT NOT NULL,
    "scope" TEXT,
    "resource" TEXT,
    "expiresAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "OAuthToken" (
    "tokenHash" TEXT NOT NULL PRIMARY KEY,
    "kind" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "scope" TEXT,
    "resource" TEXT,
    "expiresAt" DATETIME NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthToken_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "OAuthClient" ("clientId") ON DELETE CASCADE ON UPDATE CASCADE
);
