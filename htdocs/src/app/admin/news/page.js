'use client'
import Link from 'next/link'
import { Plus, Pencil, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

export default function NewsPage() {
  const [news, setNews] = useState([])
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [editing, setEditing] = useState(null)

  const fetchNews = async () => {
    const res = await fetch('/api/news')
    const data = await res.json()
    setNews(data)
  }

  useEffect(() => {
    fetchNews()
  }, [])

  const handleSubmit = async () => {
    const res = await fetch(`/api/news${editing ? `/${editing.id}` : ''}`, {
      method: editing ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, content })
    })
    await res.json()
    setTitle('')
    setContent('')
    setEditing(null)
    fetchNews()
  }

  const handleEdit = (item) => {
    setTitle(item.title)
    setContent(item.content)
    setEditing(item)
  }

  const handleDelete = async (id) => {
    await fetch(`/api/news/${id}`, { method: 'DELETE' })
    fetchNews()
  }

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold text-yellow-400">📰 Gestion des actualites</h1>

      <div className="space-y-2">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Titre de l actualite"
          className="w-full px-4 py-2 rounded bg-gray-100 text-black"
        />
        <textarea
          value={content}
          onChange={(e) => setContent(e.target.value)}
          placeholder="Contenu de l actualite"
          rows={6}
          className="w-full px-4 py-2 rounded bg-gray-100 text-black"
        />
        <button
          onClick={handleSubmit}
          className="bg-yellow-500 hover:bg-yellow-600 text-black font-semibold px-6 py-2 rounded"
        >
          {editing ? 'Mettre a jour' : 'Ajouter'} l actualite
        </button>
      </div>

      <hr className="border-gray-600 my-6" />

      <div className="space-y-4">
        {news.map((item) => (
          <div key={item.id} className="bg-[#121f33] p-4 rounded-md shadow flex justify-between items-start">
            <div>
              <h2 className="text-lg font-bold text-yellow-300">{item.title}</h2>
              <p className="text-sm text-gray-300 whitespace-pre-line mt-2">{item.content}</p>
              <p className="text-xs text-gray-400 mt-1">📅 {new Date(item.created_at).toLocaleDateString()}</p>
            </div>
            <div className="flex gap-2">
              <button onClick={() => handleEdit(item)} className="text-blue-400 hover:text-blue-600">
                <Pencil size={18} />
              </button>
              <button onClick={() => handleDelete(item.id)} className="text-red-400 hover:text-red-600">
                <Trash2 size={18} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}