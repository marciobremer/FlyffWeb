'use client'

import { useEffect, useState } from 'react'
import {
  User,
  Shield,
  UserPlus,
  Lock,
  LockKeyhole,
  Loader2
} from 'lucide-react'
import { toast } from 'react-toastify'

export default function AccountTiles() {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState({ type: '', text: '' })

  useEffect(() => {
    const getEmailFromSession = async () => {
      try {
        const res = await fetch('/api/me', { credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          setEmail(data.email)
        } else {
          setMessage({ type: 'error', text: 'Não foi possível obter o e-mail da sessão.' })
        }
      } catch (err) {
        console.error('Falha ao obter a sessão:', err)
        setMessage({ type: 'error', text: 'Não foi possível obter a sessão do usuário.' })
      }
    }

    getEmailFromSession()
  }, [])

  const handleCreateAccount = async () => {
    setMessage({ type: '', text: '' })

    if (!username || !password || !confirmPassword) {
      toast.error('Preencha todos os campos.')
      return
    }

    if (!email || !email.includes('@')) {
      toast.error('O e-mail da sessão não está disponível.')
      return
    }

    if (password !== confirmPassword) {
      toast.error('As senhas não conferem.')
      return
    }

    if (password.length < 8) {
      toast.error('A senha deve ter pelo menos 8 caracteres.')
      return
    }

    setLoading(true)

    try {
      const response = await fetch('/api/create-account', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          repeatpass: confirmPassword,
          emailadd: email
        })
      })

      const data = await response.json()

      if (data.success) {
        toast.success(data.success)
        setUsername('')
        setPassword('')
        setConfirmPassword('')
      } else {
        toast.error(data.error)
      }
    } catch (err) {
      toast.error('Erro no servidor. Tente novamente mais tarde.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="w-full bg-[#0c0f1c] border border-white/10 rounded-xl p-6">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 flex items-center justify-center bg-white/10 rounded-md">
          <UserPlus size={20} className="text-green-400" />
        </div>
        <p className="text-white font-semibold text-base">Criar conta</p>
      </div>

      <div className="bg-[#111827] p-5 rounded-lg border border-white/10">
        <p className="text-sm text-gray-400 mb-4 flex items-start gap-2">
          <Shield size={16} /> Crie uma conta de jogo vinculada. Vamos usar o e-mail salvo na sua sessão.
        </p>

        <div className="space-y-4">
          <div>
            <label className="block text-sm text-gray-300 mb-1">Nome da conta</label>
            <div className="relative">
              <input
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="Digite um nome de conta"
                className="w-full pl-10 pr-3 py-2 bg-[#1f2937] text-white rounded-md border border-gray-600 placeholder-gray-400 focus:outline-none"
              />
              <User className="absolute top-2.5 left-3 text-gray-400" size={16} />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">Senha</label>
            <div className="relative">
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Digite uma senha"
                className="w-full pl-10 pr-3 py-2 bg-[#1f2937] text-white rounded-md border border-gray-600 placeholder-gray-400 focus:outline-none"
              />
              <Lock className="absolute top-2.5 left-3 text-gray-400" size={16} />
            </div>
          </div>

          <div>
            <label className="block text-sm text-gray-300 mb-1">Confirmar a senha</label>
            <div className="relative">
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Confirme a senha"
                className="w-full pl-10 pr-3 py-2 bg-[#1f2937] text-white rounded-md border border-gray-600 placeholder-gray-400 focus:outline-none"
              />
              <LockKeyhole className="absolute top-2.5 left-3 text-gray-400" size={16} />
            </div>
          </div>

          <button
            onClick={handleCreateAccount}
            disabled={loading}
            className={`w-full mt-2 bg-green-500 hover:bg-green-600 text-white font-semibold py-2 rounded-lg flex items-center justify-center gap-2 transition ${
              loading ? 'opacity-50 cursor-not-allowed' : ''
            }`}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Criando...
              </>
            ) : (
              <>
                <UserPlus size={16} />
                Criar nova conta
              </>
            )}
          </button>

          {message.text && (
            <p
              className={`text-sm mt-3 text-center ${
                message.type === 'success' ? 'text-green-400' : 'text-red-400'
              }`}
            >
              {message.text}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}