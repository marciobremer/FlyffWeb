'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Eye, EyeOff } from 'lucide-react'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [pin, setPin] = useState('')
  const [showPin, setShowPin] = useState(false)
  const [status, setStatus] = useState({ loading: false, message: '', isError: false })

  const handleSubmit = async (e) => {
    e.preventDefault()
    setStatus({ loading: true, message: '', isError: false })

    try {
      const response = await fetch('/api/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, pin })
      })

      const data = await response.json()

      if (response.ok && data.success) {
        setStatus({
          loading: false,
          message: data.message,
          isError: false
        })
        
        setEmail('')
        setPin('')
        
        setTimeout(() => {
          router.push('/login')
        }, 3000)
      } else {
        setStatus({
          loading: false,
          message: data.error || 'Não foi possível processar o pedido',
          isError: true
        })
      }
    } catch (error) {
      setStatus({
        loading: false,
        message: 'Ocorreu um erro. Tente novamente.',
        isError: true
      })
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-cover bg-center"
         style={{ backgroundImage: `url('/bg.png')` }}>
      <div className="w-full max-w-md bg-black/80 backdrop-blur-sm p-6 rounded-lg">
        <h1 className="text-2xl text-yellow-400 font-bold text-center mb-6">
          Redefinir a senha
        </h1>

        <form onSubmit={handleSubmit} className="space-y-6">
          <div>
            <label htmlFor="email" className="block text-sm font-medium text-gray-300 mb-2">
              Endereço de e-mail
            </label>
            <input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Digite seu e-mail"
              required
              className="w-full px-4 py-2.5 bg-black/50 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500"
            />
          </div>

          <div>
            <label htmlFor="pin" className="block text-sm font-medium text-gray-300 mb-2">
              PIN de segurança
            </label>
            <div className="relative">
              <input
                id="pin"
                type={showPin ? "text" : "password"}
                value={pin}
                onChange={(e) => setPin(e.target.value)}
                placeholder="Digite seu PIN de 4 a 6 dígitos"
                required
                pattern="\d{4,6}"
                title="O PIN deve ter entre 4 e 6 dígitos"
                className="w-full px-4 py-2.5 bg-black/50 border border-gray-700 rounded text-white placeholder-gray-500 focus:border-yellow-500 focus:ring-1 focus:ring-yellow-500"
              />
              <button
                type="button"
                onClick={() => setShowPin(!showPin)}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-gray-400 hover:text-yellow-400"
              >
                {showPin ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
            <p className="mt-1 text-sm text-gray-400">
              Digite o PIN criado no cadastro
            </p>
          </div>

          {status.message && (
            <div className={`p-4 rounded ${status.isError ? 'bg-red-900/50 text-red-400' : 'bg-green-900/50 text-green-400'}`}>
              {status.message}
            </div>
          )}

          <button
            type="submit"
            disabled={status.loading || !email || !pin}
            className="w-full bg-yellow-500 hover:bg-yellow-400 text-black font-semibold py-2.5 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {status.loading ? (
              <div className="flex items-center justify-center">
                <div className="animate-spin h-5 w-5 border-2 border-black border-t-transparent rounded-full mr-2"></div>
                Processando...
              </div>
            ) : (
              'Redefinir a senha'
            )}
          </button>

          <div className="text-center mt-4">
            <button
              type="button"
              onClick={() => router.push('/login')}
              className="text-gray-400 hover:text-yellow-400 text-sm"
            >
              Voltar para o login
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}