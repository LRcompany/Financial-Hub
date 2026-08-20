import { Router } from "express";
import { prisma } from "../prisma.js";

export const categoriesRouter = Router();

// GET /api/categories — retorna árvore (categoria-mãe + subcategorias)
categoriesRouter.get("/categories", async (_req, res) => {
  const categories = await prisma.category.findMany({
    where: { parentId: null },
    include: { children: true },
    orderBy: { name: "asc" },
  });

  res.json(categories);
});
