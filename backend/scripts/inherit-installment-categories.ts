// Uma vez (05/11): parcelas que viraram lançamento no sync de 04/11 sem a
// categoria da compra (ver `inheritFromPurchase`). Sem --apply só mostra.
import "dotenv/config";
import { prisma } from "../src/prisma.js";
import { inheritFromPurchase } from "../src/services/pluggyTransactionSync.js";
import { DATA_START } from "../src/services/integrity.js";

const apply = process.argv.includes("--apply");
const rows = await prisma.transaction.findMany({
  where: {
    type: "expense",
    isTransfer: false,
    categoryId: null,
    brokerId: { not: null },
    date: { gte: DATA_START },
    splits: { none: {} },
    OR: [{ installmentNumber: { not: null } }, { totalInstallments: { gt: 1 } }],
  },
  include: { broker: { select: { name: true } } },
  orderBy: { date: "asc" },
});
const cats = new Map((await prisma.category.findMany({ include: { parent: true } })).map((c) => [c.id, `${c.parent ? c.parent.name + " > " : ""}${c.name}`]));
let fixed = 0;
for (const t of rows) {
  const found = await inheritFromPurchase(t.brokerId!, t.description, t.amount, t);
  console.log(`${t.date.toISOString().slice(0, 10)} ${t.broker?.name} ${t.description.trim()} ${t.installmentNumber}/${t.totalInstallments} R$ ${t.amount} → ${found ? cats.get(found.categoryId) : "(nenhuma compra categorizada achada)"}`);
  if (found && apply) {
    await prisma.transaction.update({ where: { id: t.id }, data: { categoryId: found.categoryId, note: t.note ?? found.note } });
    fixed++;
  }
}
console.log(apply ? `${fixed} categorizada(s).` : `${rows.length} parcela(s) sem categoria — rode com --apply.`);
process.exit(0);
