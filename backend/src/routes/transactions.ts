import { Router } from "express";
import { prisma } from "../prisma.js";

export const transactionsRouter = Router();

// GET /api/transactions?month=8&year=2026
transactionsRouter.get("/transactions", async (req, res) => {
  const { month, year } = req.query;

  const where: Record<string, unknown> = {};
  if (month && year) {
    const start = new Date(Number(year), Number(month) - 1, 1);
    const end = new Date(Number(year), Number(month), 1);
    where.date = { gte: start, lt: end };
  }

  const transactions = await prisma.transaction.findMany({
    where,
    include: { category: true, broker: true },
    orderBy: { date: "desc" },
  });

  res.json(transactions);
});

// POST /api/transactions — lançamento manual avulso
transactionsRouter.post("/transactions", async (req, res) => {
  const { date, type, description, amount, categoryId } = req.body;

  if (!date || !type || !description || amount == null) {
    return res.status(400).json({ error: "Campos obrigatórios: date, type, description, amount" });
  }

  const transaction = await prisma.transaction.create({
    data: {
      date: new Date(date),
      type,
      description,
      amount,
      categoryId: categoryId ?? null,
      source: "manual",
    },
  });

  res.status(201).json(transaction);
});
