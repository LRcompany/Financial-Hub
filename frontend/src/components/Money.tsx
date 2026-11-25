import { usePrivacy } from '../lib/PrivacyContext'
import styles from './Money.module.css'

/** Envolve QUALQUER valor em R$ visível na tela — único lugar que aplica o
 * blur do modo privacidade (pedido do Luiz, 11/09). Nunca envolver rótulo,
 * categoria, percentual, data ou quantidade aqui, só o número monetário em
 * si (`R$ 1.234,56`, incluindo o prefixo "R$" — a intenção é esconder o
 * valor, não só o dígito). Quando o modo privacidade está desligado, isso é
 * um `<span>` transparente, sem nenhum efeito colateral de layout. */
export function Money({ children }: { children: React.ReactNode }) {
  const { hidden } = usePrivacy()
  return <span className={hidden ? styles.hidden : undefined}>{children}</span>
}
