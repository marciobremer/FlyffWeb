'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'
import NProgress from 'nprogress'
import 'nprogress/nprogress.css'

NProgress.configure({ showSpinner: false, speed: 280, minimum: 0.08, trickleSpeed: 200 })

const REBORN_BAR_STYLES = `
  #nprogress .bar {
    background: linear-gradient(90deg, #b45309 0%, #f59e0b 50%, #fbbf24 100%) !important;
    height: 3px !important;
    box-shadow: 0 0 8px rgba(245, 158, 11, 0.5) !important;
  }
  #nprogress .peg {
    box-shadow: 0 0 10px #f59e0b, 0 0 5px #fbbf24 !important;
  }
  #nprogress .spinner-icon {
    border-top-color: #f59e0b !important;
    border-left-color: #f59e0b !important;
  }
`

export default function LoadingBar() {
  const pathname = usePathname()
  const startTimeoutRef = useRef(null)

  useEffect(() => {
    const handleClick = (e) => {
      const anchor = e.target.closest('a[href^="/"]')
      if (!anchor || anchor.target === '_blank' || anchor.getAttribute('href')?.startsWith('#')) return
      if (anchor.getAttribute('href') === pathname) return
      clearTimeout(startTimeoutRef.current)
      startTimeoutRef.current = setTimeout(() => NProgress.start(), 120)
    }

    document.addEventListener('click', handleClick, true)
    return () => {
      document.removeEventListener('click', handleClick, true)
      clearTimeout(startTimeoutRef.current)
    }
  }, [pathname])

  useEffect(() => {
    NProgress.done()
  }, [pathname])

  return (
    <>
      <style dangerouslySetInnerHTML={{ __html: REBORN_BAR_STYLES }} />
    </>
  )
}