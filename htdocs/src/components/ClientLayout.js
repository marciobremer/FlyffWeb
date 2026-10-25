'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Spinner from './Spinner'
import Navbar from './Navbar'
import SocialSidebar from './SocialSidebar'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'

export default function ClientLayout({ children }) {
  const [isReady, setIsReady] = useState(false)
  const pathname = usePathname()

  useEffect(() => {
    let cancelled = false

    const finishLoading = () => {
      if (!cancelled) {
        setIsReady(true)
      }
    }

    // Proteção contra carregamento infinito: mesmo se /logo.png faltar, demorar,
    // for bloqueado por cache/proxy ou der erro, o site continua.
    const fallbackTimer = setTimeout(finishLoading, 1200)

    const img = new Image()
    img.onload = () => {
      clearTimeout(fallbackTimer)
      finishLoading()
    }
    img.onerror = () => {
      clearTimeout(fallbackTimer)
      finishLoading()
    }
    img.src = '/logo.png'

    return () => {
      cancelled = true
      clearTimeout(fallbackTimer)
      img.onload = null
      img.onerror = null
    }
  }, [])

  if (!isReady) {
    return <Spinner />
  }

  return (
    <>
      <Navbar />
      {pathname !== '/profile' && 
      pathname !== '/transactions/gcash' && 
      pathname !== '/transactions/paypal' && 
      pathname !== '/transactions/votelogs' 
      }
      <ToastContainer position="top-center" theme="dark" autoClose={3000} />
      <main>{children}</main>
    </>
  )
}
