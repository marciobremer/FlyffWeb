import './globals.css'
import { Geist, Geist_Mono } from 'next/font/google'
import ClientLayout from '../components/ClientLayout'

const geistSans = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })
const geistMono = Geist_Mono({ variable: '--font-geist-mono', subsets: ['latin'] })

export const metadata = {
  title: 'ReactioN MMO - Servidor privado de FlyFF',
  description: 'Entre no ReactioN MMO, um servidor privado de FlyFF de alta qualidade com PvP equilibrado, masmorras exclusivas, sistemas modernos e uma comunidade ativa. Jogue agora direto no navegador e reviva a magia de Madrigal!',
  keywords: [
    'Servidor Privado FlyFF',
    'ReactioN MMO',
    'MMORPG Grátis',
    'Jogar Flyff online',
    'Servidor Fly For Fun',
    'Cadastro ReactioN MMO',
    'Melhor servidor Flyff',
    'Servidor privado Flyff v15',
    'Recursos ReactioN MMO',
    'Servidor PvP Flyff'
  ],
  openGraph: {
    title: 'ReactioN MMO - Fly For Fun no navegador',
    description: 'Conheça o ReactioN MMO: eventos, batalhas PvP, as mecânicas clássicas da v15 e uma comunidade animada. Jogue direto no navegador!',
    url: 'https://www.rebornmmo.com',
    siteName: 'ReactioN MMO',
    images: [
      {
        url: 'https://www.rebornmmo.com/og-banner.jpg',
        width: 1200,
        height: 630,
        alt: 'Banner oficial ReactioN MMO',
      },
    ],
    locale: 'pt_BR',
    type: 'website',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'ReactioN MMO - Jogue agora!',
    description: 'Prepare-se para voar no ReactioN MMO. Jogue com seus amigos, ganhe recompensas e conquiste Madrigal.',
    site: '@RebornMMO',
    creator: '@RebornMMO',
    images: ['https://www.rebornmmo.com/twitter-card.jpg'],
  },
  metadataBase: new URL('https://www.rebornmmo.com'),
}

export default function RootLayout({ children }) {
  return (
    <html lang="pt-BR">
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-950 text-white`}>
        <ClientLayout>{children}</ClientLayout>
      </body>
    </html>
  )
}