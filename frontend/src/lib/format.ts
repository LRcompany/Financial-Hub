export function currency(value: number) {
  return value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Símbolo da moeda de contrato/posição estrangeira (04/11, entrou o EUR). */
export function currencySymbol(code: string | null | undefined) {
  return code === 'EUR' ? '€' : code === 'USD' ? 'US$' : code === 'BRL' ? 'R$' : (code ?? '')
}
