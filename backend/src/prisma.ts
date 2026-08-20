import { PrismaClient } from "@prisma/client";

// Singleton — evita abrir múltiplas conexões com o SQLite em dev (hot reload)
export const prisma = new PrismaClient();
