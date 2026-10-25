'use client'

import { useState } from 'react'
import { Calendar, Clock, User, ArrowRight, Star, Trophy, Gift, Users } from 'lucide-react'

export default function News() {
  const [activeTab, setActiveTab] = useState('news')

  const newsItems = [
    {
      id: 1,
      type: 'news',
      title: 'Evenement d ouverture de Reborn-MMO',
      excerpt: 'Rejoignez-nous pour le lancement officiel de Reborn-MMO ! Des recompenses speciales, des evenements et des celebrations attendent tous les joueurs.',
      content: 'Le tres attendu Reborn-MMO est enfin la ! Nous avons travaille sans relache pour vous offrir l experience FlyFF ultime avec des graphismes ameliores, un gameplay equilibre et une communaute active. Pour celebrer cette occasion, nous organisons un evenement de lancement avec des recompenses exclusives, des donjons speciaux et des prix incroyables pour tous les participants.',
      date: '2025-01-15',
      author: 'Equipe Reborn-MMO',
      category: 'Evenement',
      image: '/promo1.png',
      featured: true
    },
    {
      id: 2,
      type: 'news',
      title: 'Nouveau donjon personnalise : Shadow Realm',
      excerpt: 'Explorez le mysterieus donjon Shadow Realm avec des boss uniques et un butin exclusif.',
      content: 'Aventurez-vous dans les profondeurs du Shadow Realm, un tout nouveau donjon personnalise concu exclusivement pour Reborn-MMO. Affrontez des boss redoutables, resoudre des enigmes complexes et recuperez des recompenses exclusives uniquement disponibles dans ce royaume mysterieux. Le donjon propose des mecaniques uniques et demande un vrai travail d equipe pour etre termine.',
      date: '2025-01-10',
      author: 'Game Master',
      category: 'Mise a jour',
      image: '/promo2.png',
      featured: false
    },
    {
      id: 3,
      type: 'news',
      title: 'Mise a jour d equilibrage PvP disponible',
      excerpt: 'D importants ajustements d equilibrage ont ete appliques pour garantir un PvP juste et competitif.',
      content: 'Nous avons applique des changements complets d equilibrage afin que toutes les classes aient une vraie chance en PvP. Cette mise a jour comprend des ajustements de competences, un reequilibrage des degats et de nouvelles mecaniques favorisant un gameplay strategique tout en conservant l intensite des combats entre joueurs.',
      date: '2025-01-08',
      author: 'Equipe equilibrage',
      category: 'Mise a jour',
      image: '/promo3.png',
      featured: false
    },
    {
      id: 4,
      type: 'event',
      title: 'Championnat Guild Wars',
      excerpt: 'Participez au tournoi ultime de guilde contre guilde avec des recompenses enormes.',
      content: 'Le championnat Guild Wars est arrive ! Formez votre meilleure guilde et affrontez les autres equipes dans des batailles epiques pour le controle des territoires et des recompenses massives. Le tournoi comprend plusieurs manches, des regles speciales et des prix exclusifs pour la guilde gagnante.',
      date: '2025-01-20',
      author: 'Equipe evenement',
      category: 'Tournoi',
      image: '/promo4.png',
      featured: true
    },
    {
      id: 5,
      type: 'event',
      title: 'Week-end double EXP',
      excerpt: 'Profitez de taux d experience doubles pendant cet evenement special du week-end.',
      content: 'Montez de niveau plus vite avec notre evenement Week-end double EXP ! Tous les joueurs recevront une experience double sur les monstres, quetes et activites. Ideal pour les nouveaux joueurs qui veulent rattraper leur retard ou les veterans qui veulent aller encore plus loin.',
      date: '2025-01-25',
      author: 'Equipe evenement',
      category: 'Evenement',
      image: '/promo5.png',
      featured: false
    },
    {
      id: 6,
      type: 'update',
      title: 'Nouvelles competences de classes ajoutees',
      excerpt: 'Chaque classe recoit de nouvelles competences et capacites puissantes.',
      content: 'Nous avons ajoute de nouvelles competences pour toutes les classes afin d enrichir le gameplay et d offrir plus d options strategiques. Chaque classe dispose maintenant de nouvelles capacites uniques qui renforcent son style de jeu et son role dans le jeu.',
      date: '2025-01-05',
      author: 'Equipe de developpement',
      category: 'Mise a jour',
      image: '/promo6.png',
      featured: false
    }
  ]

  const getCategoryIcon = (category) => {
    switch (category) {
      case 'Evenement': return <Gift className="w-4 h-4" />
      case 'Tournoi': return <Trophy className="w-4 h-4" />
      case 'Mise a jour': return <Star className="w-4 h-4" />
      default: return <Calendar className="w-4 h-4" />
    }
  }

  const getCategoryColor = (category) => {
    switch (category) {
      case 'Evenement': return 'text-dreamer-gold'
      case 'Tournoi': return 'text-red-400'
      case 'Mise a jour': return 'text-dreamer-blue'
      default: return 'text-gray-400'
    }
  }

  const filteredNews = newsItems.filter(item => 
    activeTab === 'all' ? true : item.type === activeTab
  )

  return (
    <section className="py-20 bg-gradient-to-b from-gray-900 to-black">
      <div className="max-w-7xl mx-auto px-6">
        <div className="text-center mb-16">
          <h2 className="text-4xl md:text-5xl font-bold text-dreamer-blue mb-4">
            Dernieres actualites et evenements
          </h2>
          <p className="text-xl text-gray-300 max-w-3xl mx-auto">
            Restez informe des dernieres actualites, evenements et mises a jour de Reborn-MMO.
            Ne manquez aucune annonce importante ni aucun evenement passionnant.
          </p>
        </div>

        <div className="flex justify-center mb-12">
          <div className="bg-black/40 backdrop-blur-sm border border-blue-500/20 rounded-xl p-2">
            {[
              { id: 'all', label: 'Tout', icon: <Users className="w-4 h-4" /> },
              { id: 'news', label: 'Actualites', icon: <Calendar className="w-4 h-4" /> },
              { id: 'event', label: 'Evenements', icon: <Gift className="w-4 h-4" /> },
              { id: 'update', label: 'Mises a jour', icon: <Star className="w-4 h-4" /> }
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-6 py-3 rounded-lg transition-all duration-300 ${
                  activeTab === tab.id
                    ? 'bg-gradient-to-r from-blue-500 to-cyan-500 text-white'
                    : 'text-gray-300 hover:text-white hover:bg-blue-500/20'
                }`}
              >
                {tab.icon}
                {tab.label}
              </button>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {filteredNews.map((item) => (
            <article key={item.id} className="group relative">
              <div className="bg-black/40 backdrop-blur-sm border border-blue-500/20 rounded-xl overflow-hidden hover:border-blue-500/40 transition-all duration-300 hover:transform hover:scale-105">
                {item.featured && (
                  <div className="absolute top-4 left-4 z-10">
                    <div className="bg-gradient-to-r from-yellow-500 to-orange-500 text-black px-3 py-1 rounded-full text-xs font-bold flex items-center gap-1">
                      <Star className="w-3 h-3" />
                      A la une
                    </div>
                  </div>
                )}

                <div className="relative h-48 overflow-hidden">
                  <img
                    src={item.image}
                    alt={item.title}
                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent"></div>
                </div>

                <div className="p-6">
                  <div className="flex items-center gap-2 mb-3">
                    <div className={`${getCategoryColor(item.category)}`}>
                      {getCategoryIcon(item.category)}
                    </div>
                    <span className={`text-sm font-semibold ${getCategoryColor(item.category)}`}>
                      {item.category}
                    </span>
                  </div>

                  <h3 className="text-xl font-bold text-dreamer-blue mb-3 group-hover:text-dreamer-gold transition-colors duration-300">
                    {item.title}
                  </h3>

                  <p className="text-gray-300 mb-4 leading-relaxed">
                    {item.excerpt}
                  </p>

                  <div className="flex items-center justify-between text-sm text-gray-400 mb-4">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4" />
                      {new Date(item.date).toLocaleDateString()}
                    </div>
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4" />
                      {item.author}
                    </div>
                  </div>

                  <button className="flex items-center gap-2 text-dreamer-blue hover:text-dreamer-gold transition-colors duration-300 group">
                    <span className="font-semibold">Lire la suite</span>
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform duration-300" />
                  </button>
                </div>
              </div>
            </article>
          ))}
        </div>

        <div className="text-center mt-12">
          <button className="btn-dreamer-primary px-8 py-4 font-bold rounded-xl text-white flex items-center gap-3 text-lg mx-auto">
            <Calendar className="w-6 h-6" />
            Voir toutes les actualites et evenements
          </button>
        </div>
      </div>
    </section>
  )
}