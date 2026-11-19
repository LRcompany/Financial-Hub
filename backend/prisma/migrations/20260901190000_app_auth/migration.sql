-- Login do app (uso pessoal, um usuário só): senha de 6 dígitos (hash) +
-- credenciais Face ID/Touch ID (WebAuthn) por aparelho.
CREATE TABLE "AppAuth" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "pinHash" TEXT NOT NULL
);

CREATE TABLE "WebauthnCredential" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "publicKey" BLOB NOT NULL,
    "counter" INTEGER NOT NULL DEFAULT 0,
    "transports" TEXT,
    "deviceLabel" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
