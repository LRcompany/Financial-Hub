import { useEffect, useState, type FormEvent } from 'react'
import { Plus, Pencil, Trash2, ChevronRight, ChevronDown } from 'lucide-react'
import { api, type Category, type CategoryKind } from '../lib/api'
import { Input } from './Input'
import { Select } from './Select'
import styles from './CategoryManager.module.css'

const KIND_LABELS: Record<CategoryKind, string> = {
  essential: 'Essencial',
  non_essential: 'Não essencial',
  investment: 'Investimento',
}

/** Formulário compartilhado por "nova categoria-mãe", "nova subcategoria" e
 * "editar" — só muda o que fica visível/travado em cada caso. `type` nunca é
 * editável depois de criada (mudar de despesa pra receita reorganizaria a
 * árvore inteira, fora do escopo de "editar, remover e adicionar"). */
function CategoryForm({
  initial,
  fixedType,
  onCancel,
  onSave,
}: {
  initial?: Category
  fixedType?: 'income' | 'expense'
  onCancel: () => void
  onSave: (input: { name: string; type?: 'income' | 'expense'; kind?: CategoryKind }) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [type, setType] = useState<'income' | 'expense'>(initial?.type ?? fixedType ?? 'expense')
  const [kind, setKind] = useState<CategoryKind>(initial?.kind ?? 'non_essential')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const typeIsLocked = !!initial || !!fixedType

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSaving(true)
    setError(null)
    try {
      await onSave({ name: name.trim(), type: typeIsLocked ? undefined : type, ...(type === 'expense' ? { kind } : {}) })
    } catch (err) {
      setError((err as Error).message)
      setSaving(false)
    }
  }

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <Input placeholder="Nome da categoria" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      {!typeIsLocked && (
        <Select value={type} onChange={(e) => setType(e.target.value as 'income' | 'expense')}>
          <option value="expense">Despesa</option>
          <option value="income">Receita</option>
        </Select>
      )}
      {type === 'expense' && (
        <Select value={kind} onChange={(e) => setKind(e.target.value as CategoryKind)}>
          <option value="essential">Essencial</option>
          <option value="non_essential">Não essencial</option>
          <option value="investment">Investimento</option>
        </Select>
      )}
      <div className={styles.formActions}>
        <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={saving}>
          Cancelar
        </button>
        <button type="submit" className={styles.saveBtn} disabled={saving}>
          {saving ? 'Salvando...' : 'Salvar'}
        </button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
    </form>
  )
}

function CategoryNode({ category, depth, onChanged }: { category: Category; depth: number; onChanged: () => void }) {
  const [expanded, setExpanded] = useState(false)
  const [mode, setMode] = useState<'view' | 'edit' | 'addChild'>('view')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const children = category.children ?? []
  const hasChildren = children.length > 0
  const canAddChild = depth < 3 // mãe(1) > filho(2) > neto(3) — neto não tem filho

  async function handleDelete() {
    if (!confirmDelete) {
      setConfirmDelete(true)
      setDeleteError(null)
      return
    }
    setBusy(true)
    try {
      await api.deleteCategory(category.id)
      onChanged()
    } catch (err) {
      setDeleteError((err as Error).message)
      setConfirmDelete(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={styles.node}>
      <div className={styles.row} style={{ paddingLeft: (depth - 1) * 20 }}>
        {hasChildren ? (
          <button className={styles.toggle} onClick={() => setExpanded((v) => !v)} aria-label="Expandir">
            {expanded ? <ChevronDown size={14} strokeWidth={2} /> : <ChevronRight size={14} strokeWidth={2} />}
          </button>
        ) : (
          <span className={styles.toggleSpacer} />
        )}

        {mode === 'edit' ? (
          <div className={styles.inlineForm}>
            <CategoryForm
              initial={category}
              onCancel={() => setMode('view')}
              onSave={async (input) => {
                await api.updateCategory(category.id, { name: input.name, kind: input.kind })
                setMode('view')
                onChanged()
              }}
            />
          </div>
        ) : (
          <>
            <span className={styles.name}>{category.name}</span>
            {category.type === 'expense' ? (
              <span className={styles.kindBadge}>{KIND_LABELS[category.kind]}</span>
            ) : (
              <span className={styles.incomeBadge}>Receita</span>
            )}
            <div className={styles.actions}>
              {canAddChild && (
                <button className={styles.iconBtn} onClick={() => setMode('addChild')} title="Nova subcategoria" aria-label="Nova subcategoria">
                  <Plus size={13} strokeWidth={2} />
                </button>
              )}
              <button className={styles.iconBtn} onClick={() => setMode('edit')} title="Editar" aria-label="Editar">
                <Pencil size={13} strokeWidth={2} />
              </button>
              <button
                className={confirmDelete ? styles.iconBtnDangerConfirm : styles.iconBtnDanger}
                onClick={handleDelete}
                disabled={busy}
                title="Excluir"
                aria-label="Excluir"
              >
                <Trash2 size={13} strokeWidth={2} />
              </button>
            </div>
          </>
        )}
      </div>

      {deleteError && (
        <div className={styles.error} style={{ marginLeft: (depth - 1) * 20 + 22 }}>
          {deleteError}
        </div>
      )}

      {mode === 'addChild' && (
        <div className={styles.inlineForm} style={{ marginLeft: (depth - 1) * 20 + 22 }}>
          <CategoryForm
            fixedType={category.type}
            onCancel={() => setMode('view')}
            onSave={async (input) => {
              await api.createCategory({ name: input.name, kind: input.kind, parentId: category.id })
              setMode('view')
              setExpanded(true)
              onChanged()
            }}
          />
        </div>
      )}

      {expanded && hasChildren && (
        <div>
          {children.map((child) => (
            <CategoryNode key={child.id} category={child} depth={depth + 1} onChanged={onChanged} />
          ))}
        </div>
      )}
    </div>
  )
}

/** Seção de Configurações pra manter a árvore de categorias sem precisar
 * mexer no banco na mão — CRUD completo, com a mesma proteção contra apagar
 * dado real que o resto do app já usa (recusa em vez de cascata). */
export function CategoryManager() {
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [addingRoot, setAddingRoot] = useState(false)

  function load() {
    api
      .categories()
      .then((data) => {
        setCategories(data)
        setError(null)
      })
      .catch(() => setError('Não consegui carregar as categorias.'))
      .finally(() => setLoading(false))
  }

  useEffect(load, [])

  return (
    <div className={styles.wrap}>
      {error && <div className={styles.error}>{error}</div>}
      {loading ? (
        <div className={styles.loading}>Carregando categorias...</div>
      ) : (
        <div className={styles.list}>
          {categories.map((c) => (
            <CategoryNode key={c.id} category={c} depth={1} onChanged={load} />
          ))}
        </div>
      )}

      {addingRoot ? (
        <div className={styles.inlineForm}>
          <CategoryForm
            onCancel={() => setAddingRoot(false)}
            onSave={async (input) => {
              await api.createCategory({ name: input.name, type: input.type, kind: input.kind })
              setAddingRoot(false)
              load()
            }}
          />
        </div>
      ) : (
        <button className={styles.addRootBtn} onClick={() => setAddingRoot(true)}>
          <Plus size={14} strokeWidth={2} />
          Nova categoria-mãe
        </button>
      )}
    </div>
  )
}
