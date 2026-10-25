'use client'

import { useEffect, useState } from 'react'
import { Users, Eye, KeyRound, Search, Mail } from 'lucide-react'
import dayjs from 'dayjs'
import { toast } from 'react-toastify'
import DataTable from 'react-data-table-component'
import { getJobName } from '@/utils/jobUtils'
import { formatPlayTime } from '@/utils/formatPlayTime'

export default function AccountLists() {
  const [accounts, setAccounts] = useState([])
  const [loading, setLoading] = useState(true)
  const [activeAccount, setActiveAccount] = useState(null)
  const [modalType, setModalType] = useState('')
  const [characterList, setCharacterList] = useState([])
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [newEmail, setNewEmail] = useState('')

  useEffect(() => {
    const fetchAccounts = async () => {
      try {
        const res = await fetch('/api/accounts', { credentials: 'include' })
        const data = await res.json()
        if (res.ok) setAccounts(data.accounts || [])
      } catch (err) {
        console.error('Não foi possível carregar as contas:', err)
      } finally {
        setLoading(false)
      }
    }
    fetchAccounts()
  }, [])

  useEffect(() => {
    if (modalType === 'view' && activeAccount) {
      fetch(`/api/characters?account=${activeAccount.name}`)
        .then(res => res.json())
        .then(data => setCharacterList(data.characters || []))
        .catch(() => setCharacterList([]))
    }
  }, [modalType, activeAccount])

  const openModal = (type, account) => {
    setModalType(type)
    setActiveAccount(account)
    setNewPassword('')
    setConfirmPassword('')
    setNewEmail(account?.email || '')
  }

  const closeModal = () => {
    setModalType('')
    setActiveAccount(null)
    setCharacterList([])
  }

  const handlePasswordChange = async (e) => {
    e.preventDefault()

    if (newPassword.length < 8) {
      toast.error('A senha deve ter pelo menos 8 caracteres.')
      return
    }

    if (newPassword !== confirmPassword) {
      toast.error('As senhas não conferem.')
      return
    }

    try {
      const res = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          account: activeAccount.name,
          password: newPassword
        })
      })

      const data = await res.json()
      if (res.ok) {
        toast.success(data.success || 'Senha atualizada!')
        closeModal()
      } else {
        toast.error(data.error || 'Não foi possível atualizar a senha.')
      }
    } catch (err) {
      toast.error('Erro no servidor. Tente novamente mais tarde.')
    }
  }

  const columns = [
    {
      name: 'Nome da conta',
      selector: row => row.name,
      sortable: true,
      cell: row => <span className="text-white">{row.name}</span>,
    },
    {
      name: 'Cash Points',
      selector: row => row.cash,
      sortable: true,
      cell: row => <span className="text-white">{row.cash}</span>,
    },
    {
      name: 'VPoints',
      selector: row => row.votepoint,
      sortable: true,
      cell: row => <span className="text-white">{row.votepoint}</span>,
    },
    {
      name: 'Data de cadastro',
      selector: row => row.regdate,
      sortable: true,
      cell: row => (
        <span className="text-gray-400">
          {row.regdate ? dayjs(row.regdate).format('DD/MM/YYYY HH:mm') : '—'}
        </span>
      ),
    },
    {
      name: 'Ações',
      cell: row => (
        <div className="flex items-center space-x-1.5">
          <button
            onClick={() => openModal('view', row)}
            className="inline-flex items-center justify-center bg-blue-600/20 hover:bg-blue-600/30 text-blue-500 hover:text-blue-400 px-2.5 py-1 text-xs font-medium rounded-md ring-1 ring-blue-600/25"
            title="Ver personagens"
          >
            <Eye size={13} strokeWidth={2.5} />
          </button>
        </div>
      )
    }
  ]

  const [filterText, setFilterText] = useState('')
  const filteredAccounts = accounts.filter(item =>
    item.name?.toLowerCase().includes(filterText.toLowerCase())
  )

  return (
    <div className="w-full bg-[#0c0f1c] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 flex items-center justify-center bg-white/5 rounded-md">
          <Users size={20} className="text-blue-300" />
        </div>
        <p className="text-white font-semibold text-lg flex items-center gap-2">
          Contas de jogo
          <span className="text-xs font-medium px-2 py-0.5 bg-white/10 rounded-full text-blue-300">
            {accounts.length} conta{accounts.length !== 1 ? 's' : ''}
          </span>
        </p>
      </div>

      <div className="mb-4 relative w-full md:w-64">
        <Search className="absolute left-3 top-2.5 text-gray-400" size={18} />
        <input
          type="text"
          placeholder="Buscar pelo nome da conta..."
          className="w-full pl-10 pr-3 py-2 rounded bg-[#1f2937] text-white border border-gray-600 placeholder-gray-400 focus:outline-none"
          value={filterText}
          onChange={(e) => setFilterText(e.target.value)}
        />
      </div>

      <DataTable
        columns={columns}
        paginationComponentOptions={{ rowsPerPageText: 'Linhas por página:', rangeSeparatorText: 'de' }}
        noDataComponent={<div className="p-6 text-gray-400">Nenhum registro para mostrar.</div>}
        data={filteredAccounts}
        progressPending={loading}
        pagination
        dense
        responsive
        highlightOnHover
        theme="dark"
        customStyles={{
          rows: {
            style: { backgroundColor: '#111827', borderBottomColor: '#1e253b' },
          },
          headCells: {
            style: { backgroundColor: '#1c1f2a', color: 'white', fontWeight: 'bold' },
          },
        }}
      />

      {modalType === 'view' && activeAccount && (
        <div
          className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4"
          onClick={closeModal}
        >
          <div
            className="bg-[#1f2937] text-white p-6 rounded-xl shadow-xl w-full max-w-3xl relative"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="absolute top-2 right-3 text-gray-400 hover:text-red-400"
              onClick={closeModal}
            >
              ✕
            </button>
            <h2 className="text-xl font-semibold mb-4">
              👥 Personagens de <span className="text-blue-400">{activeAccount.name}</span>
            </h2>

            {characterList.length === 0 ? (
              <div className="text-center text-gray-400 py-8">Nenhum personagem encontrado.</div>
            ) : (
              <div className="max-h-80 overflow-y-auto rounded border border-white/10">
                <table className="w-full text-sm table-auto">
                  <thead className="bg-[#273044] sticky top-0 z-10">
                    <tr>
                      <th className="py-2 px-4 text-left font-semibold text-white">Nome do personagem</th>
                      <th className="py-2 px-4 text-left text-gray-300">Nível</th>
                      <th className="py-2 px-4 text-left text-gray-300">Classe</th>
                      <th className="py-2 px-4 text-left text-gray-300">Tempo de jogo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {characterList.map((char) => (
                      <tr key={char.m_idPlayer} className="border-t border-white/5 hover:bg-[#2a3347]">
                        <td className="px-4 py-2 text-white">{char.m_szName}</td>
                        <td className="px-4 py-2 text-blue-300">{char.m_nLevel}</td>
                        <td className="px-4 py-2 text-purple-300">{getJobName(char.m_nJob)}</td>
                        <td className="px-4 py-2 text-gray-400">{formatPlayTime(char.TotalPlayTime) ?? '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {modalType === 'email' && activeAccount && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center px-4">
          <div className="bg-[#1f2937] text-white p-6 rounded-xl shadow-xl w-full max-w-md relative">
            <button className="absolute top-2 right-3 text-gray-400 hover:text-red-400" onClick={closeModal}>
              ✕
            </button>
            <h2 className="text-lg font-semibold mb-4">Changer l email - {activeAccount.name}</h2>
            <form
              onSubmit={async (e) => {
                e.preventDefault()
                const res = await fetch('/api/users/change-email', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    account: activeAccount.name,
                    new_email: newEmail,
                  }),
                })

                const data = await res.json()
                if (res.ok) {
                  toast.success(data.success || 'E-mail atualizado!')
                  closeModal()
                } else {
                  toast.error(data.error || 'Não foi possível atualizar o e-mail.')
                }
              }}
              className="space-y-4"
            >
              <input
                type="email"
                placeholder="Novo e-mail"
                className="w-full p-2 rounded bg-[#111827] border border-white/10"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                required
              />
              <button
                type="submit"
                className="w-full bg-blue-600 hover:bg-blue-700 py-2 rounded text-white font-semibold"
              >
                Confirmar alteração
              </button>
            </form>
          </div>
        </div>
      )}

      {modalType === 'change' && activeAccount && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center">
          <div className="bg-[#1f2937] text-white p-6 rounded-xl shadow-xl w-full max-w-md relative">
            <button className="absolute top-2 right-3 text-gray-400" onClick={closeModal}>✕</button>
            <h2 className="text-lg font-semibold mb-4">Alterar a senha - {activeAccount.name}</h2>
            <form onSubmit={handlePasswordChange} className="space-y-4">
              <input
                type="password"
                placeholder="Nova senha"
                className="w-full p-2 rounded bg-[#111827] border border-white/10"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
              <input
                type="password"
                placeholder="Confirmar a senha"
                className="w-full p-2 rounded bg-[#111827] border border-white/10"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
              />
              <button
                type="submit"
                className="w-full bg-green-600 hover:bg-green-700 py-2 rounded text-white font-semibold"
              >
                Confirmar alteração
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}