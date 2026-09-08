import type { ButtonHTMLAttributes } from 'react'
import styles from './IconButton.module.css'

type IconButtonSize = 'sm' | 'lg'
type IconButtonVariant = 'default' | 'ghost' | 'danger' | 'dangerConfirm'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  size?: IconButtonSize
  variant?: IconButtonVariant
}

/** Único botão de ícone do app — antes disso existiam 11 arquivos .module.css
 * diferentes redefinindo esse mesmo elemento do zero (pedido do Luiz, 08/09,
 * ao notar a inconsistência num print de Configurações: "você não carrega
 * uma lib só? toda hora precisa criar um elemento?"). Achado real na
 * auditoria: 8 lugares usavam 28px/--r-sm, 3 usavam 24-26px/--r-full — nenhuma
 * dessas variações de tamanho/formato era intencional, só cópia levemente
 * diferente cada vez. Toda tela nova entra AQUI — nunca recriar um botão de
 * ícone num .module.css novo.
 *
 * `size`: 'sm' (28px, padrão — fechar modal, ação de linha) | 'lg' (40px,
 * só o header do app, precisa de alvo de toque maior).
 * `variant`: 'default' (fundo sempre visível — ação de destaque, ex: fechar
 * modal) | 'ghost' (transparente até o hover — ação secundária dentro de
 * uma lista) | 'danger' (ícone vermelho, ex: excluir com efeito imediato) |
 * 'dangerConfirm' (fundo vermelho suave — 2º clique de exclusão "tem
 * certeza?", ver CategoryManager). */
export function IconButton({ size = 'sm', variant = 'default', className, ...props }: IconButtonProps) {
  return <button className={`${styles.btn} ${styles[size]} ${styles[variant]} ${className ?? ''}`} {...props} />
}
