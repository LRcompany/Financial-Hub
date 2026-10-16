/** Intensidade (1 a 4) do verde/vermelho de um dia em relação à meta diária
 * (pedido do Luiz, 01/10: "quanto maior for o valor, mais intenso será o
 * vermelho"). Quanto mais longe da meta — pra cima ou pra baixo — mais forte
 * a cor. Faixas fixas (não contínuas) pra cor continuar legível e o nível
 * ser comparável entre um mês e outro.
 * - Acima da meta: até 25% acima = 1, até 75% = 2, até 150% = 3, mais = 4.
 * - Abaixo da meta: gastou 75%+ da meta = 1, 50%+ = 2, 25%+ = 3, menos = 4. */
export function goalIntensity(amount: number, goal: number): 1 | 2 | 3 | 4 {
  if (goal <= 0) return amount > 0 ? 4 : 1
  const ratio = amount / goal
  if (amount > goal) {
    if (ratio <= 1.25) return 1
    if (ratio <= 1.75) return 2
    if (ratio <= 2.5) return 3
    return 4
  }
  if (ratio >= 0.75) return 1
  if (ratio >= 0.5) return 2
  if (ratio >= 0.25) return 3
  return 4
}
