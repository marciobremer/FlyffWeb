'use client'

import { Trophy, Clock, Shield, Filter, ChevronLeft, ChevronRight, Crown, Medal, Users, Target, Award, TrendingUp, Sparkles, Gem } from 'lucide-react'
import { getJobName, getJobColor, getJobImage } from '@/utils/jobUtils'
import { useEffect, useState } from 'react'
import { formatPlayTime } from '@/utils/formatPlayTime'
import Image from 'next/image'

const PLAYERS_PER_PAGE = 10

const jobFilters = {
  '1ª classe': [
    { id: 1, name: 'Mercenary' },
    { id: 2, name: 'Acrobat' },
    { id: 3, name: 'Assist' },
    { id: 4, name: 'Magician' },
    { id: 5, name: 'Indisponível' },
  ],
  'Avançada': [
    { id: 6, name: 'Knight' },
    { id: 7, name: 'Blade' },
    { id: 8, name: 'Jester' },
    { id: 9, name: 'Ranger' },
    { id: 10, name: 'Ringmaster' },
    { id: 11, name: 'Billposter' },
    { id: 12, name: 'Psykeeper' },
    { id: 13, name: 'Elementor' },
  ],
  'Master': [
    { id: 32, name: 'Templar' },
    { id: 33, name: 'Slayer' },
    { id: 34, name: 'Harlequin' },
    { id: 35, name: 'Crackshooter' },
    { id: 36, name: 'Seraph' },
    { id: 37, name: 'Force Master' },
    { id: 38, name: 'Mentalist' },
    { id: 39, name: 'Arcanist' },
  ]
}

