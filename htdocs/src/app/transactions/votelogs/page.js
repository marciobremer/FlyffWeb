"use client"

import { useEffect, useState } from 'react'
import { CreditCard, Search } from 'lucide-react'
import dayjs from 'dayjs'
import DataTable from 'react-data-table-component'

export default function GCashDonationsPage() {
  const [donations, setDonations] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterText, setFilterText] = useState('')

  useEffect(() => {
    const fetchDonations = async () => {
      try {
        const res = await fetch('/api/donations/gcash', { credentials: 'include' })
        const data = await res.json()
        if (res.ok) {
          setDonations(data.donations || [])
        }
      } catch (err) {
        console.error('Não foi possível carregar as doações:', err)
      } finally {
        setLoading(false)
      }
    }

    fetchDonations()
  }, [])

  const filtered = donations.filter(item =>
    item.username?.toLowerCase().includes(filterText.toLowerCase()) ||
    item.reference?.toLowerCase().includes(filterText.toLowerCase())
  )

  const columns = [
    {
      name: 'Usuário',
      selector: row => row.username,
      sortable: true,
      cell: row => <span className="text-white">{row.username}</span>,
    },
    {
      name: 'Valor',
      selector: row => row.amount,
      sortable: true,
      cell: row => <span className="text-green-400">₱ {row.amount.toFixed(2)}</span>,
    },
    {
      name: 'Referência',
      selector: row => row.reference,
      sortable: true,
      cell: row => <span className="text-blue-300">{row.reference}</span>,
    },
    {
      name: 'Status',
      selector: row => row.status,
      cell: row => (
        <span
          className={`text-sm font-semibold px-2 py-1 rounded-full ${
            row.status === 'Completed'
              ? 'bg-green-600 text-white'
              : row.status === 'Pending'
              ? 'bg-yellow-500 text-black'
              : 'bg-red-500 text-white'
          }`}
        >
          {row.status === 'Completed'
            ? 'Concluído'
            : row.status === 'Pending'
            ? 'Pendente'
            : row.status}
        </span>
      ),
    },
    {
      name: 'Data',
      selector: row => row.date,
      sortable: true,
      cell: row => <span className="text-gray-300">{dayjs(row.date).format('DD/MM/YYYY HH:mm')}</span>,
    },
  ]

  return (
    <section
    className="min-h-screen bg-cover bg-center bg-no-repeat px-4 py-16 text-white"
    style={{ backgroundImage: `url('/bg.png')` }}
  >
    <div className="w-full p-6 bg-[#0c0f1c] text-white">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 flex items-center justify-center bg-white/10 rounded-md">
          <CreditCard size={20} className="text-yellow-400" />
        </div>
        <h2 className="text-lg font-bold">Doações GCash</h2>
        <span className="text-xs bg-white/10 text-yellow-400 px-2 py-1 rounded-full">
          {donations.length} no total
        </span>
      </div>

      <div className="mb-4 relative w-full md:w-72">
        <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
        <input
          type="text"
          placeholder="Buscar usuário ou referência..."
          className="w-full pl-10 pr-3 py-2 rounded bg-[#1f2937] text-white border border-gray-600 placeholder-gray-400 focus:outline-none"
          value={filterText}
          onChange={e => setFilterText(e.target.value)}
        />
      </div>

      <DataTable
        columns={columns}
        paginationComponentOptions={{ rowsPerPageText: 'Linhas por página:', rangeSeparatorText: 'de' }}
        noDataComponent={<div className="p-6 text-gray-400">Nenhum registro para mostrar.</div>}
        data={filtered}
        progressPending={loading}
        pagination
        dense
        responsive
        highlightOnHover
        theme="dark"
        customStyles={{
          rows: { style: { backgroundColor: '#111827', borderBottomColor: '#1e253b' } },
          headCells: { style: { backgroundColor: '#1c1f2a', color: 'white', fontWeight: 'bold' } },
        }}
      />
    </div>
    </section>
  )
}