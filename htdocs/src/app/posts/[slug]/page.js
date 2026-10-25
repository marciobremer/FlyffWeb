import { notFound } from 'next/navigation'
import Image from 'next/image'
import Navbar from '@/components/Navbar'

export default async function NewsDetailPage({ params }) {
  const baseUrl = process.env.NEXT_PUBLIC_BASE_URL || ''
  const res = await fetch(`${baseUrl}/api/posts/${params.slug}`, {
    cache: 'no-store',
  })

  if (!res.ok) {
    notFound()
  }

  const post = await res.json()

  if (!post || !post.content) {
    notFound()
  }

  const paragraphs = post.content.trim().split('\n').filter(p => p.trim() !== '')

  return (
    <div
      className="min-h-screen bg-cover bg-center bg-no-repeat relative"
      style={{ backgroundImage: `url('/bg.png')` }}
    >
      <div className="absolute inset-0 bg-black/60 z-10 backdrop-blur-sm" />
      <Navbar />

      <div className="relative z-20 max-w-6xl mx-auto px-6 py-24">
        <div className="bg-black/70 border border-yellow-500/10 backdrop-blur-md p-8 rounded-xl shadow-2xl">
          <Image
            src={post.image_url}
            alt={post.title}
            width={1024}
            height={480}
            className="w-full max-h-[380px] object-cover rounded-lg mb-6"
          />
          <h1 className="text-4xl font-extrabold text-yellow-400 mb-3">{post.title}</h1>
          <p className="text-sm text-gray-400 mb-8 italic">
            📅 {new Date(post.created_at).toLocaleDateString()}
          </p>

          {paragraphs.map((p, i) => (
            <p key={i} className="text-lg text-white leading-relaxed mb-4 whitespace-pre-line">
              {p.trim()}
            </p>
          ))}
        </div>
      </div>
    </div>
  )
}