export default function RankingPage() {
  const [players, setPlayers] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selectedJob, setSelectedJob] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [expandedTier, setExpandedTier] = useState(null)
  const [imageErrors, setImageErrors] = useState({})
  const [rankingType, setRankingType] = useState('level')

  const handleImageError = (jobId) => {
    setImageErrors(prev => ({
      ...prev,
      [jobId]: true
    }))
  }

  useEffect(() => {
    const fetchRankings = async () => {
      try {
        const response = await fetch('/api/rankings')
        const data = await response.json()
        
        if (!data.success) {
          throw new Error(data.error || 'Não foi possível carregar o ranking')
        }
        
        setPlayers(data.players)
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }

    fetchRankings()
  }, [])

  useEffect(() => {
    setCurrentPage(1)
  }, [selectedJob])

  const filteredPlayers = selectedJob
    ? players.filter(player => player.m_nJob === selectedJob)
    : players

  const totalPages = Math.ceil(filteredPlayers.length / PLAYERS_PER_PAGE)
  const startIndex = (currentPage - 1) * PLAYERS_PER_PAGE
  const paginatedPlayers = filteredPlayers.slice(startIndex, startIndex + PLAYERS_PER_PAGE)

  const getPageNumbers = () => {
    const pageNumbers = []
    const maxVisiblePages = 5
    let startPage = Math.max(1, currentPage - 2)
    let endPage = Math.min(totalPages, startPage + maxVisiblePages - 1)

    if (endPage - startPage + 1 < maxVisiblePages) {
      startPage = Math.max(1, endPage - maxVisiblePages + 1)
    }

    for (let i = startPage; i <= endPage; i++) {
      pageNumbers.push(i)
    }

    return pageNumbers
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-black relative overflow-hidden">
        <img src="/bg.png" alt="" className="absolute inset-0 w-full h-full object-cover z-0" />
        <div className="absolute inset-0 bg-black/70 z-[1]" />
        <div className="relative z-10 max-w-7xl mx-auto px-4 pt-24 sm:pt-28 pb-12">
          <div className="text-center mb-12">
            <div className="h-14 w-72 bg-gray-800 rounded-2xl mx-auto animate-pulse mb-4" />
            <div className="h-5 w-48 bg-gray-800 rounded-xl mx-auto animate-pulse" />
          </div>
          <div className="flex justify-center items-end gap-4 mb-12">
            <div className="w-64 h-48 bg-gray-900 border border-gray-700 rounded-2xl animate-pulse" />
            <div className="w-72 h-56 bg-gray-900 border border-amber-500/30 rounded-2xl animate-pulse" />
            <div className="w-64 h-48 bg-gray-900 border border-gray-700 rounded-2xl animate-pulse" />
          </div>
          <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-6">
            <div className="h-8 w-40 bg-gray-800 rounded-lg mb-6 animate-pulse" />
            <div className="space-y-3">
              {[...Array(10)].map((_, i) => (
                <div key={i} className="h-12 bg-gray-800/50 rounded-xl animate-pulse" />
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center relative overflow-hidden">
        <img src="/bg.png" alt="" className="absolute inset-0 w-full h-full object-cover z-0" />
        <div className="absolute inset-0 bg-black/70 z-[1]" />
        <div className="relative z-10 bg-gray-900 border border-amber-500/30 rounded-2xl p-8 max-w-md w-full text-center shadow-xl">
          <div className="w-14 h-14 bg-amber-500/20 rounded-xl flex items-center justify-center mx-auto mb-4 border border-amber-500/30">
            <Shield className="w-7 h-7 text-amber-400" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Erro ao carregar o ranking</h2>
          <p className="text-gray-400 mb-6">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="w-full py-2.5 rounded-lg font-semibold text-black bg-amber-500 border border-amber-400 hover:bg-amber-400 transition-colors"
          >
            Tentar de novo
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black relative overflow-hidden">
      <img src="/bg.png" alt="" className="absolute inset-0 w-full h-full object-cover z-0" />
      <div className="absolute inset-0 bg-black/70 z-[1]" />

      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-24 sm:pt-28 pb-12">
        <div className="text-center mb-10">
          <div className="inline-flex items-center gap-3 mb-4">
            <div className="w-14 h-14 bg-amber-500 rounded-xl flex items-center justify-center border border-amber-400/40 shadow-lg shadow-amber-500/20">
              <Trophy className="w-7 h-7 text-black" />
            </div>
            <div className="text-left">
              <h1 className="text-3xl sm:text-4xl font-bold text-white">Ranking de Elite</h1>
              <p className="text-amber-400 text-sm mt-0.5">Os campeões do ReactioN MMO</p>
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 max-w-3xl mx-auto">
            {[
              { icon: Users, value: filteredPlayers.length, label: 'Jogadores' },
              { icon: Target, value: 'Ao vivo', label: 'Ranking' },
              { icon: TrendingUp, value: '24/7', label: 'Atualizado' },
              { icon: Award, value: 'Elite', label: 'Recompensas' },
            ].map(({ icon: Icon, value, label }) => (
              <div key={label} className="bg-gray-900 border border-amber-500/30 rounded-xl p-3 flex items-center gap-3">
                <div className="w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                  <Icon className="w-4 h-4 text-amber-400" />
                </div>
                <div>
                  <p className="text-lg font-bold text-white">{value}</p>
                  <p className="text-xs text-gray-500">{label}</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col lg:flex-row justify-center items-center gap-6 mb-12">
          <div className="relative w-full lg:w-80 bg-gray-900 border border-gray-700 rounded-2xl overflow-hidden hover:border-gray-600 transition-all shadow-xl">
            <div className="absolute top-4 left-4 z-20">
              <div className="w-11 h-11 bg-gray-600 rounded-full flex items-center justify-center border-2 border-gray-500">
                <Medal className="w-5 h-5 text-gray-300" />
              </div>
            </div>
            <div className="h-44 relative bg-gray-800/80">
              {!imageErrors[filteredPlayers[1]?.m_nJob] ? (
                <Image
                  src={getJobImage(filteredPlayers[1]?.m_nJob)}
                  alt={getJobName(filteredPlayers[1]?.m_nJob)}
                  fill
                  className="object-cover opacity-80"
                  onError={() => handleImageError(filteredPlayers[1]?.m_nJob)}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Shield className="w-20 h-20 text-gray-500 animate-pulse" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent" />
              <div className="absolute top-3 right-3">
                <span className="bg-gray-800 px-2.5 py-1 rounded-lg text-xs text-gray-300 border border-gray-600">
                  Nv {filteredPlayers[1]?.m_nLevel}
                </span>
              </div>
            </div>
            <div className="p-4">
              <h3 className="text-lg font-bold text-white mb-3">{filteredPlayers[1]?.m_szname}</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Classe</span>
                  <span className="text-white font-medium">{getJobName(filteredPlayers[1]?.m_nJob)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Guilda</span>
                  <span className={filteredPlayers[1]?.m_szGuild === 'None' ? 'text-gray-400' : 'text-amber-400'}>
                    {filteredPlayers[1]?.m_szGuild === 'None' ? '—' : filteredPlayers[1]?.m_szGuild}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Tempo de jogo</span>
                  <span className="text-amber-400 font-medium">{formatPlayTime(filteredPlayers[1]?.TotalPlayTime)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="relative w-full lg:w-96 bg-gray-900 border-2 border-amber-500/50 rounded-2xl overflow-hidden shadow-xl shadow-amber-500/10 lg:-mt-8 z-10">
            <div className="absolute top-4 left-4 z-20">
              <div className="w-14 h-14 bg-amber-500 rounded-full flex items-center justify-center border-2 border-amber-400 shadow-lg">
                <Crown className="w-7 h-7 text-black" />
              </div>
            </div>
            <div className="h-52 relative bg-gray-800/80">
              {!imageErrors[filteredPlayers[0]?.m_nJob] ? (
                <Image
                  src={getJobImage(filteredPlayers[0]?.m_nJob)}
                  alt={getJobName(filteredPlayers[0]?.m_nJob)}
                  fill
                  className="object-cover opacity-90"
                  onError={() => handleImageError(filteredPlayers[0]?.m_nJob)}
                  priority
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Shield className="w-24 h-24 text-amber-500 animate-pulse" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent" />
              <div className="absolute top-3 right-3">
                <span className="bg-amber-500/90 px-3 py-1.5 rounded-lg text-sm text-black font-semibold border border-amber-400">
                  Nv {filteredPlayers[0]?.m_nLevel}
                </span>
              </div>
              <div className="absolute bottom-3 left-3">
                <span className="bg-amber-500/20 px-2.5 py-1 rounded-lg text-xs font-semibold text-amber-300 border border-amber-500/40">
                  CAMPEÃO
                </span>
              </div>
            </div>
            <div className="p-5">
              <h3 className="text-xl font-bold text-white mb-4">{filteredPlayers[0]?.m_szname}</h3>
              <div className="space-y-2.5">
                <div className="flex justify-between py-2 px-3 bg-gray-800/80 rounded-lg border border-gray-700">
                  <span className="text-gray-500 text-sm">Classe</span>
                  <span className="text-amber-400 font-semibold text-sm">{getJobName(filteredPlayers[0]?.m_nJob)}</span>
                </div>
                <div className="flex justify-between py-2 px-3 bg-gray-800/80 rounded-lg border border-gray-700">
                  <span className="text-gray-500 text-sm">Guilda</span>
                  <span className={filteredPlayers[0]?.m_szGuild === 'None' ? 'text-gray-400' : 'text-amber-400'}>
                    {filteredPlayers[0]?.m_szGuild === 'None' ? '—' : filteredPlayers[0]?.m_szGuild}
                  </span>
                </div>
                <div className="flex justify-between py-2 px-3 bg-gray-800/80 rounded-lg border border-gray-700">
                  <span className="text-gray-500 text-sm">Tempo de jogo</span>
                  <span className="text-amber-400 font-semibold text-sm">{formatPlayTime(filteredPlayers[0]?.TotalPlayTime)}</span>
                </div>
              </div>
            </div>
          </div>

          <div className="relative w-full lg:w-80 bg-gray-900 border border-amber-700/50 rounded-2xl overflow-hidden hover:border-amber-600/50 transition-all shadow-xl">
            <div className="absolute top-4 left-4 z-20">
              <div className="w-11 h-11 bg-amber-700 rounded-full flex items-center justify-center border-2 border-amber-600">
                <Medal className="w-5 h-5 text-amber-200" />
              </div>
            </div>
            <div className="h-44 relative bg-gray-800/80">
              {!imageErrors[filteredPlayers[2]?.m_nJob] ? (
                <Image
                  src={getJobImage(filteredPlayers[2]?.m_nJob)}
                  alt={getJobName(filteredPlayers[2]?.m_nJob)}
                  fill
                  className="object-cover opacity-80"
                  onError={() => handleImageError(filteredPlayers[2]?.m_nJob)}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center">
                  <Shield className="w-20 h-20 text-amber-700 animate-pulse" />
                </div>
              )}
              <div className="absolute inset-0 bg-gradient-to-t from-gray-900 via-transparent to-transparent" />
              <div className="absolute top-3 right-3">
                <span className="bg-amber-700/80 px-2.5 py-1 rounded-lg text-xs text-amber-100 border border-amber-600">
                  Nv {filteredPlayers[2]?.m_nLevel}
                </span>
              </div>
            </div>
            <div className="p-4">
              <h3 className="text-lg font-bold text-white mb-3">{filteredPlayers[2]?.m_szname}</h3>
              <div className="space-y-2">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Classe</span>
                  <span className="text-white font-medium">{getJobName(filteredPlayers[2]?.m_nJob)}</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Guilda</span>
                  <span className={filteredPlayers[2]?.m_szGuild === 'None' ? 'text-gray-400' : 'text-amber-400'}>
                    {filteredPlayers[2]?.m_szGuild === 'None' ? '—' : filteredPlayers[2]?.m_szGuild}
                  </span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-500">Tempo de jogo</span>
                  <span className="text-amber-400 font-medium">{formatPlayTime(filteredPlayers[2]?.TotalPlayTime)}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-5 mb-6 shadow-xl">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-5 h-5 text-amber-400" />
            <span className="text-sm font-bold text-amber-400">Tipo de ranking</span>
          </div>
          <div className="flex flex-wrap justify-center gap-3">
            {[
              { id: 'level', label: 'Maior nível', icon: Target, sort: () => [...players].sort((a, b) => b.m_nLevel - a.m_nLevel) },
              { id: 'playtime', label: 'Mais tempo de jogo', icon: Clock, sort: () => [...players].sort((a, b) => (b.TotalPlayTime || 0) - (a.TotalPlayTime || 0)) },
              { id: 'money', label: 'Mais ricos', icon: Gem, sort: () => [...players].sort((a, b) => (b.m_nMoney || 0) - (a.m_nMoney || 0)) },
              { id: 'alphabetical', label: 'Ordem alfabética', icon: Users, sort: () => [...players].sort((a, b) => a.m_szname.localeCompare(b.m_szname)) },
            ].map(({ id, label, icon: Icon, sort }) => (
              <button
                key={id}
                onClick={() => { setRankingType(id); setPlayers(sort()) }}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                  rankingType === id
                    ? 'bg-amber-500 text-black border border-amber-400'
                    : 'bg-gray-800 text-white border border-gray-700 hover:border-amber-500/40'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-5 mb-6 shadow-xl">
          <div className="flex items-center gap-2 mb-4">
            <Filter className="w-5 h-5 text-amber-400" />
            <span className="text-sm font-bold text-amber-400">Filtrar por classe</span>
          </div>
          <div className="flex justify-center mb-4">
            <button
              onClick={() => { setSelectedJob(null); setExpandedTier(null) }}
              className={`px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
                !selectedJob ? 'bg-amber-500 text-black border border-amber-400' : 'bg-gray-800 text-white border border-gray-700 hover:border-amber-500/40'
              }`}
            >
              Todas as classes
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {Object.entries(jobFilters).map(([tier, jobs]) => (
              <div key={tier} className="space-y-2">
                <button
                  onClick={() => setExpandedTier(expandedTier === tier ? null : tier)}
                  className="w-full px-3 py-2.5 bg-gray-800 border border-gray-700 rounded-lg text-sm font-medium text-gray-300 hover:border-amber-500/40 transition-all"
                >
                  {tier} {expandedTier === tier ? '▼' : '▶'}
                </button>
                {expandedTier === tier && (
                  <div className="grid grid-cols-2 gap-2">
                    {jobs.map(job => (
                      <button
                        key={job.id}
                        onClick={() => setSelectedJob(job.id)}
                        className={`px-3 py-2 rounded-lg text-sm font-medium text-left transition-all ${
                          selectedJob === job.id
                            ? 'bg-amber-500 text-black border border-amber-400'
                            : 'bg-gray-800/80 text-white border border-gray-700 hover:border-amber-500/40'
                        }`}
                      >
                        {job.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        <div className="bg-gray-900 border border-amber-500/30 rounded-2xl overflow-hidden shadow-xl">
          <div className="px-5 py-4 border-b border-gray-700">
            <h2 className="text-lg font-bold text-white flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-amber-400" />
              Ranking dos jogadores
            </h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-gray-800/80">
                <tr>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">#</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Jogador</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Nível</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Classe</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Guilda</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Tempo de jogo</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800">
                {paginatedPlayers.map((player, index) => (
                  <tr key={player.m_szname} className="hover:bg-gray-800/50 transition-colors">
                    <td className="px-4 py-3">
                      {index < 3 ? (
                        <div className={`w-7 h-7 rounded-full flex items-center justify-center ${
                          index === 0 ? 'bg-amber-500' : index === 1 ? 'bg-gray-500' : 'bg-amber-700'
                        }`}>
                          <Medal className="w-3.5 h-3.5 text-white" />
                        </div>
                      ) : (
                        <span className="text-gray-500 font-medium">{startIndex + index + 1}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-white font-medium">{player.m_szname}</span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="bg-gray-800 px-2.5 py-1 rounded-lg text-sm text-amber-400 font-medium border border-gray-700">
                        {player.m_nLevel}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className="bg-gray-800 px-2 py-1 rounded-lg text-white text-sm font-medium border border-gray-700">
                        {getJobName(player.m_nJob)}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {player.m_szGuild === 'None' ? (
                        <span className="text-gray-500">—</span>
                      ) : (
                        <span className="text-amber-400 font-medium">{player.m_szGuild}</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-amber-400/90 font-medium text-sm">
                        {formatPlayTime(player.TotalPlayTime) ?? '—'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="px-4 py-3 bg-gray-800/50 border-t border-gray-700 flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm text-gray-500">
              {startIndex + 1}–{Math.min(startIndex + PLAYERS_PER_PAGE, filteredPlayers.length)} de {filteredPlayers.length}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                disabled={currentPage === 1}
                className="p-2 rounded-lg bg-gray-800 text-white border border-gray-700 hover:border-amber-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft size={16} />
              </button>
              {getPageNumbers().map(pageNum => (
                <button
                  key={pageNum}
                  onClick={() => setCurrentPage(pageNum)}
                  className={`min-w-[2.25rem] py-2 px-2.5 rounded-lg text-sm font-medium transition-colors ${
                    pageNum === currentPage
                      ? 'bg-amber-500 text-black border border-amber-400'
                      : 'bg-gray-800 text-white border border-gray-700 hover:border-amber-500/40'
                  }`}
                >
                  {pageNum}
                </button>
              ))}
              <button
                onClick={() => setCurrentPage(prev => Math.min(totalPages, prev + 1))}
                disabled={currentPage === totalPages}
                className="p-2 rounded-lg bg-gray-800 text-white border border-gray-700 hover:border-amber-500/40 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}