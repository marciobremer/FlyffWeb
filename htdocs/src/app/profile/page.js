'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import DashboardCards from '@/components/DashboardCards'
import { Eye, EyeOff, Lock, ChevronDown, ChevronUp } from 'lucide-react'
import Swal from 'sweetalert2'

export default function UserPanelPage() {
  const [isLoading, setIsLoading] = useState(true)
  const [account, setAccount] = useState('')
  const [checkAuth, setCheckAuth] = useState(false)
  const router = useRouter()

  const [showChangePassword, setShowChangePassword] = useState(false)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })
  const [showPasswords, setShowPasswords] = useState({
    current: false,
    new: false,
    confirm: false
  })

  const [filterStatus, setFilterStatus] = useState('');
  const [accounts, setAccounts] = useState([]);
  const [selectedAccount, setSelectedAccount] = useState('');
  const [voteStatus, setVoteStatus] = useState('');
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [waitInterval, setWaitInterval] = useState(null);
  const [showVoteModal, setShowVoteModal] = useState(false);
  const [iframeUrl, setIframeUrl] = useState('');

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/me', {
          method: 'GET',
          credentials: 'include',
        })

        if (!res.ok) {
          router.replace('/')
          return
        }

        const data = await res.json()

        if (data?.email) {
          setAccount(data.email)
          setCheckAuth(true)
        } else {
          router.replace('/')
        }
      } catch (err) {
        console.error('Falha ao verificar a sessão', err)
        router.replace('/')
      } finally {
        setIsLoading(false)
      }
    }

    checkAuth()
  }, [router])

  useEffect(() => {
    if (account) {
      fetch(`/api/accounts`, { credentials: 'include' })
        .then(res => res.json())
        .then(data => {
          if (data.success && data.accounts.length > 0) {
            setAccounts(data.accounts);
            setSelectedAccount(data.accounts[0].name);
          }
        });
    }
  }, [account]);

  const handlePasswordChange = async (e) => {
    e.preventDefault()
    
    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      Swal.fire({
        icon: 'error',
        title: 'As senhas não conferem',
        text: 'As novas senhas não conferem.',
        confirmButtonColor: '#f59e0b',
        background: '#1a1a1a',
        color: '#fff'
      })
      return
    }

    if (passwordForm.newPassword.length < 4) {
      Swal.fire({
        icon: 'error',
        title: 'Senha inválida',
        text: 'A nova senha deve ter pelo menos 4 caracteres.',
        confirmButtonColor: '#f59e0b',
        background: '#1a1a1a',
        color: '#fff'
      })
      return
    }

    try {
      const response = await fetch('/api/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: account,
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        })
      })

      const data = await response.json()

      if (response.ok && data.success) {
        await Swal.fire({
          icon: 'success',
          title: 'Sucesso',
          text: 'Senha atualizada com sucesso!',
          confirmButtonColor: '#f59e0b',
          background: '#1a1a1a',
          color: '#fff'
        })
        
        setPasswordForm({
          currentPassword: '',
          newPassword: '',
          confirmPassword: ''
        })
        setShowChangePassword(false)
      } else {
        Swal.fire({
          icon: 'error',
          title: 'Erro',
          text: data.error || 'Não foi possível atualizar a senha.',
          confirmButtonColor: '#f59e0b',
          background: '#1a1a1a',
          color: '#fff'
        })
      }
    } catch (error) {
      Swal.fire({
        icon: 'error',
        title: 'Erro',
        text: 'Ocorreu um erro. Tente novamente.',
        confirmButtonColor: '#f59e0b',
        background: '#1a1a1a',
        color: '#fff'
      })
    }
  }

  const handleAddToFirewall = async () => {
    setFilterStatus('Processando...');
    try {
      const res = await fetch('/api/add-to-firewall');
      const data = await res.json();
      if (data.success) {
        setFilterStatus(`IP ${data.ip} adicionado ao firewall!`);
      } else {
        setFilterStatus('Falha ao adicionar o IP: ' + (data.error || 'Erro desconhecido'));
      }
    } catch (err) {
      setFilterStatus('Falha ao adicionar o IP: ' + err.message);
    }
  };

  const handleClaimReward = async () => {
    setVoteStatus('Verificando...');
    try {
      const res = await fetch(`/api/vote-pingback?site=gtop100&custom=${selectedAccount}&status=success`);
      const data = await res.json();
      if (data.success) {
        setVoteStatus('Recompensa de voto resgatada com sucesso!');
      } else {
        setVoteStatus(data.error || 'Não foi possível resgatar a recompensa.');
      }
    } catch (err) {
      setVoteStatus('Não foi possível resgatar a recompensa.');
    }
  };

  const handleVoteClick = async () => {
    setVoteStatus('');
    if (waitInterval) {
      clearInterval(waitInterval);
      setWaitInterval(null);
    }
    const res = await fetch('/api/log-vote-click', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ account: selectedAccount, site: 'gtop100' }),
    });
    const data = await res.json();
    if (data.success) {
      setIframeUrl(`https://gtop100.com/Flyff/server-104973?vote=1&pingUsername=${selectedAccount}`);
      setShowVoteModal(true);
      setWaitSeconds(12 * 60 * 60);
      const interval = setInterval(() => {
        setWaitSeconds(prev => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
      setWaitInterval(interval);
    } else {
      setVoteStatus(data.error || 'Você já votou recentemente.');
      if (data.wait_seconds) {
        setWaitSeconds(data.wait_seconds);
        const interval = setInterval(() => {
          setWaitSeconds(prev => {
            if (prev <= 1) {
              clearInterval(interval);
              return 0;
            }
            return prev - 1;
          });
        }, 1000);
        setWaitInterval(interval);
      }
    }
  };

  function formatWaitTime(seconds) {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h}h ${m}m ${s}s`;
  }

  if (isLoading) return null

  if (!checkAuth) {
    return (
      <section className="min-h-screen bg-black text-white flex items-center justify-center relative overflow-hidden">
        <img src="/bg.png" alt="" className="absolute inset-0 w-full h-full object-cover z-0" />
        <div className="absolute inset-0 bg-black/70 z-[1]" />
        <p className="relative z-10 text-xl animate-pulse text-amber-400">Verificando o acesso à sessão...</p>
      </section>
    )
  }

  return (
    <section className="min-h-screen bg-black text-white relative overflow-hidden">
      <img src="/bg.png" alt="" className="absolute inset-0 w-full h-full object-cover z-0" />
      <div className="absolute inset-0 bg-black/70 z-[1]" />
      <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 pt-24 sm:pt-28 pb-8 sm:pb-12">
        <div className="mb-6 sm:mb-10">
          <DashboardCards
            sidebarBottom={
              <div className="bg-gray-900 border border-amber-500/30 rounded-2xl shadow-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-gray-700/80 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Lock className="w-5 h-5 text-amber-400 flex-shrink-0" />
                    <h2 className="text-sm font-bold text-amber-400 truncate">Configurações de segurança</h2>
                  </div>
                  <button
                    type="button"
                    onClick={() => setShowChangePassword(!showChangePassword)}
                    className="flex items-center gap-1 text-xs font-medium text-gray-400 hover:text-amber-400 transition-colors flex-shrink-0"
                  >
                    {showChangePassword ? <><ChevronUp size={14} /> Ocultar</> : <><ChevronDown size={14} /> Alterar</>}
                  </button>
                </div>
                {showChangePassword && (
                  <form onSubmit={handlePasswordChange} className="p-4 space-y-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Senha atual</label>
                      <div className="relative">
                        <input
                          type={showPasswords.current ? 'text' : 'password'}
                          value={passwordForm.currentPassword}
                          onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                          placeholder="••••••••"
                          className="w-full px-3 py-2 pr-9 text-sm bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswords({ ...showPasswords, current: !showPasswords.current })}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-amber-400"
                        >
                          {showPasswords.current ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Nova senha</label>
                      <div className="relative">
                        <input
                          type={showPasswords.new ? 'text' : 'password'}
                          value={passwordForm.newPassword}
                          onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                          placeholder="••••••••"
                          className="w-full px-3 py-2 pr-9 text-sm bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswords({ ...showPasswords, new: !showPasswords.new })}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-amber-400"
                        >
                          {showPasswords.new ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Confirmar a nova senha</label>
                      <div className="relative">
                        <input
                          type={showPasswords.confirm ? 'text' : 'password'}
                          value={passwordForm.confirmPassword}
                          onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                          placeholder="••••••••"
                          className="w-full px-3 py-2 pr-9 text-sm bg-gray-800 border border-gray-600 rounded-lg text-white placeholder-gray-500 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
                          required
                        />
                        <button
                          type="button"
                          onClick={() => setShowPasswords({ ...showPasswords, confirm: !showPasswords.confirm })}
                          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-gray-500 hover:text-amber-400"
                        >
                          {showPasswords.confirm ? <EyeOff size={16} /> : <Eye size={16} />}
                        </button>
                      </div>
                    </div>
                    <button
                      type="submit"
                      className="w-full py-2.5 rounded-lg text-sm font-semibold text-black bg-amber-500 border border-amber-400 hover:bg-amber-400 transition-colors"
                    >
                      Atualizar a senha
                    </button>
                  </form>
                )}
              </div>
            }
          />
        </div>

        <div>
          <div className="bg-gray-900 border border-amber-500/30 rounded-2xl p-5 sm:p-6 shadow-xl">
            <h2 className="text-lg font-bold text-amber-400 mb-4">Informações da conta</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Conta</label>
                <p className="text-white font-medium break-all mt-0.5">{account}</p>
              </div>
              <div>
                <label className="text-xs font-medium text-gray-500 uppercase tracking-wider">Status</label>
                <p className="text-amber-400 font-medium mt-0.5">Ativa</p>
              </div>
            </div>
            <button
              onClick={handleAddToFirewall}
              className="mt-5 w-full px-4 py-2.5 rounded-lg font-medium text-black bg-amber-500 border border-amber-400 hover:bg-amber-400 transition-colors"
            >
              Filtrar meu IP
            </button>
            {filterStatus && (
              <div className="mt-2 text-sm text-gray-400 bg-gray-800/80 px-3 py-2 rounded-lg border border-gray-700">
                {filterStatus}
              </div>
            )}

            <div className="mt-6 pt-6 border-t border-gray-700">
              <h2 className="text-lg font-bold text-amber-400 mb-3">Vote e ganhe recompensas</h2>
              <label className="block text-sm text-gray-400 mb-2">Conta a creditar</label>
              <select
                value={selectedAccount}
                onChange={e => setSelectedAccount(e.target.value)}
                className="w-full mb-3 px-3 py-2.5 rounded-lg bg-gray-800 border border-gray-600 text-white focus:border-amber-500 focus:ring-1 focus:ring-amber-500 outline-none"
              >
                {accounts.map(acc => (
                  <option key={acc.name} value={acc.name}>
                    {acc.name} (Cash: {acc.cash}, VPoints: {acc.votepoint})
                  </option>
                ))}
              </select>
              {selectedAccount && (
                <div className="mb-3 text-sm text-gray-400 space-y-0.5">
                  {(() => {
                    const acc = accounts.find(a => a.name === selectedAccount);
                    if (!acc) return null;
                    return (
                      <>
                        <div>Cash: <span className="text-amber-400 font-semibold">{acc.cash}</span></div>
                        <div>Pontos de voto: <span className="text-amber-400 font-semibold">{acc.votepoint}</span></div>
                      </>
                    );
                  })()}
                </div>
              )}
              <button
                onClick={handleVoteClick}
                className="w-full mb-2 px-4 py-2.5 rounded-lg font-medium text-black bg-amber-500 border border-amber-400 hover:bg-amber-400 transition-colors"
              >
                Votar no GTOP100
              </button>
              <button
                onClick={handleClaimReward}
                className="w-full px-4 py-2.5 rounded-lg font-medium text-amber-400 border border-amber-500/40 bg-amber-500/10 hover:bg-amber-500/20 transition-colors"
              >
                Resgatar a recompensa de voto
              </button>
              {voteStatus && <div className="mt-2 text-sm text-gray-400">{voteStatus}</div>}
              {waitSeconds > 0 && (
                <div className="mt-2 text-sm text-amber-400">
                  Próximo voto em: {formatWaitTime(waitSeconds)}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {showVoteModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80">
          <div className="bg-gray-900 border border-amber-500/30 rounded-2xl shadow-xl p-4 max-w-2xl w-full relative">
            <button
              onClick={() => setShowVoteModal(false)}
              className="absolute top-3 right-3 z-10 px-3 py-1.5 rounded-lg text-sm font-medium bg-gray-700 text-white hover:bg-gray-600 transition-colors"
            >
              Fechar
            </button>
            <iframe
              src={iframeUrl}
              title="Votar no GTOP100"
              className="w-full h-[500px] sm:h-[600px] rounded-lg border border-gray-700"
              allow="clipboard-write"
            />
          </div>
        </div>
      )}
    </section>
  )
}