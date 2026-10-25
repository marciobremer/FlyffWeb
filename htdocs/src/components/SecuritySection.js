'use client'

import { useState } from 'react'
import { Lock } from 'lucide-react'

export default function SecuritySection() {
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')

  const handlePasswordUpdate = () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      alert('Tous les champs sont obligatoires.')
      return
    }

    if (newPassword !== confirmPassword) {
      alert('Le nouveau mot de passe et sa confirmation ne correspondent pas.')
      return
    }

    if (newPassword.length < 8) {
      alert('Le nouveau mot de passe doit contenir au moins 8 caracteres.')
      return
    }

    alert('Mot de passe mis a jour avec succes !')
    setCurrentPassword('')
    setNewPassword('')
    setConfirmPassword('')
  }

  return (
    <div className="w-full max-w-md mx-auto bg-[#0c0f1c] border border-white/5 rounded-xl p-6">
      <div className="flex items-center gap-2 mb-4">
        <Lock size={18} className="text-yellow-400" />
        <h2 className="text-white font-semibold text-md">Securite</h2>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-gray-300 mb-1">Mot de passe actuel</label>
          <input
            type="password"
            className="w-full px-3 py-2 rounded-md bg-[#1f2937] text-white placeholder-gray-400 border border-gray-600 focus:outline-none"
            placeholder="Entrez le mot de passe actuel"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">Nouveau mot de passe</label>
          <input
            type="password"
            className="w-full px-3 py-2 rounded-md bg-[#1f2937] text-white placeholder-gray-400 border border-gray-600 focus:outline-none"
            placeholder="Entrez le nouveau mot de passe"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm text-gray-300 mb-1">Confirmer le mot de passe</label>
          <input
            type="password"
            className="w-full px-3 py-2 rounded-md bg-[#1f2937] text-white placeholder-gray-400 border border-gray-600 focus:outline-none"
            placeholder="Confirmez le nouveau mot de passe"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        <button
          onClick={handlePasswordUpdate}
          className="w-full bg-gradient-to-r from-yellow-500 to-yellow-600 hover:from-yellow-600 hover:to-yellow-700 text-white font-semibold py-2 rounded-lg transition"
        >
          Mettre a jour le mot de passe
        </button>
      </div>
    </div>
  )
}