'use client'

import { useState } from 'react'
import { Swords, Shield, Wand2, Footprints, Quote } from 'lucide-react'

const ACCENT_COLORS = {
  'blue-500': '#3b82f6',
  'red-500': '#ef4444',
  'green-500': '#22c55e',
  'amber-500': '#f59e0b',
  'purple-500': '#a855f7',
  'indigo-500': '#6366f1',
  'slate-500': '#64748b',
  'pink-500': '#ec4899',
}

const ROLE_TIPS = {
  Tank: 'Nas masmorras do FlyFF e no Guild Siege, o tank segura o aggro e aguenta o dano para o grupo farmar em segurança. Indispensável para jogar em equipe em Madrigal.',
  DPS: 'Dano altíssimo em alvo único e burst para PvP e chefes. Muito popular para upar solo e nas guild wars dos servidores privados.',
  'DPS à distância': 'Kita os monstros e farma à distância em Madrigal. Muito eficiente no PvP e nas masmorras sem pegar aggro corpo a corpo.',
  Suporte: 'As curas e buffs tornam esta classe indispensável para upar em grupo e nas masmorras. Os Ringmasters são a base de qualquer party no FlyFF.',
  'DPS mágico': 'Excelente para farm em área (AoE) e limpar masmorras. Elementors e Psykeepers brilham limpando mobs e ganhando EXP e Penya rápido no FlyFF.',
  'Híbrido': 'O Billposter pode tankar, buffar e causar dano, ideal para grupos pequenos e estilos de jogo versáteis em Madrigal.',
}

