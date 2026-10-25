export default function Events() {
  return (
    <section id="events" className="bg-[#101b2d] text-white py-24 px-6">
      <div className="max-w-7xl mx-auto">
        <h2 className="text-4xl font-bold mb-14 text-center animate-fade-in">Evenements a venir</h2>
        <div className="grid md:grid-cols-3 gap-8">
          {[
            {
              title: "Week-end double EXP",
              description: "Montez de niveau plus vite ce week-end ! Profitez du double EXP sur tous les monstres. Debut vendredi a 18h, heure serveur.",
              icon: "⚡"
            },
            {
              title: "Tournoi Guild Siege",
              description: "Testez la puissance de votre guilde dans notre tournoi de siege PvP. Recompenses pour les 3 meilleures guildes !",
              icon: "🏆"
            },
            {
              title: "Chasse au tresor",
              description: "Participez a l evenement et trouvez des coffres caches a travers Madrigal pour gagner des objets rares et bien plus encore.",
              icon: "🧭"
            }
          ].map((event, idx) => (
            <div
              key={idx}
              className="bg-gradient-to-br from-[#1b2b44] to-[#0e1a2b] p-6 rounded-xl shadow-lg hover:scale-105 transition-transform border border-white/10 animate-fade-in-up"
            >
              <div className="text-4xl mb-3 animate-bounce">{event.icon}</div>
              <h3 className="text-xl font-bold text-yellow-400 mb-2">{event.title}</h3>
              <p className="text-sm text-gray-300">{event.description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}