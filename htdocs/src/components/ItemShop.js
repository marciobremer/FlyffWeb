'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import Swal from 'sweetalert2'

export const itemIcon = (icon) => `/shop-icons/${encodeURIComponent(icon)}`
export const currencyName = (c) => (c === 'vote' ? 'Vote Points' : 'Cash Points')

const swal = { background: '#111827', color: '#fff' }

// vitrine da loja de itens: o jogador escolhe o personagem e compra com os pontos da conta
export default function ItemShop() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  const [character, setCharacter] = useState('')

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/shop', { cache: 'no-store' })
      const d = await res.json()
      if (!res.ok) throw new Error(d.error)
      setData(d)
      setError('')
      setCharacter((c) => c || String(d.account?.characters[0]?.id ?? ''))
    } catch (e) {
      setError(e.message || 'Não foi possível carregar a loja de itens')
    }
  }, [])

  useEffect(() => { load() }, [load])

  const buy = async (item) => {
    const who = data.account.characters.find((c) => String(c.id) === character)
    if (!who) return Swal.fire({ ...swal, icon: 'warning', title: 'Escolha um personagem' })
    const ok = await Swal.fire({
      ...swal, icon: 'question', title: 'Confirmar compra', showCancelButton: true, confirmButtonText: 'Comprar', cancelButtonText: 'Cancelar',
      text: `${item.quantity}x ${item.name} por ${item.final} ${currencyName(item.currency)}, entregue para ${who.name}.`,
    })
    if (!ok.isConfirmed) return
    const res = await fetch('/api/shop/buy', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ itemId: item.id, price: item.final, characterId: who.id }) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) await Swal.fire({ ...swal, icon: 'error', title: 'Compra não feita', text: d.error || 'Tente novamente.' })
    else await Swal.fire({ ...swal, icon: 'success', title: 'Compra feita!', text: `O item chega a ${d.character} em alguns segundos se estiver online; senão, quando entrar no jogo.` })
    load()
  }

  if (error) return <p className="text-center text-red-400 py-10">{error}</p>
  if (!data) return <p className="text-center text-gray-400 py-10">Carregando...</p>
  const acc = data.account

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-700 bg-gray-900/70 p-4 text-sm text-gray-300">
        {acc ? (
          <>
            <span><b className="text-amber-400">{acc.cash}</b> Cash Points</span>
            <span><b className="text-sky-400">{acc.votepoint}</b> Vote Points</span>
            <label className="ml-auto flex items-center gap-2">
              Entregar para
              <select value={character} onChange={(e) => setCharacter(e.target.value)} className="rounded-lg border border-gray-700 bg-gray-800 px-2 py-1 text-white">
                {acc.characters.length === 0 && <option value="">Sem personagens</option>}
                {acc.characters.map((c) => <option key={c.id} value={c.id}>{c.name} (Nv. {c.level})</option>)}
              </select>
            </label>
          </>
        ) : (
          <span><Link href="/login" className="text-amber-400 underline">Entre na sua conta</Link> para comprar.</span>
        )}
      </div>

      {acc?.pending.length > 0 && (
        <p className="rounded-xl border border-amber-700 bg-amber-950/40 p-3 text-sm text-amber-200">
          Aguardando entrega: {acc.pending.map((p) => `${p.pending}x ${p.name} (${p.character})`).join(', ')}.
        </p>
      )}

      {data.items.length === 0 ? (
        <p className="rounded-xl border border-gray-700 bg-gray-900/70 p-10 text-center text-gray-400">Nenhum item à venda no momento.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((item) => (
            <div key={item.id} className="flex flex-col gap-2 rounded-xl border border-gray-700 bg-gray-900/80 p-4">
              <div className="flex items-center gap-3">
                <img src={itemIcon(item.icon)} alt="" width={32} height={32} style={{ imageRendering: 'pixelated' }} />
                <h3 className="font-bold text-amber-400">{item.name}{item.quantity > 1 ? ` x${item.quantity}` : ''}</h3>
              </div>
              <p className="flex-1 text-xs text-gray-400">{item.description}</p>
              <p className="text-sm font-bold text-white">
                {item.discount > 0 && <span className="mr-2 text-xs text-gray-500 line-through">{item.price}</span>}
                {item.final} {currencyName(item.currency)}
                {item.discount > 0 && <span className="ml-2 text-xs text-green-400">-{item.discount}%</span>}
              </p>
              <button type="button" disabled={!acc} onClick={() => buy(item)} className="rounded-lg bg-amber-600 py-2 text-sm font-bold text-white hover:bg-amber-500 disabled:opacity-40">
                Comprar
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
