import Image from 'next/image'
import { ChevronRight } from 'lucide-react'

export default function Footer() {
  return (
    <footer className="bg-[#0f172a] text-gray-300 border-t border-white/10 px-6 pt-12 pb-6">
      <div className="max-w-7xl mx-auto grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-10">
        <div>
          <h4 className="text-white font-semibold mb-3 uppercase tracking-wide">Conta</h4>
          <ul className="space-y-2 text-sm">
            <li>
              <a href="/register" className="flex items-center gap-1 hover:text-yellow-400">
                <ChevronRight className="w-4 h-4" /> Cadastrar
              </a>
            </li>
            <li>
              <a href="/login" className="flex items-center gap-1 hover:text-yellow-400">
                <ChevronRight className="w-4 h-4" /> Entrar
              </a>
            </li>
            <li>
              <a href="/game/" className="flex items-center gap-1 hover:text-yellow-400">
                <ChevronRight className="w-4 h-4" /> Jogar agora
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="text-white font-semibold mb-3 uppercase tracking-wide">Comunidade</h4>
          <ul className="space-y-2 text-sm">
            <li>
              <a href="/forum" className="flex items-center gap-1 hover:text-yellow-400">
                <ChevronRight className="w-4 h-4" /> Forum
              </a>
            </li>
            <li>
              <a
                href="https://discord.gg/Qq4KManJSn"
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-1 hover:text-yellow-400"
              >
                <ChevronRight className="w-4 h-4" /> Discord
              </a>
            </li>
            <li>
              <a href="/ranking" className="flex items-center gap-1 hover:text-yellow-400">
                <ChevronRight className="w-4 h-4" /> Rankings
              </a>
            </li>
          </ul>
        </div>

        <div>
          <h4 className="text-white font-semibold mb-3 uppercase tracking-wide">Suporte</h4>
          <ul className="space-y-2 text-sm">
            <li>
              <a href="/help" className="flex items-center gap-1 hover:text-yellow-400">
                <ChevronRight className="w-4 h-4" /> Central de ajuda
              </a>
            </li>
            <li>
              <a href="/contact" className="flex items-center gap-1 hover:text-yellow-400">
                <ChevronRight className="w-4 h-4" /> Fale conosco
              </a>
            </li>
            <li>
              <a href="/bug-report" className="flex items-center gap-1 hover:text-yellow-400">
                <ChevronRight className="w-4 h-4" /> Reportar um bug
              </a>
            </li>
          </ul>
        </div>

        <div className="flex flex-col items-start md:items-center text-left md:text-center space-y-3">
          <Image
            src="/logo-reaction.webp"
            alt="Logo ReactioN MMO"
            width={110}
            height={110}
            className="object-contain drop-shadow-md"
          />
          <p className="text-sm text-gray-400">© 2026 ReactioN MMO. Todos os direitos reservados.</p>
          <p className="text-xs text-gray-500">Uma experiência MMORPG movida pela comunidade</p>
        </div>
      </div>
    </footer>
  )
}