export function PlaceholderPage({ title }: { title: string }) {
  return (
    <div>
      <h1 style={{ fontSize: '1.4rem', fontWeight: 600 }}>{title}</h1>
      <p style={{ color: 'var(--ink-soft)' }}>Ainda não desenhada — próxima tela depois da Visão Geral.</p>
    </div>
  )
}
