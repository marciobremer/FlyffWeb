'use client'


import { CountUp } from 'use-count-up'
import { DollarSign, CreditCard, BarChart2, ChevronRight } from 'lucide-react'
import AccountLists from '@/components/AccountLists'
import 'tippy.js/dist/tippy.css'
import { useRouter } from 'next/navigation'

export default function DashboardCards({ sidebarBottom }) {
  const router = useRouter()

  const stats = [
    {
      title: 'Doações RCash',
      value: 0,
      icon: DollarSign,
      prefix: '₱ ',
      sub: '0 transações',
      route: '/transactions/gcash'
    },
    {
      title: 'Doações PayPal',
      value: 0,
      icon: CreditCard,
      prefix: '€ ',
      sub: '0 transações',
      route: '/transactions/paypal'
    },
    {
      title: 'Atividade de votos',
      value: 0,
      icon: BarChart2,
      prefix: '',
      sub: 'Total de votos',
      route: '/transactions/votelogs'
    }
  ]

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
      <div className="lg:col-span-3 order-2 lg:order-1 space-y-6">
        <div className="bg-gray-900 border border-amber-500/30 rounded-2xl shadow-xl overflow-hidden sticky top-24">
          <div className="px-4 py-3 border-b border-gray-700/80">
            <h2 className="text-sm font-bold text-white">Atalhos</h2>
            <p className="text-xs text-gray-500 mt-0.5">Doações e atividade</p>
          </div>
          <div className="p-3 space-y-2">
            {stats.map((stat) => {
              const Icon = stat.icon
              return (
                <button
                  key={stat.title}
                  type="button"
                  onClick={() => router.push(stat.route)}
                  className="group w-full flex items-center gap-3 p-3 rounded-xl bg-gray-800/80 border border-gray-700 hover:border-amber-500/40 hover:bg-gray-800 text-left transition-all"
                >
                  <div className="flex-shrink-0 w-9 h-9 rounded-lg bg-amber-500/20 border border-amber-500/30 flex items-center justify-center">
                    <Icon className="w-4 h-4 text-amber-400" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-medium text-gray-400 truncate">{stat.title}</p>
                    <p className="text-sm font-bold text-white">
                      <CountUp isCounting end={stat.value} duration={1.5} prefix={stat.prefix || ''} />
                    </p>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-600 group-hover:text-amber-400 flex-shrink-0" />
                </button>
              )
            })}
          </div>
        </div>
        {sidebarBottom && <div>{sidebarBottom}</div>}
      </div>

      <div className="lg:col-span-9 order-1 lg:order-2 space-y-6">
        <div>
          <AccountLists />
        </div>
      </div>
    </div>
  )
}