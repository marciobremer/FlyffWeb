"use client"

import { useEffect, useState } from 'react'
import { ShoppingCart, Search, DollarSign, Star } from 'lucide-react'
import dayjs from 'dayjs'
import DataTable from 'react-data-table-component'

export default function TopUpTransactionsPage() {
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterText, setFilterText] = useState('')

  useEffect(() => {
    const fetchTransactions = async () => {
      try {
        const res = await fetch('/api/topup/transactions', { credentials: 'include' })
        const data = await res.json()
        if (res.ok) {
          setTransactions(data.transactions || [])
        }
      } catch (err) {
        console.error('Failed to fetch transactions:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchTransactions()
  }, [])

  const filtered = transactions.filter(item =>
    item.username?.toLowerCase().includes(filterText.toLowerCase()) ||
    item.transactionId?.toLowerCase().includes(filterText.toLowerCase()) ||
    item.itemName?.toLowerCase().includes(filterText.toLowerCase())
  )

  const columns = [
    {
      name: 'Username',
      selector: row => row.username,
      sortable: true,
      cell: row => <span className="text-white">{row.username}</span>,
    },
    {
      name: 'Item',
      selector: row => row.itemName,
      sortable: true,
      cell: row => (
        <div className="flex flex-col">
          <span className="text-yellow-400 font-medium">{row.itemName}</span>
          <span className="text-xs text-gray-400">{row.points.toLocaleString()} points</span>
        </div>
      ),
    },
    {
      name: 'Amount',
      selector: row => row.amount,
      sortable: true,
      cell: row => (
        <div className="flex items-center gap-1">
          <DollarSign size={14} className="text-green-400" />
          <span className="text-green-400">{row.amount.toFixed(2)}</span>
        </div>
      ),
    },
    {
      name: 'Transaction ID',
      selector: row => row.transactionId,
      sortable: true,
      cell: row => <span className="text-blue-300 text-sm">{row.transactionId}</span>,
    },
    {
      name: 'Status',
      selector: row => row.status,
      sortable: true,
      cell: row => (
        <span
          className={`text-sm font-semibold px-2.5 py-1 rounded-full ${
            row.status === 'completed'
              ? 'bg-green-600/20 text-green-400 border border-green-500/20'
              : row.status === 'pending'
              ? 'bg-yellow-600/20 text-yellow-400 border border-yellow-500/20'
              : row.status === 'failed'
              ? 'bg-red-600/20 text-red-400 border border-red-500/20'
              : 'bg-gray-600/20 text-gray-400 border border-gray-500/20'
          }`}
        >
          {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
        </span>
      ),
    },
    {
      name: 'Date',
      selector: row => row.createdAt,
      sortable: true,
      cell: row => <span className="text-gray-300">{dayjs(row.createdAt).format('MMM D, YYYY h:mm A')}</span>,
    },
  ]

  return (
    <div className="w-full p-6 bg-[#0c0f1c] text-white min-h-screen">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 flex items-center justify-center bg-gradient-to-br from-yellow-400/20 to-yellow-400/5 rounded-lg">
              <ShoppingCart size={20} className="text-yellow-400" />
            </div>
            <div className="flex items-center gap-3">
              <h2 className="text-lg font-bold">Top-Up Transactions</h2>
              <span className="text-xs bg-yellow-400/10 text-yellow-400 px-2 py-1 rounded-full font-medium">
                {transactions.length} total
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="relative w-full md:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" size={18} />
              <input
                type="text"
                placeholder="Search by username, ID, or item..."
                className="w-full pl-10 pr-4 py-2 rounded-lg bg-[#1a1a1a] text-white border border-white/10 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-yellow-400/50 transition-all"
                value={filterText}
                onChange={e => setFilterText(e.target.value)}
              />
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-[#1a1a1a] rounded-lg p-4 border border-white/5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Total Revenue</p>
                <p className="text-2xl font-bold text-white mt-1">
                  ${transactions.reduce((sum, t) => sum + (t.amount || 0), 0).toFixed(2)}
                </p>
              </div>
              <div className="w-10 h-10 flex items-center justify-center bg-green-400/10 rounded-lg">
                <DollarSign size={20} className="text-green-400" />
              </div>
            </div>
          </div>
          
          <div className="bg-[#1a1a1a] rounded-lg p-4 border border-white/5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Total Points Distributed</p>
                <p className="text-2xl font-bold text-white mt-1">
                  {transactions.reduce((sum, t) => sum + (t.points || 0), 0).toLocaleString()}
                </p>
              </div>
              <div className="w-10 h-10 flex items-center justify-center bg-blue-400/10 rounded-lg">
                <Star size={20} className="text-blue-400" />
              </div>
            </div>
          </div>
          
          <div className="bg-[#1a1a1a] rounded-lg p-4 border border-white/5">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-gray-400 text-sm">Success Rate</p>
                <p className="text-2xl font-bold text-white mt-1">
                  {Math.round((transactions.filter(t => t.status === 'completed').length / transactions.length) * 100) || 0}%
                </p>
              </div>
              <div className="w-10 h-10 flex items-center justify-center bg-yellow-400/10 rounded-lg">
                <ShoppingCart size={20} className="text-yellow-400" />
              </div>
            </div>
          </div>
        </div>

        {/* Data Table */}
        <div className="bg-[#1a1a1a] rounded-lg border border-white/5 overflow-hidden">
          <DataTable
            columns={columns}
            data={filtered}
            progressPending={loading}
            pagination
            dense
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
              pagination: {
                style: {
                  backgroundColor: '#1a1a1a',
                  color: 'white',
                  borderTopColor: 'rgba(255, 255, 255, 0.05)',
                },
                pageButtonsStyle: {
                  color: 'white',
                  fill: 'white',
                },
              },
            }}
          />
        </div>
      </div>
    </div>
  )
} 