'use client'
import { Facebook, Youtube } from 'lucide-react'
import { FaDiscord, FaTiktok } from 'react-icons/fa6'

export default function SocialSidebar() {
  const iconStyle = 'w-5 h-5'

  const socialLinks = [
    {
      name: 'Facebook',
      href: 'https://facebook.com/',
      color: 'bg-blue-600',
      hover: 'hover:bg-blue-700',
      icon: <Facebook className={iconStyle} />,
    },
    {
      name: 'YouTube',
      href: 'https://youtube.com/',
      color: 'bg-red-600',
      hover: 'hover:bg-red-700',
      icon: <Youtube className={iconStyle} />,
    },
    {
      name: 'Discord',
      href: 'https://discord.gg/Qq4KManJSn',
      color: 'bg-indigo-600',
      hover: 'hover:bg-indigo-700',
      icon: <FaDiscord className={iconStyle} />,
    },
    {
      name: 'TikTok',
      href: 'https://www.tiktok.com/@yourpage',
      color: 'bg-black',
      hover: 'hover:bg-gray-800',
      icon: <FaTiktok className={iconStyle} />,
    },
  ]

  return (
    <>
      {/* Desktop Sidebar (Left) */}
      <div className="fixed top-1/3 left-4 z-50 flex-col gap-4 hidden sm:flex">
        {socialLinks.map((item, i) => (
          <a
            key={i}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            title={item.name}
            className={`${item.color} ${item.hover} text-white p-3 rounded-full shadow-lg transition transform hover:scale-110 hover:shadow-xl`}
          >
            {item.icon}
          </a>
        ))}
      </div>

      {/* Mobile Bar (Bottom-Left) */}
      <div className="fixed bottom-24 left-4 z-50 flex gap-4 sm:hidden bg-black/40 px-4 py-2 rounded-full backdrop-blur-md shadow-lg">
        {socialLinks.map((item, i) => (
          <a
            key={i}
            href={item.href}
            target="_blank"
            rel="noopener noreferrer"
            title={item.name}
            className={`${item.color} ${item.hover} text-white p-3 rounded-full shadow-md transition transform hover:scale-110`}
          >
            {item.icon}
          </a>
        ))}
      </div>
    </>
  )
}
