"use client"

import { useEffect, useState } from 'react'
import { Search, ArrowLeftRight, Clock, User } from 'lucide-react'
import dayjs from 'dayjs'
import DataTable from 'react-data-table-component'

const TableSkeleton = () => (
  <div className="animate-pulse">
    <div className="h-12 bg-gray-700/50 rounded-t-lg mb-4" />
    {[...Array(5)].map((_, i) => (
      <div key={i} className="flex gap-4 mb-4">
        <div className="h-8 bg-gray-700/50 rounded w-28" />
        <div className="h-8 bg-gray-700/50 rounded w-36" />
        <div className="h-8 bg-gray-700/50 rounded w-32" />
        <div className="h-8 bg-gray-700/50 rounded w-32" />
        <div className="h-8 bg-gray-700/50 rounded flex-1" />
      </div>
    ))}
  </div>
)

export default function TradeLogsPage() {
  const [trades, setTrades] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterText, setFilterText] = useState('')

  useEffect(() => {
    const fetchTrades = async () => {
      try {
        const res = await fetch('/api/logs/trade', { credentials: 'include' })
        const data = await res.json()
        if (res.ok) {
          setTrades(data.trades || [])
        }
      } catch (err) {
        console.error('Não foi possível carregar os logs de troca:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchTrades()
  }, [])

  const filtered = trades.filter(item =>
    item.Player1?.toLowerCase().includes(filterText.toLowerCase()) ||
    item.Player2?.toLowerCase().includes(filterText.toLowerCase()) ||
    item.ItemsFromPlayer1?.toLowerCase().includes(filterText.toLowerCase()) ||
    item.ItemsFromPlayer2?.toLowerCase().includes(filterText.toLowerCase())
  )

  const columns = [
    {
      name: 'ID da troca',
      selector: row => row.TradeID,
      sortable: true,
      cell: row => <span className="text-yellow-400 font-medium">#{row.TradeID}</span>,
    },
    {
      name: 'Data',
      selector: row => row.TradeDt,
      sortable: true,
      cell: row => <span className="text-gray-300">{dayjs(row.TradeDt).format('DD/MM/YYYY HH:mm:ss')}</span>,
    },
    {
      name: 'Jogador 1',
      selector: row => row.Player1,
      sortable: true,
      cell: row => (
        <div className="flex items-center gap-2">
          <User size={14} className="text-blue-400" />
          <span className="text-white">{row.Player1}</span>
        </div>
      ),
    },
    {
      name: 'Jogador 2',
      selector: row => row.Player2,
      sortable: true,
      cell: row => (
        <div className="flex items-center gap-2">
          <User size={14} className="text-green-400" />
          <span className="text-white">{row.Player2}</span>
        </div>
      ),
    },
    {
      name: 'Itens trocados',
      grow: 2,
      cell: row => (
        <div className="flex items-center gap-4 py-2">
          <div className="flex-1">
            <p className="text-xs text-blue-400 mb-1">De {row.Player1} :</p>
            <p className="text-sm text-white whitespace-pre-line">{row.ItemsFromPlayer1 || 'Nenhum item'}</p>
          </div>
          <ArrowLeftRight size={16} className="text-gray-500" />
          <div className="flex-1">
            <p className="text-xs text-green-400 mb-1">De {row.Player2} :</p>
            <p className="text-sm text-white whitespace-pre-line">{row.ItemsFromPlayer2 || 'Nenhum item'}</p>
          </div>
        </div>
      ),
    },
  ]

  return (
    <section className="min-h-screen bg-cover bg-center bg-no-repeat px-4 py-16 text-white"
      style={{ backgroundImage: `url('/bg.png')` }}>
      <div className="w-full p-6 bg-[#0c0f1c] text-white">
        <div className="flex items-center gap-3 mb-6">
          <div className="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-purple-500/20 to-purple-500/5 rounded-lg">
            <ArrowLeftRight size={20} className="text-purple-400" />
          </div>
          <h2 className="text-lg font-bold">Logs de troca</h2>
          {!loading && (
            <span className="text-xs bg-purple-500/10 text-purple-400 px-2 py-1 rounded-full font-medium">
              {trades.length} no total
            </span>
          )}
        </div>

        <div className="mb-6 relative w-full md:w-96">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
          <input
            type="text"
            placeholder="Buscar por jogador ou itens..."
            className="w-full pl-10 pr-4 py-2 rounded-lg bg-[#1a1a1a] text-white border border-white/10 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-purple-400/50 transition-all"
            value={filterText}
            onChange={e => setFilterText(e.target.value)}
          />
        </div>

        {loading ? (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="animate-pulse bg-white/10 rounded-lg p-4">
                <div className="h-5 bg-gray-700/50 rounded w-24 mb-2" />
                <div className="h-8 bg-gray-700/50 rounded w-32" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Total de trocas</p>
              <p className="text-2xl font-bold text-white">{trades.length}</p>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Trocas de hoje</p>
              <p className="text-2xl font-bold text-white">
                {trades.filter(t => dayjs(t.TradeDt).isAfter(dayjs().startOf('day'))).length}
              </p>
            </div>
            <div className="bg-white/10 rounded-lg p-4">
              <p className="text-gray-400 text-sm">Jogadores ativos</p>
              <p className="text-2xl font-bold text-white">
                {new Set([...trades.map(t => t.Player1), ...trades.map(t => t.Player2)]).size}
              </p>
            </div>
          </div>
        )}

        {loading ? (
          <div className="bg-[#1a1a1a] rounded-lg p-4">
            <TableSkeleton />
          </div>
        ) : (
          <div className="bg-[#1a1a1a] rounded-lg border border-white/5 overflow-hidden">
            <DataTable
              columns={columns}
              paginationComponentOptions={{ rowsPerPageText: 'Linhas por página:', rangeSeparatorText: 'de' }}
              noDataComponent={<div className="p-6 text-gray-400">Nenhum registro para mostrar.</div>}
              data={filtered}
              pagination
              responsive
              highlightOnHover
              theme="dark"
              customStyles={{
                table: {
                  style: {
                    backgroundColor: '#1a1a1a',
                  }
                },
                rows: {
                  style: {
                    backgroundColor: '#1a1a1a',
                    '&:hover': {
                      backgroundColor: '#252525',
                    },
                    borderBottomColor: 'rgba(255, 255, 255, 0.05)',
                  },
                },
                headRow: {
                  style: {
                    backgroundColor: '#1a1a1a',
                    borderBottomColor: 'rgba(255, 255, 255, 0.1)',
                  },
                },
                headCells: {
                  style: {
                    color: '#9ca3af',
                    fontSize: '0.875rem',
                    fontWeight: '600',
                    paddingTop: '16px',
                    paddingBottom: '16px',
                  },
                },
                cells: {
                  style: {
                    paddingTop: '12px',
                    paddingBottom: '12px',
                  },
                },
              }}
            />
          </div>
        )}
      </div>
    </section>
  )
}