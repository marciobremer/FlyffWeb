'use client'

import { useCallback, useEffect, useState } from 'react'
import Swal from 'sweetalert2'
import { itemIcon } from '@/components/ItemShop'

const swal = { background: '#111827', color: '#fff' }
const input = 'rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-sm text-white'

async function call(method, body, query = '') {
  const res = await fetch(`/api/shop/admin${query}`, { method, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
  const d = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(d.error || 'Falha na operação.')
  return d
}

function Row({ item, onChange }) {
  const [f, setF] = useState({ price: item.price, quantity: item.quantity, currency: item.currency, isActive: !!item.is_active, discount: item.discount, category: item.category })
  const set = (k, v) => setF((o) => ({ ...o, [k]: v }))
  const save = async () => {
    try {
      await call('PUT', { id: item.id, description: item.description, ...f })
      await Swal.fire({ ...swal, icon: 'success', title: 'Salvo', timer: 1200, showConfirmButton: false })
      onChange()
    } catch (e) { Swal.fire({ ...swal, icon: 'error', title: 'Erro', text: e.message }) }
  }
  const remove = async () => {
    const ok = await Swal.fire({ ...swal, icon: 'warning', title: 'Remover da loja?', text: item.name, showCancelButton: true, confirmButtonText: 'Remover', cancelButtonText: 'Cancelar' })
    if (!ok.isConfirmed) return
    try { await call('DELETE', null, `?id=${item.id}`); onChange() } catch (e) { Swal.fire({ ...swal, icon: 'error', title: 'Erro', text: e.message }) }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-gray-700 bg-gray-800/60 p-2">
      <img src={itemIcon(item.icon)} alt="" width={32} height={32} />
      <span className="min-w-[160px] flex-1 text-sm text-white">{item.name}</span>
      <label className="text-xs text-gray-400">Preço <input type="number" min="0" value={f.price} onChange={(e) => set('price', Number(e.target.value))} className={`${input} w-24`} /></label>
      <select value={f.currency} onChange={(e) => set('currency', e.target.value)} className={input} aria-label="Tipo de ponto">
        <option value="cash">Cash Points</option>
        <option value="vote">Vote Points</option>
      </select>
      <label className="text-xs text-gray-400">Qtd. <input type="number" min="1" max="999" value={f.quantity} onChange={(e) => set('quantity', Number(e.target.value))} className={`${input} w-16`} /></label>
      <label className="text-xs text-gray-400">Desc. % <input type="number" min="0" max="90" value={f.discount} onChange={(e) => set('discount', Number(e.target.value))} className={`${input} w-16`} /></label>
      <label className="text-xs text-gray-400">Categoria <input value={f.category} maxLength={30} onChange={(e) => set('category', e.target.value)} className={`${input} w-32`} /></label>
      <label className="flex items-center gap-1 text-xs text-gray-300"><input type="checkbox" checked={f.isActive} onChange={(e) => set('isActive', e.target.checked)} /> À venda</label>
      <button type="button" onClick={save} className="rounded-lg bg-amber-600 px-3 py-1 text-xs font-bold text-white">Salvar</button>
      <button type="button" onClick={remove} className="rounded-lg bg-red-600 px-3 py-1 text-xs font-bold text-white">Remover</button>
    </div>
  )
}

// itens vendidos por pontos no site (aba Loja do painel)
export default function ShopItemsAdmin() {
  const [items, setItems] = useState([])
  const [q, setQ] = useState('')
  const [found, setFound] = useState([])

  const load = useCallback(() => { call('GET').then(setItems).catch(() => {}) }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (q.trim().length < 2) { setFound([]); return }
    const t = setTimeout(() => { fetch(`/shop-catalog?q=${encodeURIComponent(q.trim())}`).then((r) => r.json()).then(setFound).catch(() => setFound([])) }, 300)
    return () => clearTimeout(t)
  }, [q])

  const add = async (item) => {
    try {
      await call('POST', { itemId: item.id, price: 0, quantity: 1, currency: 'cash', isActive: false })
      setQ('')
      load()
    } catch (e) { Swal.fire({ ...swal, icon: 'error', title: 'Erro', text: e.message }) }
  }

  return (
    <div className="mt-8 space-y-3 border-t border-gray-700 pt-5">
      <h3 className="text-base font-bold text-amber-400">Itens vendidos por pontos</h3>
      <p className="text-xs text-gray-400">Defina o preço, marque “À venda” e salve. Só os marcados aparecem na loja (a do site e a de dentro do jogo).</p>
      <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Adicionar item: digite o nome (ex.: Sunstone)" className={`${input} w-full py-2`} />
      {found.length > 0 && (
        <div className="max-h-60 overflow-y-auto rounded-lg border border-gray-700 bg-gray-900">
          {found.map((i) => (
            <button type="button" key={i.id} onClick={() => add(i)} className="flex w-full items-center gap-2 px-3 py-1 text-left text-sm text-white hover:bg-gray-800">
              <img src={itemIcon(i.icon)} alt="" width={24} height={24} /> {i.name} <span className="text-xs text-gray-500">{i.symbol}</span>
            </button>
          ))}
        </div>
      )}
      {items.map((item) => <Row key={`${item.id}-${item.price}-${item.quantity}-${item.is_active}-${item.currency}-${item.discount}-${item.category}`} item={item} onChange={load} />)}
    </div>
  )
}