export default function Classes() {
  const [activeClass, setActiveClass] = useState(0)

  const flyffClasses = [
    { id: 'Knight', name: 'Knight', icon: '⚔️', role: 'Tank', longDescription: 'No FlyFF, o Knight é uma das segundas classes voltadas para a defesa. Ele tanka masmorras e o Guild Siege em Madrigal, usando escudo e armadura pesada para proteger o grupo durante o farm em área e o PvP. Essencial para jogar em equipe e para o conteúdo de endgame.', stats: { attack: 85, defense: 95, magic: 30, speed: 60 }, skills: ['Shield Block', 'Taunt', 'Guardian', 'Iron Will'], accent: 'blue-500' },
    { id: 'Blade', name: 'Blade', icon: '🗡️', role: 'DPS', longDescription: 'O Blade é uma segunda classe focada em duas armas e muito dano em burst. No FlyFF, ele se destaca upando solo, no PvP e contra chefes. A alta taxa de crítico e a velocidade fazem dele uma das classes DPS mais populares de Madrigal para farmar Penya e participar das guild wars.', stats: { attack: 95, defense: 70, magic: 40, speed: 90 }, skills: ['Backstab', 'Dual Wield', 'Shadow Step', 'Assassinate'], accent: 'red-500' },
    { id: 'ranger', name: 'Ranger', icon: '🏹', role: 'DPS à distância', longDescription: 'O Ranger é a segunda classe especializada em arco. No FlyFF, ele kita os monstros à distância, farma com segurança e traz um ótimo DPS nas masmorras e no PvP sem pegar aggro corpo a corpo. Uma escolha clássica para quem gosta de jogar à distância em Madrigal.', stats: { attack: 90, defense: 60, magic: 50, speed: 85 }, skills: ['Precise Shot', 'Multi Arrow', 'Eagle Eye', 'Rain of Arrows'], accent: 'green-500' },
    { id: 'Ringmaster', name: 'Ringmaster', icon: '💫', role: 'Suporte', longDescription: 'O Ringmaster é a segunda classe dedicada a curas e buffs. No FlyFF, ele é indispensável para upar em grupo, nas masmorras e no conteúdo de guilda, mantendo a party viva enquanto aumenta o EXP e o dano. É a espinha dorsal de qualquer party de verdade em Madrigal.', stats: { attack: 50, defense: 65, magic: 95, speed: 70 }, skills: ['Heal', 'Bless', 'Protection', 'Resurrection'], accent: 'amber-500' },
    { id: 'Elementor', name: 'Elementor', icon: '🔥', role: 'DPS mágico', longDescription: 'O Elementor é a segunda classe de mago que domina fogo, gelo e raio. No FlyFF, ele reina no farm em área e na limpeza de masmorras com magias poderosas, sendo uma ótima escolha para ganhar EXP e Penya rápido em Madrigal. Muito querido tanto solo quanto em grupo.', stats: { attack: 40, defense: 55, magic: 100, speed: 75 }, skills: ['Fireball', 'Ice Storm', 'Lightning Bolt', 'Meteor'], accent: 'purple-500' },
    { id: 'Psykeeper', name: 'Psykeeper', icon: '🧠', role: 'DPS mágico', longDescription: 'O Psykeeper é uma segunda classe de mago que usa poderes psíquicos e mentais. No FlyFF, ele oferece uma jogabilidade única, com bons ataques em área, controle e ótimo burst. Um mago versátil para masmorras e PvP em Madrigal.', stats: { attack: 45, defense: 60, magic: 95, speed: 80 }, skills: ['Mind Control', 'Psychic Blast', 'Mental Shield', 'Reality Warp'], accent: 'indigo-500' },
    { id: 'Billposter', name: 'Billposter', icon: '🛡️', role: 'Híbrido', longDescription: 'O Billposter é uma segunda classe que mistura corpo a corpo, buffs e suporte. No FlyFF, ele pode tankar, buffar o grupo e causar um bom dano, perfeito para grupos pequenos e para quem quer um papel flexível em Madrigal sem escolher entre tank puro e suporte puro.', stats: { attack: 80, defense: 75, magic: 70, speed: 75 }, skills: ['Combat Buff', 'Shield Bash', 'Rally', 'Tactical Strike'], accent: 'slate-500' },
    { id: 'Jester', name: 'Jester', icon: '🎭', role: 'DPS', longDescription: 'O Jester é uma segunda classe conhecida pelos ioiôs e pelo estilo de jogo imprevisível. No FlyFF, ele traz muita mobilidade e um excelente burst de DPS, com uma jogabilidade única que brilha no PvP e solo. Uma escolha diferente para quem quer algo fora do comum em Madrigal.', stats: { attack: 85, defense: 65, magic: 60, speed: 90 }, skills: ['Trick Shot', 'Confusion', 'Jester Dance', 'Surprise Attack'], accent: 'pink-500' },
  ]

  const c = flyffClasses[activeClass]
  const accentHex = ACCENT_COLORS[c.accent]

  const statConfig = [
    { key: 'attack', label: 'ATQ', bar: 'bg-red-500', Icon: Swords },
    { key: 'defense', label: 'DEF', bar: 'bg-blue-500', Icon: Shield },
    { key: 'magic', label: 'MAG', bar: 'bg-purple-500', Icon: Wand2 },
    { key: 'speed', label: 'VEL', bar: 'bg-green-500', Icon: Footprints },
  ]

  return (
    <section className="py-14 bg-black">
      <div className="max-w-5xl mx-auto px-4">
        <header className="border-b border-gray-700 pb-3 mb-8">
          <h2 className="text-2xl font-bold text-white tracking-tight">Classes do FlyFF</h2>
          <p className="text-sm text-gray-500 mt-0.5">Segundas classes de Madrigal. Selecione uma para ver os atributos e as habilidades.</p>
        </header>

        <div className="grid grid-cols-8 gap-1.5 sm:gap-2 mb-8">
          {flyffClasses.map((cls, i) => (
            <button
              key={cls.id}
              onClick={() => setActiveClass(i)}
              className="flex flex-col items-center gap-1 px-1 py-2.5 rounded-lg border transition-colors min-w-0"
              style={{
                borderColor: activeClass === i ? accentHex : 'rgb(55 65 81)',
                backgroundColor: activeClass === i ? 'rgba(255,255,255,0.06)' : 'transparent',
              }}
            >
              <span className="text-lg sm:text-xl leading-none" aria-hidden>{cls.icon}</span>
              <span className={`text-[10px] sm:text-xs font-medium truncate w-full text-center ${activeClass === i ? 'text-white' : 'text-gray-400'}`}>{cls.name}</span>
            </button>
          ))}
        </div>

        <div className="space-y-6">
          <div
            className="flex items-center gap-4 py-4 px-5 rounded-lg border-l-4"
            style={{ borderLeftColor: accentHex, backgroundColor: 'rgb(17 24 39)' }}
          >
            <span className="text-4xl" aria-hidden>{c.icon}</span>
            <div className="flex-1 min-w-0">
              <h3 className="text-xl font-bold text-white">{c.name}</h3>
              <span
                className="inline-block mt-1 px-2 py-0.5 rounded text-xs font-medium text-white"
                style={{ backgroundColor: accentHex }}
              >
                {c.role}
              </span>
            </div>
          </div>

          <p className="text-gray-400 text-sm leading-relaxed">{c.longDescription}</p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {statConfig.map(({ key, label, bar, Icon }) => (
              <div key={key} className="bg-gray-900 border border-gray-700 rounded-lg p-3">
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs text-gray-500 uppercase tracking-wider">{label}</span>
                  <Icon className="w-3.5 h-3.5 text-gray-500" />
                </div>
                <div className="h-1.5 bg-gray-700 rounded-full overflow-hidden">
                  <div className={`h-full rounded-full ${bar}`} style={{ width: `${c.stats[key]}%` }} />
                </div>
                <p className="text-sm font-semibold text-white mt-1">{c.stats[key]}</p>
              </div>
            ))}
          </div>

          <div>
            <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Habilidades</p>
            <div className="flex flex-wrap gap-2">
              {c.skills.map((skill, i) => (
                <span key={i} className="px-3 py-1.5 rounded-md bg-gray-800 border border-gray-600 text-sm text-gray-300">
                  {skill}
                </span>
              ))}
            </div>
          </div>

          <div className="flex gap-3 py-3 pl-4 border-l-2 border-amber-500/60 bg-gray-900/60 rounded-r-lg">
            <Quote className="w-4 h-4 text-amber-500/80 shrink-0 mt-0.5" />
            <p className="text-sm text-gray-400 italic">{ROLE_TIPS[c.role]}</p>
          </div>
        </div>
      </div>
    </section>
  )
}