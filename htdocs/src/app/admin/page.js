'use client'
import React, { useEffect, useState, useCallback } from 'react'
import { createPortal } from 'react-dom'
import Swal from 'sweetalert2'
import { Download, Users, LayoutDashboard, FileText, Settings, Trash2, Edit2, Save, Lock, PauseCircle, FilePlus, Image, ShoppingBag, Percent, DollarSign, Activity, Star, Mail, ArrowUpRight, Coins, Swords, UserPlus, X } from 'lucide-react'
import { SiMega, SiMediafire } from 'react-icons/si'
import { FaGoogleDrive } from 'react-icons/fa'
import DataTable from 'react-data-table-component'
import { useRouter } from 'next/navigation'
export default function AdminPanelPage() {
  const router = useRouter()
  const [isAuthorized, setIsAuthorized] = useState(false)

  const [isSaving, setIsSaving] = useState(false)
  const [activeTab, setActiveTab] = useState('dashboard')
  const [downloadLinks, setDownloadLinks] = useState([])
  const [newsPosts, setNewsPosts] = useState([])
  const [form, setForm] = useState({ title: '', content: '', imageFile: null })
  const [editingPostId, setEditingPostId] = useState(null)

  const [tradeLogs, setTradeLogs] = useState([])
  const [tradeStats, setTradeStats] = useState({
    total: 0,
    today: 0,
    activePlayers: 0
  })
  const [isLoadingTrades, setIsLoadingTrades] = useState(true)
  const [tradeSearch, setTradeSearch] = useState({
    player: '',
    item: ''
  })
  const [tradePage, setTradePage] = useState(1)
  const [tradeLimit] = useState(50)

  const [mailLogs, setMailLogs] = useState([])
  const [mailStats, setMailStats] = useState({
    total: 0,
    today: 0,
    activeUsers: 0
  })
  const [isLoadingMails, setIsLoadingMails] = useState(true)
  const [mailSearch, setMailSearch] = useState({
    sender: '',
    receiver: '',
    item: ''
  })
  const [mailPage, setMailPage] = useState(1)
  const [mailLimit] = useState(50)

  const [editingId, setEditingId] = useState(null)
  const [newLink, setNewLink] = useState({ name: '', url: '', size: '', icon_type: 'default' })
  const [loading, setLoading] = useState(true)
  const [userList, setUserList] = useState([])
  const [filteredUsers, setFilteredUsers] = useState([])
  const [topupItems, setTopupItems] = useState([])
  const [newTopupItem, setNewTopupItem] = useState({
    name: '',
    description: '',
    price: '',
    points: '',
    category: 'cash',
    isOnSale: false,
    salePercentage: '',
    imageFile: null
  })
  
  const [editingTopupId, setEditingTopupId] = useState(null)
  const [showTopupModal, setShowTopupModal] = useState(false)
  
  const [dashboardStats, setDashboardStats] = useState({
    online_players: { total: 0, high_level: 0, low_level: 0 },
    accounts: { total: 0, total_characters: 0, max_level_chars: 0 },
    today: { new_accounts: 0, new_characters: 0, trades: 0, mails: 0 },
    top_characters: [],
    recent_trades: [],
    class_distribution: []
  })
  const [isLoadingDashboard, setIsLoadingDashboard] = useState(true)

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const res = await fetch('/api/me', {
          method: 'GET',
          credentials: 'include',
        })
  
        if (res.ok) {
          const data = await res.json()
          if (data.role?.toLowerCase() === 'super') {
            setIsAuthorized(true)
          } else {
            await Swal.fire('Acces refuse', 'Vous n etes pas autorise a acceder a cette page.', 'warning')
            router.push('/')
          }
        } else {
          router.push('/')
        }
      } catch (err) {
        console.error('Echec de la verification des autorisations', err)
        router.push('/')
      }
    }
  
    checkAuth()
  }, [])
  
  useEffect(() => {
    if (isAuthorized) {
      fetchDownloads()
      fetchUsers()
      fetchNews()
      fetchTopupItems()
    }
  }, [isAuthorized])
  
  useEffect(() => {
    if (isAuthorized && activeTab === 'trade-logs') {
      fetchTradeLogs()
    }
  }, [isAuthorized, activeTab, tradePage, tradeSearch.player, tradeSearch.item, tradeLimit])

  useEffect(() => {
    if (isAuthorized && activeTab === 'mail-logs') {
      fetchMailLogs()
    }
  }, [isAuthorized, activeTab, mailPage, mailSearch.sender, mailSearch.receiver, mailSearch.item, mailLimit])
  
  useEffect(() => {
    if (isAuthorized && activeTab === 'dashboard') {
      fetchDashboardStats()
    }
  }, [isAuthorized, activeTab])

  const fetchDownloads = async () => {
    try {
      const res = await fetch('/api/downloads')
      const data = await res.json()
      setDownloadLinks(data)
    } catch (err) {
      console.error('Impossible de charger les liens de telechargement', err)
    } finally {
      setLoading(false)
    }
  }

  const fetchUsers = async () => {
    try {
      const res = await fetch('/api/users')
      const data = await res.json()
      setUserList(data)
      setFilteredUsers(data)
    } catch (err) {
      console.error('Impossible de charger les utilisateurs :', err)
    }
  }

  const fetchNews = async () => {
    try {
      const res = await fetch('/api/posts')
      const data = await res.json()
      setNewsPosts(data)
    } catch (err) {
      console.error('Impossible de charger les actualites :', err)
    }
  }

  const fetchTopupItems = async () => {
    try {
      const res = await fetch('/api/topup')
      const data = await res.json()
      setTopupItems(data)
    } catch (err) {
      console.error('Impossible de charger les articles top-up :', err)
    }
  }

  const fetchTradeLogs = async () => {
    setIsLoadingTrades(true)
    try {
      const searchParams = new URLSearchParams({
        page: tradePage,
        limit: tradeLimit,
        ...(tradeSearch.player && { player: tradeSearch.player }),
        ...(tradeSearch.item && { item: tradeSearch.item })
      })

      const res = await fetch(`/api/logs/trade?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Impossible de charger les logs d echange')
      }

      const data = await res.json()
      
      setTradeLogs(data.trades || [])
      setTradeStats({
        total: data.pagination?.total || 0,
        today: data.todayTrades || 0,
        activePlayers: data.activePlayers || 0
      })
    } catch (err) {
      console.error('Impossible de charger les logs d echange :', err)
      Swal.fire({
        title: 'Erreur',
        text: err.message || 'Impossible de charger les logs d echange. Veuillez reessayer.',
        icon: 'error'
      })
      setTradeLogs([])
      setTradeStats({
        total: 0,
        today: 0,
        activePlayers: 0
      })
    } finally {
      setIsLoadingTrades(false)
    }
  }

  const fetchMailLogs = async () => {
    setIsLoadingMails(true)
    try {
      const searchParams = new URLSearchParams({
        page: mailPage,
        limit: mailLimit,
        ...(mailSearch.sender && { sender: mailSearch.sender }),
        ...(mailSearch.receiver && { receiver: mailSearch.receiver }),
        ...(mailSearch.item && { item: mailSearch.item })
      })

      const res = await fetch(`/api/logs/mail?${searchParams.toString()}`, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Impossible de charger les logs de courrier')
      }

      const data = await res.json()
      
      setMailLogs(data.mails || [])
      setMailStats({
        total: data.pagination?.total || 0,
        today: data.todayMails || 0,
        activeUsers: data.activeUsers || 0
      })
    } catch (err) {
      console.error('Impossible de charger les logs de courrier :', err)
      Swal.fire({
        title: 'Erreur',
        text: err.message || 'Impossible de charger les logs de courrier. Veuillez reessayer.',
        icon: 'error'
      })
      setMailLogs([])
      setMailStats({
        total: 0,
        today: 0,
        activeUsers: 0
      })
    } finally {
      setIsLoadingMails(false)
    }
  }

  const fetchDashboardStats = async () => {
    setIsLoadingDashboard(true)
    try {
      const res = await fetch('/api/dashboard/stats', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        },
        cache: 'no-store'
      })

      if (!res.ok) {
        const errorData = await res.json()
        throw new Error(errorData.error || 'Impossible de charger les statistiques du tableau de bord')
      }

      const data = await res.json()
      setDashboardStats(data)
    } catch (err) {
      console.error('Impossible de charger les statistiques du tableau de bord :', err)
      Swal.fire({
        title: 'Erreur',
        text: 'Impossible de charger les statistiques du tableau de bord',
        icon: 'error'
      })
    } finally {
      setIsLoadingDashboard(false)
    }
  }

  const handleTradeSearch = useCallback((type, value) => {
    setTradeSearch(prev => ({ ...prev, [type]: value }))
    setTradePage(1)
  }, [])

  const handleMailSearch = useCallback((type, value) => {
    setMailSearch(prev => ({ ...prev, [type]: value }))
    setMailPage(1)
  }, [])

  const handleAdd = async () => {
    if (!newLink.name || !newLink.url || !newLink.size) {
        return Swal.fire('Informations manquantes', 'Veuillez remplir tous les champs.', 'warning')
    }
  
    setIsSaving(true)
    try {
      const res = await fetch('/api/downloads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newLink),
      })
  
      if (res.ok) {
        fetchDownloads()
        setNewLink({ name: '', url: '', size: '', icon_type: 'default' })
        Swal.fire('Succes', 'Lien de telechargement ajoute !', 'success')
      } else {
        Swal.fire('Erreur', 'Impossible d ajouter le lien de telechargement.', 'error')
      }
    } catch (err) {
      console.error(err)
      Swal.fire('Erreur', 'Une erreur est survenue.', 'error')
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleEdit = (id, type = 'download') => {
    if (type === 'download') {
      setEditingId(id)
    } else if (type === 'post') {
      const post = newsPosts.find(p => p.id === id)
      if (post) {
        setEditingPostId(id)
        setForm({
          title: post.title,
          content: post.content,
          imageFile: null
        })
      }
    }
  }

  const handleSave = async (id, updated) => {
    if (!updated.name || !updated.url || !updated.size) {
      return Swal.fire('Informations manquantes', 'Veuillez remplir tous les champs.', 'warning')
    }
  
    setIsSaving(true)
    try {
      const res = await fetch(`/api/downloads/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updated),
      })
  
      if (res.ok) {
        fetchDownloads()
        setEditingId(null)
        Swal.fire('Mis a jour', 'Lien de telechargement mis a jour avec succes !', 'success')
      } else {
        Swal.fire('Erreur', 'Impossible de mettre a jour le lien.', 'error')
      }
    } catch (err) {
      console.error(err)
      Swal.fire('Erreur', 'Une erreur est survenue.', 'error')
    } finally {
      setIsSaving(false)
    }
  }
  
  const handleDelete = async (id) => {
    const result = await Swal.fire({
      title: 'Etes-vous sur ?',
      text: 'Cela supprimera definitivement le lien.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Oui, supprimer !',
    })

    if (result.isConfirmed) {
      try {
        await fetch(`/api/downloads/${id}`, { method: 'DELETE' })
        fetchDownloads()
        Swal.fire('Supprime !', 'Le lien de telechargement a ete supprime.', 'success')
      } catch (err) {
        console.error(err)
        Swal.fire('Erreur', 'Impossible de supprimer le lien.', 'error')
      }
    }
  }

  const handleNewsSubmit = async () => {
    if (!form.title || !form.content || !form.imageFile) {
      return Swal.fire('Champs manquants', 'Veuillez remplir tous les champs.', 'warning')
    }

    setIsSaving(true)
    try {
      const formData = new FormData()
      formData.append('title', form.title)
      formData.append('content', form.content)
      formData.append('image', form.imageFile)

      const method = editingPostId ? 'PUT' : 'POST'
      const url = editingPostId ? `/api/posts/${editingPostId}` : '/api/posts'

      const res = await fetch(url, {
        method,
        body: formData
      })

      if (res.ok) {
        await fetchNews()
        Swal.fire('Succes', editingPostId ? 'Article mis a jour !' : 'Article ajoute !', 'success')
        setForm({ title: '', content: '', imageFile: null })
        setEditingPostId(null)
      } else {
        Swal.fire('Erreur', 'Impossible d enregistrer l article.', 'error')
      }
    } catch (err) {
      console.error(err)
      Swal.fire('Erreur', 'Une erreur est survenue.', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleNewsDelete = async (id) => {
    const confirm = await Swal.fire({
      title: 'Etes-vous sur ?',
      text: 'Cela supprimera definitivement l article.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonText: 'Oui, supprimer !'
    })

    if (confirm.isConfirmed) {
      try {
        await fetch(`/api/posts/delete-post/${id}`, { method: 'DELETE' })
        fetchNews()
        Swal.fire('Supprime !', 'Article supprime.', 'success')
      } catch (err) {
        Swal.fire('Erreur', 'Impossible de supprimer l article.', 'error')
      }
    }
  }

  const handleTopupSubmit = async (e) => {
    e.preventDefault()
    if (!newTopupItem.name || !newTopupItem.price || !newTopupItem.points) {
      return Swal.fire('Champs manquants', 'Veuillez remplir tous les champs obligatoires.', 'warning')
    }

    setIsSaving(true)
    try {
      const formData = new FormData()
      formData.append('name', newTopupItem.name)
      formData.append('description', newTopupItem.description || '')
      formData.append('price', newTopupItem.price)
      formData.append('points', newTopupItem.points)
      formData.append('category', newTopupItem.category)
      formData.append('isOnSale', newTopupItem.isOnSale)
      formData.append('salePercentage', newTopupItem.salePercentage || '')
      
      if (newTopupItem.imageFile) {
        formData.append('image', newTopupItem.imageFile)
      }

      const method = editingTopupId ? 'PUT' : 'POST'
      const url = editingTopupId ? `/api/topup/${editingTopupId}` : '/api/topup'

      const res = await fetch(url, {
        method,
        body: formData
      })

      if (res.ok) {
        await fetchTopupItems()
        setNewTopupItem({
          name: '',
          description: '',
          price: '',
          points: '',
          category: 'cash',
          isOnSale: false,
          salePercentage: '',
          imageFile: null
        })
        setEditingTopupId(null)
        setShowTopupModal(false)
        Swal.fire('Succes', editingTopupId ? 'Article mis a jour !' : 'Article ajoute !', 'success')
      } else {
        const data = await res.json()
        Swal.fire('Erreur', data.error || 'Impossible d enregistrer l article.', 'error')
      }
    } catch (err) {
      console.error(err)
      Swal.fire('Erreur', 'Une erreur est survenue.', 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const handleTopupDelete = async (id) => {
    const result = await Swal.fire({
      title: 'Etes-vous sur ?',
      text: 'Cela supprimera definitivement cet article top-up.',
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Oui, supprimer !'
    })

    if (result.isConfirmed) {
      try {
        await fetch(`/api/topup/${id}`, { method: 'DELETE' })
        fetchTopupItems()
        Swal.fire('Supprime !', 'Article top-up supprime.', 'success')
      } catch (err) {
        console.error(err)
        Swal.fire('Erreur', 'Impossible de supprimer l article.', 'error')
      }
    }
  }

  const handleEditTopup = (item) => {
    setEditingTopupId(item.id)
    setNewTopupItem({
      name: item.name,
      description: item.description,
      price: parseFloat(item.price),
      points: parseInt(item.points),
      category: item.category,
      isOnSale: item.is_on_sale === 1,
      salePercentage: item.sale_percentage || '',
      imageFile: null
    })
    setShowTopupModal(true)
  }

  const openAddTopupModal = () => {
    setEditingTopupId(null)
    setNewTopupItem({
      name: '',
      description: '',
      price: '',
      points: '',
      category: 'cash',
      isOnSale: false,
      salePercentage: '',
      imageFile: null
    })
    setShowTopupModal(true)
  }

  const closeTopupModal = () => {
    setShowTopupModal(false)
    setEditingTopupId(null)
    setNewTopupItem({
      name: '',
      description: '',
      price: '',
      points: '',
      category: 'cash',
      isOnSale: false,
      salePercentage: '',
      imageFile: null
    })
  }

  const tabClasses = (tab) =>
    `px-4 py-2 text-sm rounded-xl font-semibold transition border ${
      activeTab === tab
        ? 'bg-amber-600 text-white border-amber-500 shadow-lg shadow-amber-500/20'
        : 'bg-gray-800 text-white border-gray-700 hover:border-amber-500/40 hover:bg-gray-800/80'
    }`

  const getIcon = (type) => {
    switch (type) {
      case 'mega':
        return <SiMega className="text-4xl text-white mb-2" />
      case 'mediafire':
        return <SiMediafire className="text-4xl text-white mb-2" />
      case 'google':
        return <FaGoogleDrive className="text-4xl text-white mb-2" />
      default:
        return <Download className="text-4xl text-white mb-2" />
    }
  }

  const getCardBorderColor = (type) => {
    switch (type) {
      case 'mega':
        return 'border-l-red-500'
      case 'mediafire':
        return 'border-l-blue-500'
      case 'google':
        return 'border-l-green-500'
      default:
        return 'border-l-gray-500'
    }
  }

  const handleChangePassword = async (account) => {
    const { value: newPassword } = await Swal.fire({
      title: `Changer le mot de passe de ${account}`,
      input: 'password',
      inputLabel: 'Nouveau mot de passe',
      inputPlaceholder: 'Entrez le nouveau mot de passe',
      inputAttributes: {
        minlength: 4,
        autocapitalize: 'off',
        autocorrect: 'off'
      },
      showCancelButton: true,
      confirmButtonText: 'Changer',
      cancelButtonText: 'Annuler'
    })
  
    if (newPassword) {
      try {
        const res = await fetch('/api/users/change-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ account, password: newPassword })
        })
  
        if (res.ok) {
          Swal.fire('Succes', 'Mot de passe mis a jour avec succes !', 'success')
        } else {
          Swal.fire('Erreur', 'Impossible de mettre a jour le mot de passe.', 'error')
        }
      } catch (err) {
        console.error(err)
        Swal.fire('Erreur', 'Une erreur est survenue.', 'error')
      }
    }
  }
  
  const handleHoldCharacter = async (characterName) => {
    const result = await Swal.fire({
      title: 'Suspendre le personnage',
      text: `Etes-vous sur de vouloir suspendre ${characterName} ?`,
      icon: 'warning',
      showCancelButton: true,
      confirmButtonColor: '#d33',
      cancelButtonColor: '#3085d6',
      confirmButtonText: 'Oui, suspendre !'
    })

    if (result.isConfirmed) {
      try {
        await fetch(`/api/users/hold-character/${characterName}`, { method: 'POST' })
        Swal.fire('Succes', 'Personnage suspendu avec succes !', 'success')
      } catch (err) {
        console.error(err)
        Swal.fire('Erreur', 'Impossible de suspendre le personnage.', 'error')
      }
    }
  } 

  if (!isAuthorized) {
    return (
      <section className="min-h-screen bg-black/70 text-white flex items-center justify-center pt-24 relative overflow-hidden">
        <div className="absolute inset-0 bg-[url('/bg.png')] bg-cover bg-center opacity-20" />
        <p className="text-lg animate-pulse text-amber-400 relative z-10">Verification de l acces administrateur...</p>
      </section>
    )
  }

  return (
    <section className="min-h-screen bg-black/70 px-4 py-12 text-white relative overflow-hidden pt-24 sm:pt-28">
      <div className="absolute inset-0 bg-[url('/bg.png')] bg-cover bg-center opacity-20" />
      <div className="container mx-auto relative z-10 max-w-7xl">
        <div className="mb-6 flex items-center gap-3">
          <div className="p-2.5 bg-amber-500/20 border border-amber-500/30 rounded-xl">
            <LayoutDashboard className="w-6 h-6 text-amber-400" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-white">Panneau administrateur</h1>
            <p className="text-sm text-gray-400">Gestion de Reborn-MMO</p>
          </div>
        </div>

        <div className="flex gap-2 mb-6 flex-wrap">
          <button className={tabClasses('dashboard')} onClick={() => setActiveTab('dashboard')}>
            <LayoutDashboard className="inline mr-2" size={14} />
            Tableau de bord
          </button>
          <button className={tabClasses('downloads')} onClick={() => setActiveTab('downloads')}>
            <Download className="inline mr-2" size={14} />
            Telechargements
          </button>
          <button className={tabClasses('users')} onClick={() => setActiveTab('users')}>
            <Users className="inline mr-2" size={14} />
            Utilisateurs
          </button>
          <button className={tabClasses('posts')} onClick={() => setActiveTab('posts')}>
            <FileText className="inline mr-2" size={14} />
            Actualites
          </button>
		  <button className={tabClasses('topup')} onClick={() => setActiveTab('topup')}>
		  <ShoppingBag className="inline mr-2" size={14} />
		  Boutique
		  </button>
          <button className={tabClasses('trade-logs')} onClick={() => setActiveTab('trade-logs')}>
            <FileText className="inline mr-2" size={14} />
            Echanges
          </button>
          <button className={tabClasses('mail-logs')} onClick={() => setActiveTab('mail-logs')}>
            <FileText className="inline mr-2" size={14} />
            Courrier
          </button>
          <button className={tabClasses('settings')} onClick={() => setActiveTab('settings')}>
            <Settings className="inline mr-2" size={14} />
            Parametres
          </button>
        </div>

        <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-xl p-6">

        <div className="text-white">
        {activeTab === 'downloads' && (
          <>
            <h2 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
              <Download size={18} /> Liens de telechargement
            </h2>

            {loading ? (
              <p className="text-center text-gray-400 py-8">Chargement...</p>
            ) : (
              <div className="grid md:grid-cols-3 gap-4 mb-6">
                {downloadLinks.map(link => (
                  <div key={link.id} className={`p-4 rounded-xl text-center border border-gray-700 border-l-4 bg-gray-800 ${getCardBorderColor(link.icon_type)}`}>
                    {getIcon(link.icon_type)}
                    {editingId === link.id ? (
                      <>
                        <input
                          type="text"
                          value={link.name}
                          onChange={(e) =>
                            setDownloadLinks(prev =>
                              prev.map(l => l.id === link.id ? { ...l, name: e.target.value } : l)
                            )
                          }
                          className="mt-2 w-full bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-white text-center text-sm"
                        />
                        <input
                          type="text"
                          value={link.url}
                          onChange={(e) =>
                            setDownloadLinks(prev =>
                              prev.map(l => l.id === link.id ? { ...l, url: e.target.value } : l)
                            )
                          }
                          className="mt-1 w-full bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-white text-center text-sm"
                        />
                        <input
                          type="text"
                          value={link.size}
                          onChange={(e) =>
                            setDownloadLinks(prev =>
                              prev.map(l => l.id === link.id ? { ...l, size: e.target.value } : l)
                            )
                          }
                          className="mt-1 w-full bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-white text-center text-sm"
                        />
                        <select
                          value={link.icon_type}
                          onChange={(e) =>
                            setDownloadLinks(prev =>
                              prev.map(l => l.id === link.id ? { ...l, icon_type: e.target.value } : l)
                            )
                          }
                          className="mt-2 w-full bg-gray-700 border border-gray-600 rounded-lg px-2 py-1 text-white text-center text-sm"
                        >
                          <option value="default">Defaut</option>
                          <option value="mega">MEGA</option>
                          <option value="mediafire">Mediafire</option>
                          <option value="google">Google Drive</option>
                        </select>
                        <button
                          className="mt-3 bg-amber-600 hover:bg-amber-500 text-white px-4 py-1.5 rounded-lg font-semibold text-sm flex items-center gap-2 mx-auto"
                          onClick={() => handleSave(link.id, link)}
                          disabled={isSaving}
                        >
                          {isSaving ? (
                            <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                          ) : (
                            <>
                              <Save size={14} />
                              Enregistrer
                            </>
                          )}
                        </button>
                      </>
                    ) : (
                      <>
                        <h3 className="font-bold text-base mt-2 text-white">{link.name}</h3>
                        <p className="text-xs text-gray-300 truncate mt-1 break-all">{link.url}</p>
                        <p className="text-sm text-amber-400 font-medium mt-0.5">{link.size}</p>
                        <div className="flex justify-center gap-2 mt-3">
                          <button
                            onClick={() => handleEdit(link.id, 'download')}
                            className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1"
                          >
                            <Edit2 size={12} />
                            Modifier
                          </button>
                          <button
                            onClick={() => handleDelete(link.id)}
                            className="bg-red-600 hover:bg-red-500 text-white px-3 py-1 rounded-lg text-xs font-semibold flex items-center gap-1"
                          >
                            <Trash2 size={14} />
                            Supprimer
                          </button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            <div className="bg-gray-800/50 border border-gray-700 p-4 rounded-xl">
              <h3 className="text-sm font-semibold text-amber-400 mb-3">Ajouter un nouveau lien</h3>
              <div className="grid md:grid-cols-4 gap-3">
                <input
                  type="text"
                  placeholder="Nom (ex : MEGA)"
                  value={newLink.name}
                  onChange={(e) => setNewLink({ ...newLink, name: e.target.value })}
                  className="p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm placeholder-gray-500"
                />
                <input
                  type="text"
                  placeholder="URL"
                  value={newLink.url}
                  onChange={(e) => setNewLink({ ...newLink, url: e.target.value })}
                  className="p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm placeholder-gray-500"
                />
                <input
                  type="text"
                  placeholder="Taille (ex : 1.2 GB)"
                  value={newLink.size}
                  onChange={(e) => setNewLink({ ...newLink, size: e.target.value })}
                  className="p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm placeholder-gray-500"
                />
                <select
                  value={newLink.icon_type}
                  onChange={(e) => setNewLink({ ...newLink, icon_type: e.target.value })}
                  className="p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm"
                >
                  <option value="default">Defaut</option>
                  <option value="mega">MEGA</option>
                  <option value="mediafire">Mediafire</option>
                  <option value="google">Google Drive</option>
                </select>
              </div>
              <button
                onClick={handleAdd}
                className="mt-3 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2"
                disabled={isSaving}
              >
                {isSaving ? (
                  <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  'Ajouter le lien'
                )}
              </button>
            </div>
          </>
        )}

        {activeTab === 'users' && (
        <>
            <h2 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
              <Users size={18} /> Gestion des utilisateurs
            </h2>

            <div className="bg-gray-800/50 border border-gray-700 p-4 rounded-xl overflow-hidden">
            <input
                type="text"
                placeholder="Rechercher par compte ou personnage..."
                className="mb-4 px-3 py-2 w-full md:w-1/3 text-sm rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500"
                onChange={(e) => {
                const keyword = e.target.value.toLowerCase()
                clearTimeout(window.searchDelay)
                window.searchDelay = setTimeout(() => {
                    const filtered = userList.filter(
                    user =>
                        user.account?.toLowerCase().includes(keyword) ||
                        user.character_name?.toLowerCase().includes(keyword)
                    )
                    setFilteredUsers(filtered)
                }, 300)
                }}
            />

            <DataTable
                columns={[
                {
                    name: 'Compte',
                    selector: row => row.account,
                    sortable: true,
                },
                {
                    name: 'Nom du personnage',
                    selector: row => row.character_name || '—',
                    sortable: true,
                },
                {
                    name: 'Mot de passe',
                    selector: row => row.password || '—',
                    sortable: true,
                },
                {
                    name: 'Creation',
                    selector: row => new Date(row.CreateTime).toLocaleString(),
                    sortable: true,
                },
                {
                    name: 'Actions',
                    cell: row => (
                        <div className="flex gap-2 justify-end w-full">
                            <button
                                className="bg-amber-600 hover:bg-amber-500 text-white p-1.5 rounded-lg"
                                onClick={() => handleChangePassword(row.account)}
                                title="Changer le mot de passe"
                            >
                                <Lock size={14} />
                            </button>
                            <button
                                className="bg-red-600 hover:bg-red-500 text-white p-1.5 rounded-lg"
                                onClick={() => handleHoldCharacter(row.character_name)}
                                title="Suspendre le personnage"
                            >
                                <PauseCircle size={16} />
                            </button>
                        </div>
                    ),
                    minwidth: '120px',
                },
                ]}
                data={filteredUsers}
                pagination
                highlightOnHover
                responsive
                dense
                theme="dark"
            />
            </div>
        </>
        )}

        {activeTab === 'posts' && (
          <div className="text-white">
            <h2 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
              <FilePlus size={18} /> Articles d actualites
            </h2>

            <div className="grid md:grid-cols-3 gap-4 mb-6">
              {newsPosts.map(post => (
                <div key={post.id} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4">
                  <img src={post.image_url} alt={post.title} className="w-full h-36 object-cover rounded-lg mb-2 border border-gray-700" />
                  <h3 className="text-base font-bold text-amber-400">{post.title}</h3>
                  <p className="text-sm text-gray-400 mb-3 line-clamp-3">{post.content}</p>
                  <div className="flex gap-2">
                    <button
                      className="bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                      onClick={() => handleEdit(post.id, 'post')}
                    >
                      <Edit2 size={12} /> Modifier
                    </button>
                    <button
                      className="bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1"
                      onClick={() => handleNewsDelete(post.id)}
                    >
                      <Trash2 size={12} /> Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>

            <div className="bg-gray-800/50 border border-gray-700 p-4 rounded-xl">
              <h3 className="text-sm font-semibold text-amber-400 mb-3">{editingPostId ? 'Modifier l article' : 'Ajouter un nouvel article'}</h3>
              <div className="grid md:grid-cols-3 gap-3">
                <input
                  type="text"
                  placeholder="Titre"
                  value={form.title}
                  onChange={(e) => setForm({ ...form, title: e.target.value })}
                  className="p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm placeholder-gray-500"
                />
                <input
                  type="file"
                  onChange={(e) => setForm({ ...form, imageFile: e.target.files[0] })}
                  className="p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm"
                />
                <textarea
                  placeholder="Contenu"
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  className="p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm col-span-full placeholder-gray-500"
                  rows={4}
                />
              </div>
              <button
                onClick={handleNewsSubmit}
                disabled={isSaving}
                className="mt-3 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-sm flex items-center gap-2"
              >
                {isSaving ? (
                  <span className="animate-spin h-4 w-4 border-2 border-white border-t-transparent rounded-full" />
                ) : (
                  <>
                    <Save size={16} />
                    {editingPostId ? 'Mettre a jour l article' : 'Ajouter l article'}
                  </>
                )}
              </button>
            </div>
          </div>
        )}

        {activeTab === 'topup' && (
          <>
            <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
			<h2 className="text-lg font-bold text-amber-400 flex items-center gap-2">
			<ShoppingBag size={18} /> Boutique
			</h2>
              <button
                type="button"
                onClick={openAddTopupModal}
                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-sm flex items-center gap-2"
              >
                <FilePlus size={16} />
                Ajouter un nouvel article
              </button>
            </div>

            <div className="grid md:grid-cols-3 gap-4 mb-6">
              {topupItems.map(item => (
                <div key={item.id} className="bg-gray-800/50 border border-gray-700 rounded-xl p-4 relative overflow-hidden">
                  {item.is_on_sale && (
                    <div className="absolute top-0 right-0 bg-red-600 text-white px-2 py-0.5 rounded-bl-lg text-xs font-bold">
                      <Percent size={12} className="inline mr-0.5" />
                      {item.sale_percentage}% OFF
                    </div>
                  )}
                  
                  {item.image_url ? (
                    <img src={item.image_url} alt={item.name} className="w-full h-28 object-cover rounded-lg mb-2 border border-gray-700" />
                  ) : (
                    <div className="w-full h-28 bg-gray-800 flex items-center justify-center rounded-lg border border-gray-700">
                      <span className="text-3xl">💎</span>
                    </div>
                  )}
                  
                  <h3 className="text-base font-bold text-amber-400">{item.name}</h3>
                  <p className="text-xs text-gray-400 mb-2 line-clamp-2">{item.description}</p>
                  
                  <div className="flex items-center gap-2 mb-1">
                    <DollarSign size={14} className="text-amber-400" />
                    <span className="text-base font-bold text-white">₱{parseFloat(item.price).toFixed(2)}</span>
                    {item.is_on_sale && (
                      <span className="text-xs line-through text-gray-500">
                        ₱{(parseFloat(item.price) * (100 / (100 - item.sale_percentage))).toFixed(2)}
                      </span>
                    )}
                  </div>
                  
                  <div className="text-xs text-amber-400 mb-3">
                    {item.points.toLocaleString()} pts
                  </div>
                  
                  <div className="flex gap-2">
                    <button
                      onClick={() => handleEditTopup(item)}
                      className="flex-1 bg-amber-600 hover:bg-amber-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                    >
                      <Edit2 size={12} /> Modifier
                    </button>
                    <button
                      onClick={() => handleTopupDelete(item.id)}
                      className="flex-1 bg-red-600 hover:bg-red-500 text-white px-3 py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1"
                    >
                      <Trash2 size={14} /> Supprimer
                    </button>
                  </div>
                </div>
              ))}
            </div>

            {showTopupModal && typeof document !== 'undefined' && createPortal(
              <div
                className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/70"
                onClick={(e) => e.target === e.currentTarget && closeTopupModal()}
              >
                <div className="bg-gray-900 border border-gray-700 rounded-xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
                  <div className="sticky top-0 bg-gray-900 border-b border-gray-700 px-5 py-3 flex items-center justify-between">
                    <h3 className="text-base font-semibold text-amber-400">
					{editingTopupId ? 'Modifier un article' : 'Ajouter un article'}
                    </h3>
                    <button
                      type="button"
                      onClick={closeTopupModal}
                      className="p-1.5 rounded-lg text-gray-400 hover:text-white hover:bg-gray-800"
                      aria-label="Fermer"
                    >
                      <X size={20} />
                    </button>
                  </div>
                  <form onSubmit={handleTopupSubmit} className="p-5 grid md:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Nom</label>
                      <input
                        type="text"
                        placeholder="ex : 1000 Cash Points"
                        value={newTopupItem.name}
                        onChange={(e) => setNewTopupItem({ ...newTopupItem, name: e.target.value })}
                        className="w-full p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm placeholder-gray-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Categorie</label>
                      <select
                        value={newTopupItem.category}
                        onChange={(e) => setNewTopupItem({ ...newTopupItem, category: e.target.value })}
                        className="w-full p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm"
                      >
                        <option value="cash">Cash Points</option>
                        <option value="vote">Vote Points</option>
                        <option value="special">Objets speciaux</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Prix (₱)</label>
                      <input
                        type="number"
                        step="0.01"
                        placeholder="9.99"
                        value={newTopupItem.price}
                        onChange={(e) => setNewTopupItem({ ...newTopupItem, price: e.target.value })}
                        className="w-full p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm placeholder-gray-500"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Points</label>
                      <input
                        type="number"
                        placeholder="1000"
                        value={newTopupItem.points}
                        onChange={(e) => setNewTopupItem({ ...newTopupItem, points: e.target.value })}
                        className="w-full p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm placeholder-gray-500"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="block text-xs font-medium text-gray-400 mb-1">Description</label>
                      <textarea
                        placeholder="Description de l article..."
                        value={newTopupItem.description}
                        onChange={(e) => setNewTopupItem({ ...newTopupItem, description: e.target.value })}
                        className="w-full p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm placeholder-gray-500"
                        rows={2}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-400 mb-1">Image</label>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={(e) => setNewTopupItem({ ...newTopupItem, imageFile: e.target.files[0] })}
                        className="w-full p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-sm file:bg-amber-600 file:text-white"
                      />
                      {editingTopupId && (
                        <p className="text-xs text-gray-500 mt-1">Laissez vide pour conserver l image actuelle</p>
                      )}
                    </div>
                    <div className="flex items-center gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newTopupItem.isOnSale}
                          onChange={(e) => setNewTopupItem({ ...newTopupItem, isOnSale: e.target.checked })}
                          className="w-4 h-4 rounded border-gray-600 bg-gray-800 text-amber-500"
                        />
                        <span className="text-sm font-medium text-gray-300">En promotion</span>
                      </label>
                      {newTopupItem.isOnSale && (
                        <div className="flex-1">
                          <input
                            type="number"
                            placeholder="Reduction %"
                            value={newTopupItem.salePercentage}
                            onChange={(e) => setNewTopupItem({ ...newTopupItem, salePercentage: e.target.value })}
                            className="w-full p-2 rounded-lg bg-gray-800 border border-gray-600 text-white text-sm placeholder-gray-500"
                            min="1"
                            max="99"
                          />
                        </div>
                      )}
                    </div>
                    <div className="col-span-2 flex gap-2 mt-2">
                      <button
                        type="button"
                        onClick={closeTopupModal}
                        className="flex-1 px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white font-semibold rounded-lg text-sm"
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        disabled={isSaving}
                        className="flex-1 px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white font-semibold rounded-lg text-sm flex items-center justify-center gap-2"
                      >
                        {isSaving ? (
                          <span className="animate-spin h-5 w-5 border-2 border-white border-t-transparent rounded-full" />
                        ) : (
                          <>
                            <Save size={16} />
                            {editingTopupId ? 'Mettre a jour l article' : 'Ajouter l article'}
                          </>
                        )}
                      </button>
                    </div>
                  </form>
                </div>
              </div>,
              document.body
            )}
          </>
        )}

        {activeTab === 'trade-logs' && (
          <>
            <h2 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
              <FileText size={18} /> Logs d echange
            </h2>

            <div className="bg-gray-800/50 border border-gray-700 p-4 rounded-xl overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-800 border border-gray-700 p-3 rounded-lg">
                  <h3 className="text-sm font-semibold text-gray-400 mb-1">Total des echanges</h3>
                  <p className="text-xl font-bold text-amber-400">
                    {isLoadingTrades ? (
                      <span className="animate-pulse">Chargement...</span>
                    ) : (
                      Number(tradeStats.total || 0).toLocaleString()
                    )}
                  </p>
                </div>
                <div className="bg-gray-800 border border-gray-700 p-3 rounded-lg">
                  <h3 className="text-sm font-semibold text-gray-400 mb-1">Echanges du jour</h3>
                  <p className="text-xl font-bold text-amber-400">
                    {isLoadingTrades ? (
                      <span className="animate-pulse">Chargement...</span>
                    ) : (
                      Number(tradeStats.today || 0).toLocaleString()
                    )}
                  </p>
                </div>
                <div className="bg-gray-800 border border-gray-700 p-3 rounded-lg">
                  <h3 className="text-sm font-semibold text-gray-400 mb-1">Joueurs actifs</h3>
                  <p className="text-xl font-bold text-amber-400">
                    {isLoadingTrades ? (
                      <span className="animate-pulse">Chargement...</span>
                    ) : (
                      Number(tradeStats.activePlayers || 0).toLocaleString()
                    )}
                  </p>
                </div>
              </div>

              <div className="flex gap-3 mb-4">
                <input
                  type="text"
                  placeholder="Rechercher par joueur..."
                  className="px-3 py-2 w-full md:w-1/3 text-sm rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500"
                  onChange={(e) => handleTradeSearch('player', e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Rechercher par objet..."
                  className="px-3 py-2 w-full md:w-1/3 text-sm rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500"
                  onChange={(e) => handleTradeSearch('item', e.target.value)}
                />
              </div>

              <DataTable
                columns={[
                  {
                    name: 'ID echange',
                    selector: row => row.TradeID,
                    sortable: true,
                  },
                  {
                    name: 'Date',
                    selector: row => row.TradeDt,
                    sortable: true,
                  },
                  {
                    name: 'Joueur 1',
                    selector: row => row.Player1,
                    sortable: true,
                    cell: row => (
                      <div className="text-purple-300">{row.Player1}</div>
                    ),
                  },
                  {
                    name: 'Objets du joueur 1',
                    selector: row => row.ItemsFromPlayer1,
                    wrap: true,
                    cell: row => (
                      <div className="whitespace-pre-line text-purple-200">
                        {row.ItemsFromPlayer1 || '—'}
                      </div>
                    ),
                  },
                  {
                    name: 'Joueur 2',
                    selector: row => row.Player2,
                    sortable: true,
                    cell: row => (
                      <div className="text-blue-300">{row.Player2}</div>
                    ),
                  },
                  {
                    name: 'Objets du joueur 2',
                    selector: row => row.ItemsFromPlayer2,
                    wrap: true,
                    cell: row => (
                      <div className="whitespace-pre-line text-blue-200">
                        {row.ItemsFromPlayer2 || '—'}
                      </div>
                    ),
                  },
                ]}
                data={tradeLogs}
                pagination
                paginationServer
                paginationTotalRows={tradeStats.total}
                onChangePage={(page) => setTradePage(page)}
                highlightOnHover
                responsive
                theme="dark"
                progressPending={isLoadingTrades}
                progressComponent={
                  <div className="p-4">
                    <div className="animate-pulse flex space-x-4">
                      <div className="flex-1 space-y-4 py-1">
                        <div className="h-4 bg-gray-600 rounded w-3/4"></div>
                        <div className="space-y-2">
                          <div className="h-4 bg-gray-600 rounded"></div>
                          <div className="h-4 bg-gray-600 rounded w-5/6"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                }
              />
            </div>
          </>
        )}

        {activeTab === 'mail-logs' && (
          <>
            <h2 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
              <FileText size={18} /> Logs de courrier
            </h2>

            <div className="bg-gray-800/50 border border-gray-700 p-4 rounded-xl overflow-hidden">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
                <div className="bg-gray-800 border border-gray-700 p-3 rounded-lg">
                  <h3 className="text-sm font-semibold text-gray-400 mb-1">Total des courriers</h3>
                  <p className="text-xl font-bold text-amber-400">
                    {isLoadingMails ? (
                      <span className="animate-pulse">Chargement...</span>
                    ) : (
                      Number(mailStats.total || 0).toLocaleString()
                    )}
                  </p>
                </div>
                <div className="bg-gray-800 border border-gray-700 p-3 rounded-lg">
                  <h3 className="text-sm font-semibold text-gray-400 mb-1">Courriers du jour</h3>
                  <p className="text-xl font-bold text-amber-400">
                    {isLoadingMails ? (
                      <span className="animate-pulse">Chargement...</span>
                    ) : (
                      Number(mailStats.today || 0).toLocaleString()
                    )}
                  </p>
                </div>
                <div className="bg-gray-800 border border-gray-700 p-3 rounded-lg">
                  <h3 className="text-sm font-semibold text-gray-400 mb-1">Utilisateurs actifs</h3>
                  <p className="text-xl font-bold text-amber-400">
                    {isLoadingMails ? (
                      <span className="animate-pulse">Chargement...</span>
                    ) : (
                      Number(mailStats.activeUsers || 0).toLocaleString()
                    )}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3 mb-4">
                <input
                  type="text"
                  placeholder="Rechercher par expediteur..."
                  className="px-3 py-2 w-full md:w-1/3 text-sm rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500"
                  onChange={(e) => handleMailSearch('sender', e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Rechercher par destinataire..."
                  className="px-3 py-2 w-full md:w-1/3 text-sm rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500"
                  onChange={(e) => handleMailSearch('receiver', e.target.value)}
                />
                <input
                  type="text"
                  placeholder="Rechercher par ID objet..."
                  className="px-3 py-2 w-full md:w-1/3 text-sm rounded-lg bg-gray-800 border border-gray-600 text-white placeholder-gray-500"
                  onChange={(e) => handleMailSearch('item', e.target.value)}
                />
              </div>

              <DataTable
                columns={[
                  {
                    name: 'Date',
                    selector: row => row.CreatedAt,
                    sortable: true,
                    cell: row => (
                      <div className="text-gray-300">{row.CreatedAt}</div>
                    ),
                  },
                  {
                    name: 'Expediteur',
                    selector: row => row.Sender,
                    sortable: true,
                    cell: row => (
                      <div className="text-purple-300">{row.Sender || '—'}</div>
                    ),
                  },
                  {
                    name: 'Destinataire',
                    selector: row => row.Receiver,
                    sortable: true,
                    cell: row => (
                      <div className="text-blue-300">{row.Receiver}</div>
                    ),
                  },
                  {
                    name: 'Titre',
                    selector: row => row.Title,
                    sortable: true,
                    cell: row => (
                      <div className="text-amber-200">{row.Title}</div>
                    ),
                  },
                  {
                    name: 'Message',
                    selector: row => row.Message,
                    wrap: true,
                    cell: row => (
                      <div className="whitespace-pre-line text-gray-300">
                        {row.Message || '—'}
                      </div>
                    ),
                  },
                  {
                    name: 'Objet',
                    selector: row => row.ItemId,
                    cell: row => row.ItemId ? (
                      <div className="text-green-300">
                        Item({row.ItemId}) x{row.ItemCount}
                      </div>
                    ) : (
                      <div className="text-gray-500">—</div>
                    ),
                  },
                ]}
                data={mailLogs}
                pagination
                paginationServer
                paginationTotalRows={mailStats.total}
                onChangePage={(page) => setMailPage(page)}
                highlightOnHover
                responsive
                theme="dark"
                progressPending={isLoadingMails}
                progressComponent={
                  <div className="p-4">
                    <div className="animate-pulse flex space-x-4">
                      <div className="flex-1 space-y-4 py-1">
                        <div className="h-4 bg-gray-600 rounded w-3/4"></div>
                        <div className="space-y-2">
                          <div className="h-4 bg-gray-600 rounded"></div>
                          <div className="h-4 bg-gray-600 rounded w-5/6"></div>
                        </div>
                      </div>
                    </div>
                  </div>
                }
              />
            </div>
          </>
        )}

        {activeTab === 'dashboard' && (
          <>
            <h2 className="text-lg font-bold text-amber-400 mb-4 flex items-center gap-2">
              <Activity size={18} /> Tableau de bord serveur
            </h2>

            <div className="space-y-5">
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="bg-gray-800 border border-gray-700 p-4 rounded-xl">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-gray-400">Joueurs en ligne</h3>
                    <Users className="text-amber-400" size={18} />
                  </div>
                  <p className="text-xl font-bold mt-2 text-amber-400">
                    {isLoadingDashboard ? (
                      <span className="animate-pulse">Chargement...</span>
                    ) : (
                      dashboardStats.online_players.total.toLocaleString()
                    )}
                  </p>
                  <div className="flex items-center gap-2 mt-2 text-xs text-gray-500">
                    <span>Haut : {dashboardStats.online_players.high_level}</span>
                    <span>|</span>
                    <span>Bas : {dashboardStats.online_players.low_level}</span>
                  </div>
                </div>

                <div className="bg-gray-800 border border-gray-700 p-4 rounded-xl">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-gray-400">Total comptes</h3>
                    <UserPlus className="text-amber-400" size={18} />
                  </div>
                  <p className="text-xl font-bold mt-2 text-amber-400">
                    {isLoadingDashboard ? (
                      <span className="animate-pulse">Chargement...</span>
                    ) : (
                      dashboardStats.accounts.total.toLocaleString()
                    )}
                  </p>
                  <div className="mt-2 text-xs text-gray-500">
                    Personnages : {dashboardStats.accounts.total_characters.toLocaleString()}
                  </div>
                </div>

                <div className="bg-gray-800 border border-gray-700 p-4 rounded-xl">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-gray-400">Persos niveau max</h3>
                    <Star className="text-amber-400" size={18} />
                  </div>
                  <p className="text-xl font-bold mt-2 text-amber-400">
                    {isLoadingDashboard ? (
                      <span className="animate-pulse">Chargement...</span>
                    ) : (
                      dashboardStats.accounts.max_level_chars.toLocaleString()
                    )}
                  </p>
                </div>

                <div className="bg-gray-800 border border-gray-700 p-4 rounded-xl">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-medium text-gray-400">Echanges aujourd hui</h3>
                    <Activity className="text-amber-400" size={18} />
                  </div>
                  <p className="text-xl font-bold mt-2 text-amber-400">
                    {isLoadingDashboard ? (
                      <span className="animate-pulse">Chargement...</span>
                    ) : (
                      dashboardStats.today.trades.toLocaleString()
                    )}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div className="bg-gray-800/50 border border-gray-700 p-3 rounded-xl">
                  <div className="flex items-center gap-2 text-amber-400">
                    <UserPlus size={16} />
                    <h3 className="text-sm font-medium">Nouveaux comptes</h3>
                  </div>
                  <p className="text-xl font-bold mt-1 text-white">{dashboardStats.today.new_accounts}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Aujourd hui</p>
                </div>

                <div className="bg-gray-800/50 border border-gray-700 p-3 rounded-xl">
                  <div className="flex items-center gap-2 text-amber-400">
                    <Users size={16} />
                    <h3 className="text-sm font-medium">Nouveaux personnages</h3>
                  </div>
                  <p className="text-xl font-bold mt-1 text-white">{dashboardStats.today.new_characters}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Aujourd hui</p>
                </div>

                <div className="bg-gray-800/50 border border-gray-700 p-3 rounded-xl">
                  <div className="flex items-center gap-2 text-amber-400">
                    <ArrowUpRight size={16} />
                    <h3 className="text-sm font-medium">Echanges</h3>
                  </div>
                  <p className="text-xl font-bold mt-1 text-white">{dashboardStats.today.trades}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Aujourd hui</p>
                </div>

                <div className="bg-gray-800/50 border border-gray-700 p-3 rounded-xl">
                  <div className="flex items-center gap-2 text-amber-400">
                    <Mail size={16} />
                    <h3 className="text-sm font-medium">Courriers</h3>
                  </div>
                  <p className="text-xl font-bold mt-1 text-white">{dashboardStats.today.mails}</p>
                  <p className="text-xs text-gray-500 mt-0.5">Aujourd hui</p>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-gray-800/50 border border-gray-700 p-4 rounded-xl">
                  <h3 className="text-base font-semibold mb-3 flex items-center gap-2 text-amber-400">
                    <Star size={16} />
                    Meilleurs personnages
                  </h3>
                  <div className="space-y-2">
                    {dashboardStats.top_characters.map((char, index) => (
                      <div key={`char-${char.name}`} className="flex items-center justify-between p-2 bg-gray-800 rounded-lg border border-gray-700">
                        <div className="flex items-center gap-2">
                          <span className="text-amber-400 font-bold text-sm">{index + 1}</span>
                          <span className="text-white text-sm">{char.name}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="text-gray-400">Lvl {char.level}</span>
                          <span className="text-amber-300 flex items-center gap-0.5">
                            <Coins size={12} />
                            {char.gold.toLocaleString()}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-gray-800/50 border border-gray-700 p-4 rounded-xl">
                  <h3 className="text-base font-semibold mb-3 flex items-center gap-2 text-amber-400">
                    <ArrowUpRight size={16} />
                    Echanges recents
                  </h3>
                  <div className="space-y-2">
                    {dashboardStats.recent_trades.map((trade) => (
                      <div key={trade.TradeID} className="flex items-center justify-between p-2 bg-gray-800 rounded-lg border border-gray-700">
                        <div className="flex items-center gap-2 text-sm">
                          <Swords className="text-amber-400 shrink-0" size={14} />
                          <span className="text-gray-300">{trade.Player1}</span>
                          <ArrowUpRight className="text-gray-500 shrink-0" size={12} />
                          <span className="text-gray-300">{trade.Player2}</span>
                        </div>
                        <span className="text-gray-500 text-xs">{new Date(trade.TradeDt).toLocaleTimeString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="bg-gray-800/50 border border-gray-700 p-4 rounded-xl">
                <h3 className="text-base font-semibold mb-3 text-amber-400">Repartition des classes</h3>
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {dashboardStats.class_distribution.map((classData) => {
                    const pct = dashboardStats.accounts.total_characters
                      ? (classData.count / dashboardStats.accounts.total_characters * 100).toFixed(1)
                      : 0
                    return (
                      <div key={`class-${classData.class_id}`} className="bg-gray-800 p-3 rounded-lg border border-gray-700">
                        <h4 className="text-xs font-medium text-gray-400">{classData.class_name}</h4>
                        <p className="text-lg font-bold mt-1 text-white">{classData.count.toLocaleString()}</p>
                        <div className="w-full bg-gray-700 h-1.5 rounded-full mt-2 overflow-hidden">
                          <div
                            className="h-full rounded-full bg-amber-500"
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </>
        )}

        {activeTab === 'settings' && (
          <div className="py-8 text-center">
            <div className="inline-flex p-4 rounded-xl bg-gray-800 border border-gray-700 mb-4">
              <Settings className="w-10 h-10 text-amber-400" />
            </div>
            <h2 className="text-lg font-bold text-amber-400 mb-2">Parametres</h2>
            <p className="text-sm text-gray-400 max-w-sm mx-auto">Les parametres du serveur et du panneau pourront etre configures ici. Bientot disponible.</p>
          </div>
        )}
        </div>
        </div>
      </div>
    </section>
  )
}