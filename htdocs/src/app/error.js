'use client'

import { useEffect } from 'react'
import Link from 'next/link'

export default function Error({
  error,
  reset,
}) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <section
      className="min-h-screen bg-cover bg-center bg-no-repeat flex items-center justify-center px-4"
      style={{ backgroundImage: `url('/bg.png')` }}
    >
      <div className="max-w-xl mx-auto text-center">
        <div className="bg-[#0f1c2e]/95 border-2 border-yellow-500/30 backdrop-blur-md p-8 rounded-2xl shadow-[0_0_15px_rgba(234,179,8,0.2)]">
          <h1 className="text-4xl font-bold text-yellow-400 mb-4">Ocorreu um erro!</h1>
          
          <p className="text-gray-300 mb-8">
            Não se preocupe! Nossos melhores magos já estão trabalhando nisso.
          </p>

          <div className="space-x-4">
            <button
              onClick={reset}
              className="inline-flex items-center gap-2 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-black font-semibold px-6 py-3 rounded-xl transition-all shadow-lg"
            >
              Tentar de novo
            </button>

            <Link
              href="/"
              className="inline-flex items-center gap-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold px-6 py-3 rounded-xl transition-all shadow-lg"
            >
              Voltar para o início
            </Link>
          </div>
        </div>
      </div>
    </section>
  )
}