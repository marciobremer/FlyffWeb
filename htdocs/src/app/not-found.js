'use client'

import Link from 'next/link'

export default function NotFound() {
  return (
    <section
      className="min-h-screen bg-cover bg-center bg-no-repeat flex items-center justify-center px-4"
      style={{ backgroundImage: `url('/bg.png')` }}
    >
      <div className="max-w-xl mx-auto text-center">
        <div className="bg-[#0f1c2e]/95 border-2 border-yellow-500/30 backdrop-blur-md p-8 rounded-2xl shadow-[0_0_15px_rgba(234,179,8,0.2)]">
          <h1 className="text-6xl font-bold text-yellow-400 mb-4">404</h1>
          <h2 className="text-2xl font-semibold text-white mb-6">Página não encontrada</h2>
          
          <p className="text-gray-300 mb-8">
            Opa! A página que você procura parece ter se perdido em outra dimensão.
          </p>

          <Link
            href="/"
            className="inline-flex items-center gap-2 bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-black font-semibold px-6 py-3 rounded-xl transition-all shadow-lg"
          >
            Voltar para o início
            <svg
              xmlns="http://www.w3.org/2000/svg"
              className="h-5 w-5"
              viewBox="0 0 20 20"
              fill="currentColor"
            >
              <path
                fillRule="evenodd"
                d="M10.293 3.293a1 1 0 011.414 0l6 6a1 1 0 010 1.414l-6 6a1 1 0 01-1.414-1.414L14.586 11H3a1 1 0 110-2h11.586l-4.293-4.293a1 1 0 010-1.414z"
                clipRule="evenodd"
              />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  )
}