// Datas do app = DIA DO CALENDÁRIO BRASILEIRO, guardado ao meio-dia UTC (27/10).
//
// Bug estrutural achado na auditoria: o servidor roda em UTC e a Pluggy manda
// horário real — um gasto às 22h no Brasil (01h UTC do dia seguinte) caía no
// dia seguinte, e no último dia do mês, no MÊS seguinte (ex.: Uber de 31/07
// 21h51 contava em agosto). Já o lançamento manual vinha à meia-noite UTC do
// dia digitado — no navegador (Brasília) virava o dia anterior. Cada lugar
// enxergava um dia diferente pro mesmo gasto.
//
// Regra única: toda data de gasto/recebimento/pagamento é guardada como o dia
// do calendário no Brasil, às 12:00 UTC (09:00 em Brasília). Meio-dia fica a
// 9h+ de qualquer virada de dia em UTC ou em Brasília, então servidor,
// navegador e conector do Claude sempre concordam sobre o dia e o mês.

const BRT_OFFSET_MS = 3 * 60 * 60 * 1000; // Brasília = UTC−3 (sem horário de verão desde 2019)

/** "YYYY-MM-DD" do dia no Brasil de um instante. */
export function brDayString(instant: Date | string): string {
  return new Date(new Date(instant).getTime() - BRT_OFFSET_MS).toISOString().slice(0, 10);
}

/** Meio-dia UTC de um "YYYY-MM-DD". */
export function noonOf(day: string): Date {
  return new Date(`${day.slice(0, 10)}T12:00:00.000Z`);
}

/** Instante qualquer (horário real, ex.: Pluggy) → meio-dia do dia dele no Brasil. */
export function brCalendarDay(instant: Date | string): Date {
  return noonOf(brDayString(instant));
}

/** Data digitada no app: "YYYY-MM-DD" vale como o dia digitado; com horário,
 * vale o dia no Brasil daquele instante. */
export function parseCalendarInput(input: Date | string): Date {
  if (typeof input === "string" && /^\d{4}-\d{2}-\d{2}$/.test(input)) return noonOf(input);
  return brCalendarDay(input);
}

/** Já está no padrão (meio-dia UTC)? Usado pela verificação de integridade. */
export function isCalendarNoon(d: Date): boolean {
  return d.getUTCHours() === 12 && d.getUTCMinutes() === 0 && d.getUTCSeconds() === 0 && d.getUTCMilliseconds() === 0;
}
