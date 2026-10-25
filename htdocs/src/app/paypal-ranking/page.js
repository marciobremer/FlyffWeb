'use client'

import { Crown, Gift, Loader2, Medal, Trophy } from 'lucide-react'
import { useEffect, useState } from 'react'

function rankBadge(rank) {
  if (rank === 1) return 'bg-yellow-500 text-black border-yellow-300'
  if (rank === 2) return 'bg-gray-300 text-black border-gray-100'
  if (rank === 3) return 'bg-orange-600 text-white border-orange-400'
  return 'bg-gray-800 text-gray-200 border-gray-700'
}

export default function PayPalRankingPage() {
  const [period, setPeriod] = useState('current_month')
  const [ranking, setRanking] = useState([])
  const [periodInfo, setPeriodInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    let mounted = true

    async function loadRanking() {
      setLoading(true)
      setError('')

      try {
        const params = new URLSearchParams({ period, limit: '20' })
        const res = await fetch(`/api/paypal-ranking?${params.toString()}`, { cache: 'no-store' })
        const data = await res.json().catch(() => ({}))

        if (!res.ok || !data.success) {
          throw new Error(data.error || 'Não foi possível carregar o ranking')
        }

        if (mounted) {
          setRanking(Array.isArray(data.ranking) ? data.ranking : [])
          setPeriodInfo(data.period || null)
        }
      } catch (err) {
        if (mounted) setError(err.message || 'Erro no ranking')
      } finally {
        if (mounted) setLoading(false)
      }
    }

    loadRanking()

    return () => {
      mounted = false
    }
  }, [period])

  return (
    <section className="min-h-screen bg-black px-4 py-24 text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-[url('/bg.png')] bg-cover bg-center opacity-20" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/75 to-black" />

      <div className="relative z-10 max-w-6xl mx-auto space-y-6">
        <div className="rounded-3xl border border-amber-500/20 bg-gray-950/80 backdrop-blur p-6 md:p-8 shadow-2xl">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-300 mb-4">
                <Trophy className="w-4 h-4" /> Ranking PayPal
              </div>

              <h1 className="text-3xl md:text-4xl font-black text-white mb-2">Top doadores</h1>

              <p className="text-gray-300 max-w-2xl">
                Ranking baseado nos pagamentos PayPal confirmados. Só o nome do personagem é exibido.
              </p>

              <p className="mt-3 text-amber-200 font-bold max-w-2xl">
                Os 3 primeiros personagens do ranking recebem uma recompensa especial no jogo.
              </p>

              <p className="mt-2 text-sm text-gray-400 max-w-2xl">
                Valores, pontos comprados e número de pagamentos ficam ocultos para preservar a privacidade dos jogadores.
              </p>
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => setPeriod('current_month')}
                className={`rounded-xl px-4 py-2 text-sm font-bold border transition ${period === 'current_month' ? 'bg-amber-500 text-black border-amber-300' : 'bg-gray-900 text-gray-200 border-gray-700 hover:border-amber-400'}`}
              >
                Mês atual
              </button>
              <button
                onClick={() => setPeriod('all')}
                className={`rounded-xl px-4 py-2 text-sm font-bold border transition ${period === 'all' ? 'bg-amber-500 text-black border-amber-300' : 'bg-gray-900 text-gray-200 border-gray-700 hover:border-amber-400'}`}
              >
                Todos
              </button>
            </div>
          </div>

          {periodInfo?.label && (
            <p className="mt-5 text-sm text-amber-200">Período: {periodInfo.label}</p>
          )}
        </div>

        <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100 flex gap-3">
          <Gift className="w-5 h-5 shrink-0 text-amber-300 mt-0.5" />
          <p>
            As recompensas vão para as posições 1, 2 e 3 e são creditadas manualmente pela administração.
          </p>
        </div>

        {loading ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-950 p-10 flex items-center justify-center gap-3 text-gray-300">
            <Loader2 className="w-5 h-5 animate-spin text-amber-400" /> Carregando o ranking...
          </div>
        ) : error ? (
          <div className="rounded-2xl border border-red-500/40 bg-red-950/40 p-6 text-red-200">
            {error}
          </div>
        ) : ranking.length === 0 ? (
          <div className="rounded-2xl border border-gray-800 bg-gray-950 p-10 text-center text-gray-400">
            Nenhum pagamento PayPal confirmado neste período.
          </div>
        ) : (
          <div className="rounded-2xl border border-gray-800 bg-gray-950 overflow-hidden shadow-2xl">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-900 text-gray-400 uppercase text-xs">
                  <tr>
                    <th className="px-4 py-3 text-left">Posição</th>
                    <th className="px-4 py-3 text-left">Personagem</th>
                    <th className="px-4 py-3 text-right">Total PayPal</th>
                    <th className="px-4 py-3 text-right">Pontos comprados</th>
                    <th className="px-4 py-3 text-right">Pagamentos</th>
                    <th className="px-4 py-3 text-right">Recompensa</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-gray-800">
                  {ranking.map((row) => (
                    <tr key={`${row.rank_position}-${row.character_name}`} className="hover:bg-gray-900/70 transition">
                      <td className="px-4 py-4">
                        <span className={`inline-flex items-center justify-center w-10 h-10 rounded-xl border font-black ${rankBadge(row.rank_position)}`}>
                          {row.rank_position <= 3 ? <Medal className="w-5 h-5" /> : row.rank_position}
                        </span>
                      </td>

                      <td className="px-4 py-4">
                        <div className="flex items-center gap-2 font-bold text-white">
                          {row.rank_position === 1 && <Crown className="w-4 h-4 text-amber-300" />}
                          {row.character_name}
                        </div>
                      </td>

                      <td className="px-4 py-4 text-right font-black text-amber-300">XXX</td>
                      <td className="px-4 py-4 text-right text-gray-200">XXX</td>
                      <td className="px-4 py-4 text-right text-gray-400">XXX</td>

                      <td className="px-4 py-4 text-right">
                        {row.rank_position <= 3 ? (
                          <span className="inline-flex items-center justify-end gap-1 font-bold text-amber-300">
                            <Gift className="w-4 h-4" /> Sim
                          </span>
                        ) : (
                          <span className="text-gray-500">-</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}