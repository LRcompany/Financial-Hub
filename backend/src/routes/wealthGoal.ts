import { Router } from "express";
import { prisma } from "../prisma.js";

export const wealthGoalRouter = Router();

// GET /api/wealth-goal — meta geral (valor alvo) + tabela ano a ano
wealthGoalRouter.get("/wealth-goal", async (_req, res) => {
  const [goal, yearly] = await Promise.all([
    prisma.wealthGoal.findFirst(),
    prisma.wealthGoalYearly.findMany({ orderBy: { year: "asc" } }),
  ]);
  res.json({ targetAmount: goal?.targetAmount ?? null, yearly });
});

// PUT /api/wealth-goal — define/atualiza o valor alvo (singleton)
wealthGoalRouter.put("/wealth-goal", async (req, res) => {
  const { targetAmount } = req.body ?? {};
  if (typeof targetAmount !== "number" || targetAmount <= 0) {
    return res.status(400).json({ error: "targetAmount precisa ser um número positivo" });
  }
  const existing = await prisma.wealthGoal.findFirst();
  const goal = existing
    ? await prisma.wealthGoal.update({ where: { id: existing.id }, data: { targetAmount } })
    : await prisma.wealthGoal.create({ data: { targetAmount } });
  res.json(goal);
});

// PUT /api/wealth-goal/yearly/:year — cria/atualiza a meta de um ano específico
wealthGoalRouter.put("/wealth-goal/yearly/:year", async (req, res) => {
  const year = Number(req.params.year);
  const { savingsTarget, annualReturnAssumptionPct } = req.body ?? {};
  if (!Number.isInteger(year) || typeof savingsTarget !== "number" || typeof annualReturnAssumptionPct !== "number") {
    return res.status(400).json({ error: "Campos obrigatórios: savingsTarget, annualReturnAssumptionPct (year na URL)" });
  }
  const row = await prisma.wealthGoalYearly.upsert({
    where: { year },
    update: { savingsTarget, annualReturnAssumptionPct },
    create: { year, savingsTarget, annualReturnAssumptionPct },
  });
  res.json(row);
});

// DELETE /api/wealth-goal/yearly/:year
wealthGoalRouter.delete("/wealth-goal/yearly/:year", async (req, res) => {
  const year = Number(req.params.year);
  await prisma.wealthGoalYearly.deleteMany({ where: { year } });
  res.status(204).end();
});
