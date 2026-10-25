'use client'

import { ArrowLeft, CheckCircle2, Crown, Gift, Loader2, Medal, RefreshCcw, Shield, Trophy } from 'lucide-react'
import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import Swal from 'sweetalert2'

function safeString(value) {
  return String(value || '').trim()
}

function formatAmount(value) {
  return Number(value || 0).toFixed(2)
}

function formatNumber(value) {
  return Number(value || 0).toLocaleString('fr-FR')
}

function todayInput() {
  return new Date().toISOString().slice(0, 10)
}

function firstDayOfMonth() {
  const now = new Date()
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString().slice(0, 10)
}

function rankBadge(rank) {
  if (rank === 1) return 'bg-yellow-500 text-black border-yellow-300'
  if (rank === 2) return 'bg-gray-300 text-black border-gray-100'
  if (rank === 3) return 'bg-orange-600 text-white border-orange-400'
  return 'bg-gray-800 text-gray-200 border-gray-700'
}

export default function AdminPayPalRankingPage() {
  const [authorized, setAuthorized] = useState(false)
  const [authLoading, setAuthLoading] = useState(true)
  const [period, setPeriod] = useState('current_month')
  const [start, setStart] = useState(firstDayOfMonth())
  const [end, setEnd] = useState(todayInput())
  const [ranking, setRanking] = useState([])
  const [periodInfo, setPeriodInfo] = useState(null)
  const [loading, setLoading] = useState(false)
  const [rewardInputs, setRewardInputs] = useState({
    1: { itemId: '', itemCount: '1' },
    2: { itemId: '', itemCount: '1' },
    3: { itemId: '', itemCount: '1' }
  })
  const [creditingRank, setCreditingRank] = useState(null)

  const topThree = useMemo(() => ranking.filter((row) => row.rank_position <= 3), [ranking])

  useEffect(() => {
    async function checkAuth() {
      try {
        const res = await fetch('/api/me', { credentials: 'include' })
        const data = await res.json().catch(() => ({}))

        if (!res.ok || data.role?.toLowerCase() !== 'super') {
          setAuthorized(false)
          await Swal.fire('Acces refuse', 'Vous devez etre super admin.', 'warning')
          window.location.href = '/'
          return
        }

        setAuthorized(true)
      } catch (err) {
        console.error('[ADMIN PAYPAL RANKING AUTH ERROR]', err)
        window.location.href = '/'
      } finally {
        setAuthLoading(false)
      }
    }

    checkAuth()
  }, [])

  async function fetchRanking() {
    setLoading(true)

    try {
      const params = new URLSearchParams({ period, limit: '20' })
      if (period === 'custom') {
        params.set('start', start)
        params.set('end', end)
      }

      const res = await fetch(`/api/admin/paypal-ranking?${params.toString()}`, {
        credentials: 'include',
        cache: 'no-store'
      })
      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Impossible de charger le classement PayPal')
      }

      setRanking(Array.isArray(data.ranking) ? data.ranking : [])
      setPeriodInfo(data.period || null)
    } catch (err) {
      console.error('[ADMIN PAYPAL RANKING LOAD ERROR]', err)
      Swal.fire('Erreur', err.message || 'Impossible de charger le classement.', 'error')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (authorized) fetchRanking()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authorized, period])

  function updateRewardInput(rank, field, value) {
    setRewardInputs((current) => ({
      ...current,
      [rank]: {
        ...(current[rank] || { itemId: '', itemCount: '1' }),
        [field]: value
      }
    }))
  }

  async function creditReward(row) {
    const rank = Number(row.rank_position)
    const itemId = Number(rewardInputs[rank]?.itemId)
    const itemCount = Number(rewardInputs[rank]?.itemCount || 1)

    if (!Number.isInteger(itemId) || itemId <= 0) {
      Swal.fire('ItemID invalide', 'Entre un ItemID valide pour ce rang.', 'warning')
      return
    }

    if (!Number.isInteger(itemCount) || itemCount <= 0) {
      Swal.fire('Quantite invalide', 'Entre une quantite valide.', 'warning')
      return
    }

    const confirm = await Swal.fire({
      title: `Crediter le rang #${rank} ?`,
      html: `
        <div style="text-align:left;line-height:1.6">
          <p><b>Personnage :</b> ${safeString(row.character_name)}</p>
          <p><b>ItemID :</b> ${itemId}</p>
          <p><b>Quantite :</b> ${itemCount}</p>
          <p><b>Periode :</b> ${safeString(periodInfo?.label)}</p>
          <p style="margin-top:10px;color:#fbbf24">L item sera envoye par courrier en jeu.</p>
        </div>
      `,
      icon: 'question',
      showCancelButton: true,
      confirmButtonText: 'Oui, crediter',
      cancelButtonText: 'Annuler',
      background: '#111827',
      color: '#fff'
    })

    if (!confirm.isConfirmed) return

    setCreditingRank(rank)

    try {
      const body = {
        period,
        start: period === 'custom' ? start : undefined,
        end: period === 'custom' ? end : undefined,
        rankPosition: rank,
        itemId,
        itemCount
      }

      const res = await fetch('/api/admin/paypal-ranking/reward', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
      })

      const data = await res.json().catch(() => ({}))

      if (!res.ok || !data.success) {
        throw new Error(data.error || 'Impossible de crediter la recompense')
      }

      await Swal.fire(
        data.alreadyCredited ? 'Deja credite' : 'Recompense creditee',
        data.message || 'Operation terminee.',
        data.alreadyCredited ? 'info' : 'success'
      )

      await fetchRanking()
    } catch (err) {
      console.error('[ADMIN CREDIT REWARD ERROR]', err)
      Swal.fire('Erreur', err.message || 'Impossible de crediter la recompense.', 'error')
    } finally {
      setCreditingRank(null)
    }
  }

  if (authLoading) {
    return (
      <section className="min-h-screen bg-black text-white flex items-center justify-center pt-24">
        <div className="flex items-center gap-3 text-amber-300">
          <Loader2 className="w-5 h-5 animate-spin" /> Verification admin...
        </div>
      </section>
    )
  }

  if (!authorized) return null

  return (
    <section className="min-h-screen bg-black px-4 py-24 text-white relative overflow-hidden">
      <div className="absolute inset-0 bg-[url('/bg.png')] bg-cover bg-center opacity-20" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/80 via-black/75 to-black" />

      <div className="relative z-10 max-w-7xl mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <Link href="/admin" className="inline-flex items-center gap-2 rounded-xl border border-gray-700 bg-gray-900 px-4 py-2 text-sm font-bold text-gray-200 hover:border-amber-400">
            <ArrowLeft className="w-4 h-4" /> Retour admin
          </Link>
          <button
            onClick={fetchRanking}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-black hover:bg-amber-400 disabled:opacity-60"
          >
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
            Actualiser
          </button>
        </div>

        <div className="rounded-3xl border border-amber-500/20 bg-gray-950/80 backdrop-blur p-6 md:p-8 shadow-2xl">
          <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-5">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/30 bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-300 mb-4">
                <Shield className="w-4 h-4" /> Admin recompenses PayPal
              </div>
              <h1 className="text-3xl md:text-4xl font-black text-white mb-2">Classement PayPal</h1>
              <p className="text-gray-300 max-w-3xl">
                Top des personnages qui ont achete via PayPal. Le compte Flyff reste masque. Les recompenses sont envoyees par courrier en jeu avec l ItemID choisi.
              </p>
            </div>

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                onClick={() => setPeriod('current_month')}
                className={`rounded-xl px-4 py-2 text-sm font-bold border transition ${period === 'current_month' ? 'bg-amber-500 text-black border-amber-300' : 'bg-gray-900 text-gray-200 border-gray-700 hover:border-amber-400'}`}
              >
                Mois actuel
              </button>
              <button
                onClick={() => setPeriod('all')}
                className={`rounded-xl px-4 py-2 text-sm font-bold border transition ${period === 'all' ? 'bg-amber-500 text-black border-amber-300' : 'bg-gray-900 text-gray-200 border-gray-700 hover:border-amber-400'}`}
              >
                Tout
              </button>
              <button
                onClick={() => setPeriod('custom')}
                className={`rounded-xl px-4 py-2 text-sm font-bold border transition ${period === 'custom' ? 'bg-amber-500 text-black border-amber-300' : 'bg-gray-900 text-gray-200 border-gray-700 hover:border-amber-400'}`}
              >
                Custom
              </button>
            </div>
          </div>

          {period === 'custom' && (
            <div className="mt-5 grid sm:grid-cols-[1fr_1fr_auto] gap-3">
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
              />
              <input
                type="date"
                value={end}
                onChange={(e) => setEnd(e.target.value)}
                className="rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white"
              />
              <button onClick={fetchRanking} className="rounded-xl bg-amber-500 px-4 py-2 text-sm font-black text-black hover:bg-amber-400">
                Charger
              </button>
            </div>
          )}

          {periodInfo?.label && (
            <p className="mt-5 text-sm text-amber-200">Periode active : {periodInfo.label}</p>
          )}
        </div>

        <div className="grid lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((rank) => {
            const row = topThree.find((item) => item.rank_position === rank)
            const credited = Boolean(row?.reward_id)

            return (
              <div key={rank} className="rounded-2xl border border-gray-800 bg-gray-950 p-5 shadow-xl">
                <div className="flex items-center justify-between mb-4">
                  <span className={`inline-flex items-center justify-center w-12 h-12 rounded-xl border font-black ${rankBadge(rank)}`}>
                    <Medal className="w-6 h-6" />
                  </span>
                  {credited && (
                    <span className="inline-flex items-center gap-1 rounded-full border border-green-400/30 bg-green-500/10 px-3 py-1 text-xs font-bold text-green-300">
                      <CheckCircle2 className="w-3 h-3" /> Credite
                    </span>
                  )}
                </div>

                {row ? (
                  <>
                    <h2 className="text-xl font-black text-white flex items-center gap-2">
                      {rank === 1 && <Crown className="w-5 h-5 text-amber-300" />}
                      #{rank} {row.character_name}
                    </h2>
                    <p className="text-sm text-gray-400 mt-1">
                      {formatAmount(row.total_amount)} EUR - {formatNumber(row.total_points)} points - {formatNumber(row.total_orders)} paiements
                    </p>

                    <div className="mt-5 grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs font-bold text-gray-400 mb-1">ItemID</label>
                        <input
                          type="number"
                          min="1"
                          disabled={credited}
                          value={credited ? row.reward_item_id || '' : rewardInputs[rank]?.itemId || ''}
                          onChange={(e) => updateRewardInput(rank, 'itemId', e.target.value)}
                          className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-60"
                          placeholder="ex: 12345"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 mb-1">Quantite</label>
                        <input
                          type="number"
                          min="1"
                          disabled={credited}
                          value={credited ? row.reward_item_count || 1 : rewardInputs[rank]?.itemCount || '1'}
                          onChange={(e) => updateRewardInput(rank, 'itemCount', e.target.value)}
                          className="w-full rounded-xl border border-gray-700 bg-gray-900 px-3 py-2 text-sm text-white disabled:opacity-60"
                        />
                      </div>
                    </div>

                    <button
                      onClick={() => creditReward(row)}
                      disabled={credited || creditingRank === rank}
                      className="mt-4 w-full inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 font-black text-black hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed"
                    >
                      {creditingRank === rank ? <Loader2 className="w-4 h-4 animate-spin" /> : <Gift className="w-4 h-4" />}
                      {credited ? 'Deja credite' : 'Crediter la recompense'}
                    </button>
                  </>
                ) : (
                  <p className="text-gray-500">Aucun joueur pour ce rang.</p>
                )}
              </div>
            )
          })}
        </div>

        <div className="rounded-2xl border border-gray-800 bg-gray-950 overflow-hidden shadow-2xl">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-900 text-gray-400 uppercase text-xs">
                <tr>
                  <th className="px-4 py-3 text-left">Rang</th>
                  <th className="px-4 py-3 text-left">Personnage</th>
                  <th className="px-4 py-3 text-right">Total PayPal</th>
                  <th className="px-4 py-3 text-right">Points</th>
                  <th className="px-4 py-3 text-right">Paiements</th>
                  <th className="px-4 py-3 text-right">Recompense</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {loading ? (
                  <tr>
                    <td colSpan="6" className="px-4 py-10 text-center text-gray-400">
                      <Loader2 className="w-5 h-5 animate-spin inline mr-2 text-amber-400" /> Chargement...
                    </td>
                  </tr>
                ) : ranking.length === 0 ? (
                  <tr>
                    <td colSpan="6" className="px-4 py-10 text-center text-gray-400">
                      Aucun paiement confirme pour cette periode.
                    </td>
                  </tr>
                ) : ranking.map((row) => (
                  <tr key={`${row.rank_position}-${row.character_name}`} className="hover:bg-gray-900/70 transition">
                    <td className="px-4 py-4 font-black text-amber-300">#{row.rank_position}</td>
                    <td className="px-4 py-4 font-bold text-white">{row.character_name}</td>
                    <td className="px-4 py-4 text-right text-amber-300 font-black">{formatAmount(row.total_amount)} EUR</td>
                    <td className="px-4 py-4 text-right text-gray-200">{formatNumber(row.total_points)}</td>
                    <td className="px-4 py-4 text-right text-gray-400">{formatNumber(row.total_orders)}</td>
                    <td className="px-4 py-4 text-right">
                      {row.reward_id ? (
                        <span className="text-green-300 font-bold">Item {row.reward_item_id} x{row.reward_item_count}</span>
                      ) : row.rank_position <= 3 ? (
                        <span className="text-amber-300">Disponible</span>
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
      </div>
    </section>
  )
}
