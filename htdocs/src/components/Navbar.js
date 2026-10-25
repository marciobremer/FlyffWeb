'use client'

import React from 'react'
import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import {
  Home,
  BarChart2,
  Store,
  Trophy,
  Menu,
  X,
  LogIn,
  UserPlus,
  LogOut,
  User,
  Settings,
  MessageCircle,
  ChevronDown,
  ChevronRight,
} from 'lucide-react'

export default function Navbar() {
  const [scrolled, setScrolled] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const [username, setUsername] = useState('')
  const [isSuperUser, setIsSuperUser] = useState(false)
  const [showAdminDropdown, setShowAdminDropdown] = useState(false)
  const dropdownRef = useRef(null)

  useEffect(() => {
    const handleScroll = () => setScrolled(window.scrollY > 50)
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setShowAdminDropdown(false)
      }
    }
    window.addEventListener('scroll', handleScroll)
    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      window.removeEventListener('scroll', handleScroll)
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  const navItems = [
    { label: 'Início', href: '/', icon: Home },
    { label: 'Rankings', href: '/ranking', icon: BarChart2 },
    { label: 'Lojas', href: '/shops', icon: Store },
    { label: 'Top PayPal', href: '/paypal-ranking', icon: Trophy },
  ]

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/me', { method: 'GET', credentials: 'include' })
        if (res.ok) {
          const data = await res.json()
          setIsLoggedIn(true)
          setUsername(data.email || 'Visitante')
          setIsSuperUser(data.role?.toLowerCase() === 'super')
        } else {
          setIsLoggedIn(false)
        }
      } catch (err) {
        console.error('[ERRO AUTH]', err)
        setIsLoggedIn(false)
      }
    }
    checkAuth()
  }, [])

  const handleLogout = async () => {
    await fetch('/api/logout', { method: 'GET', credentials: 'include' })
    window.location.href = '/'
  }

  return (
    <nav
      className={`fixed top-0 z-[100] w-full transition-all duration-300 ${
        scrolled
          ? 'bg-[#0c0c10]/95 backdrop-blur-xl border-b border-white/5 shadow-[0_4px_30px_rgba(0,0,0,0.5)]'
          : 'bg-transparent'
      }`}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex justify-between items-center gap-4">
        <Link href="/" className="flex items-center shrink-0">
          <img
            src="/legion_rework.png"
            alt="ReactioN MMO"
            className={`transition-all duration-300 w-auto object-contain ${scrolled ? 'h-16' : 'h-[4.5rem]'}`}
          />
        </Link>

        <ul className="hidden md:flex items-center gap-1 flex-1 justify-center">
          <li className="flex items-center gap-1 p-1 rounded-full bg-white/5 border border-white/10">
            {navItems.map(({ label, href, icon: Icon }) => (
              <a
                key={label}
                href={href}
                className="flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium text-slate-300 hover:text-amber-400 hover:bg-amber-500/15 transition-all duration-200"
              >
                <Icon size={16} className="opacity-90" />
                <span>{label}</span>
              </a>
            ))}
          </li>
        </ul>

        <div className="hidden md:flex items-center gap-2 flex-1 justify-end">
          {isLoggedIn ? (
            <div className="relative" ref={dropdownRef}>
              <button
                onClick={() => setShowAdminDropdown(!showAdminDropdown)}
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-semibold rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 hover:bg-amber-500/25 transition-all duration-200"
              >
                <div className="w-7 h-7 rounded-full bg-amber-500/30 flex items-center justify-center">
                  <User size={14} />
                </div>
                <span className="max-w-[100px] truncate">{username}</span>
                <ChevronDown size={14} className={`transition-transform duration-200 ${showAdminDropdown ? 'rotate-180' : ''}`} />
              </button>

              {showAdminDropdown && (
                <div className="absolute top-full right-0 mt-2 w-56 rounded-2xl bg-[#0f0f14]/98 backdrop-blur-xl border border-white/10 shadow-2xl py-2 z-50 overflow-hidden">
                  <div className="px-4 py-2 border-b border-white/10">
                    <p className="text-xs text-slate-500 uppercase tracking-wider">Conta</p>
                    <p className="text-sm font-medium text-white truncate">{username}</p>
                  </div>
                  <div className="py-1">
                    <Link
                      href="/profile"
                      className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-200 hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
                      onClick={() => setShowAdminDropdown(false)}
                    >
                      <User size={16} className="text-slate-500" />
                      Meu perfil
                    </Link>
                    {isSuperUser && (
                      <Link
                        href="/admin"
                        className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-200 hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
                        onClick={() => setShowAdminDropdown(false)}
                      >
                        <Settings size={16} className="text-slate-500" />
                        Painel admin
                      </Link>
                    )}
                    {isSuperUser && (
                      <Link
                        href="/admin/paypal-ranking"
                        className="flex items-center gap-3 px-4 py-2.5 text-sm text-slate-200 hover:bg-amber-500/10 hover:text-amber-400 transition-colors"
                        onClick={() => setShowAdminDropdown(false)}
                      >
                        <Trophy size={16} className="text-slate-500" />
                        Recompensas PayPal
                      </Link>
                    )}
                  </div>
                  <div className="border-t border-white/10 py-1">
                    <button
                      onClick={handleLogout}
                      className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left"
                    >
                      <LogOut size={16} />
                      Sair
                    </button>
                  </div>
                </div>
              )}
            </div>
          ) : (
            <>
              <Link
                href="/login"
                className="flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-full text-slate-200 bg-white/5 border border-white/10 hover:bg-white/10 hover:border-white/20 transition-all duration-200"
              >
                <LogIn size={16} />
                Entrar
              </Link>
              <Link
                href="/register"
                className="flex items-center gap-2 px-5 py-2.5 text-sm font-semibold rounded-full bg-amber-500 text-[#0c0c10] hover:bg-amber-400 transition-all duration-200 shadow-lg shadow-amber-500/25"
              >
                <UserPlus size={16} />
                Cadastrar
              </Link>
            </>
          )}
        </div>

        <button
          onClick={() => setMenuOpen(!menuOpen)}
          className="md:hidden p-2.5 rounded-full text-slate-300 hover:text-amber-400 hover:bg-white/10 transition-colors"
          aria-label="Abrir o menu"
        >
          {menuOpen ? <X size={22} /> : <Menu size={22} />}
        </button>
      </div>

      {menuOpen && (
        <>
          <div
            className="md:hidden fixed inset-0 bg-black/80 backdrop-blur-sm z-[85]"
            onClick={() => setMenuOpen(false)}
            aria-hidden
          />
          <div className="md:hidden fixed top-0 right-0 bottom-0 w-full max-w-[320px] z-[90] flex flex-col bg-[#0a0a0e] border-l border-white/10 shadow-2xl">
            <div className="flex items-center justify-between p-4 border-b border-white/10 bg-gradient-to-r from-amber-500/10 to-transparent">
              <Link href="/" onClick={() => setMenuOpen(false)}>
                <img src="/legion_rework.png" alt="ReactioN MMO" className="h-12 w-auto object-contain" />
              </Link>
              <button
                onClick={() => setMenuOpen(false)}
                className="p-2 rounded-full text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
                aria-label="Fechar o menu"
              >
                <X size={20} />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">Menu</p>
                <div className="space-y-1">
                  {navItems.map(({ label, href, icon: Icon }) => (
                    <a
                      key={label}
                      href={href}
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-4 px-4 py-3.5 rounded-xl text-slate-200 hover:bg-amber-500/10 hover:text-amber-400 transition-all duration-200 group"
                    >
                      <div className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center group-hover:bg-amber-500/20 group-hover:border-amber-500/30 transition-colors">
                        <Icon size={20} />
                      </div>
                      <span className="font-medium flex-1">{label}</span>
                      <ChevronRight size={18} className="text-slate-500 group-hover:text-amber-400" />
                    </a>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3 px-1">Conta</p>
                <div className="space-y-2">
                  {isLoggedIn ? (
                    <>
                      <Link
                        href="/profile"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 font-medium"
                      >
                        <div className="w-10 h-10 rounded-xl bg-amber-500/25 flex items-center justify-center">
                          <User size={20} />
                        </div>
                        <span className="flex-1 truncate">Meu perfil</span>
                        <ChevronRight size={18} />
                      </Link>
                      {isSuperUser && (
                        <Link
                          href="/admin"
                          onClick={() => setMenuOpen(false)}
                          className="flex items-center gap-4 px-4 py-3.5 rounded-xl text-slate-200 hover:bg-white/5 border border-white/10 transition-colors"
                        >
                          <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                            <Settings size={20} />
                          </div>
                          <span className="font-medium flex-1">Painel admin</span>
                          <ChevronRight size={18} />
                        </Link>
                      )}
                      <button
                        onClick={() => { handleLogout(); setMenuOpen(false) }}
                        className="w-full flex items-center gap-4 px-4 py-3.5 rounded-xl text-red-400 hover:bg-red-500/10 border border-red-500/20 transition-colors"
                      >
                        <div className="w-10 h-10 rounded-xl bg-red-500/10 flex items-center justify-center">
                          <LogOut size={20} />
                        </div>
                        <span className="font-medium flex-1 text-left">Sair</span>
                      </button>
                    </>
                  ) : (
                    <>
                      <Link
                        href="/login"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-4 px-4 py-3.5 rounded-xl text-slate-200 hover:bg-white/5 border border-white/10 transition-colors"
                      >
                        <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center">
                          <LogIn size={20} />
                        </div>
                        <span className="font-medium flex-1">Entrar</span>
                        <ChevronRight size={18} />
                      </Link>
                      <Link
                        href="/register"
                        onClick={() => setMenuOpen(false)}
                        className="flex items-center gap-4 px-4 py-3.5 rounded-xl bg-amber-500 text-[#0c0c10] font-semibold border border-amber-400"
                      >
                        <div className="w-10 h-10 rounded-xl bg-amber-400/50 flex items-center justify-center">
                          <UserPlus size={20} />
                        </div>
                        <span className="flex-1">Cadastrar</span>
                        <ChevronRight size={18} />
                      </Link>
                    </>
                  )}
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </nav>
  )
}