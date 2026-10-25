"use client";

import CommunitySection from "@/components/Classes";
import ParticlesBackground from "@/components/ParticlesBackground";
import Footer from "@/components/Footer";
import ServerStats from "@/components/ServerStats";
import {
  Play,
  Star,
  Shield,
  Zap,
  Users,
  Bot,
  Building2,
  Car,
  Hammer,
  Shield as ShieldIcon,
  Search,
  Users as UsersIcon,
  Palette,
  BookOpen,
  RotateCcw,
  ShoppingCart,
  Store,
  Database,
  Trophy,
  Zap as ZapIcon,
  Star as StarIcon,
  Crown as CrownIcon,
  Target as TargetIcon,
  Shield as ShieldIcon2,
  Map,
  Users2,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";

export default function HomePage() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    fetch("/api/me", { credentials: "include" })
      .then((res) => res.json())
      .then((data) => {
        if (data && data.email) setIsLoggedIn(true);
      });
  }, []);

  const flyffClasses = [
    { name: "Cavaleiro", icon: "⚔️", role: "Tank", description: "Mestre da defesa e da proteção" },
    { name: "Assassino", icon: "🗡️", role: "DPS", description: "Assassino rápido e mortal" },
    { name: "Ranger", icon: "🏹", role: "DPS à distância", description: "Arqueiro e caçador experiente" },
    { name: "Sacerdote", icon: "💫", role: "Suporte", description: "Curandeiro divino e buffer" },
    { name: "Elementor", icon: "🔥", role: "DPS mágico", description: "Mestre da magia elemental" },
    { name: "Psykeeper", icon: "🧠", role: "DPS mágico", description: "Manipulador da força psíquica" },
    { name: "Ringmaster", icon: "🛡️", role: "Híbrido", description: "Combatente e buffer equilibrado" },
    { name: "Jester", icon: "🎭", role: "DPS", description: "Combatente astuto e imprevisível" },
  ];

  const advancedFeatures = [
    { icon: <Bot className="w-6 h-6" />, title: "Farm com IA", description: "Farm automatizado em Azria para Penyas", category: "Automação" },
    { icon: <Building2 className="w-6 h-6" />, title: "Heaven Tower B5", description: "Farm de Red Chips na Heaven Tower", category: "Masmorra" },
    { icon: <Hammer className="w-6 h-6" />, title: "Fusão de armas", description: "Funda armas para criar equipamentos poderosos", category: "Criação" },
    { icon: <ShieldIcon className="w-6 h-6" />, title: "Auto-Invasion", description: "Sistema de invasão automática para guildas", category: "PvP" },
    { icon: <Search className="w-6 h-6" />, title: "Caça aos monstros", description: "Álbum de monstros e sistema de caça", category: "PvE" },
    { icon: <Star className="w-6 h-6" />, title: "Sistema VIP", description: "Vantagens exclusivas para membros VIP", category: "Premium" },
    { icon: <Map className="w-6 h-6" />, title: "Teleportador", description: "Sistema de teleporte instantâneo", category: "Utilidade" },
    { icon: <UsersIcon className="w-6 h-6" />, title: "Busca de guilda", description: "Encontre e entre em guildas com facilidade", category: "Social" },
    { icon: <Users2 className="w-6 h-6" />, title: "Busca de grupo", description: "Encontre grupos para masmorras e raids", category: "Social" },
    { icon: <Palette className="w-6 h-6" />, title: "Troca de aura do pet", description: "Personalize a aparência do seu pet", category: "Personalização" },
    { icon: <Sparkles className="w-6 h-6" />, title: "Troca de brilho", description: "Mude os efeitos de brilho de armas e armaduras", category: "Personalização" },
    { icon: <BookOpen className="w-6 h-6" />, title: "Missão diária", description: "Missões diárias com recompensas", category: "PvE" },
    { icon: <Database className="w-6 h-6" />, title: "Banco de dados de monstros", description: "Informações completas sobre os monstros", category: "Utilidade" },
    { icon: <RotateCcw className="w-6 h-6" />, title: "Sistema de reciclagem", description: "Recicle itens em troca de materiais", category: "Criação" },
    { icon: <ShoppingCart className="w-6 h-6" />, title: "Loja Cash/Voto", description: "Itens premium e recompensas de voto", category: "Loja" },
    { icon: <Store className="w-6 h-6" />, title: "Vendedor offline", description: "Sistema de venda offline 365 dias", category: "Economia" },
    { icon: <Trophy className="w-6 h-6" />, title: "FFA/TDM", description: "Modos todos contra todos e mata-mata em equipe", category: "PvP" },
    { icon: <ZapIcon className="w-6 h-6" />, title: "Sistema Anarchy", description: "Mecânicas de PvP avançadas", category: "PvP" },
    { icon: <StarIcon className="w-6 h-6" />, title: "Atributos supremos", description: "Atributos de personagem aprimorados", category: "Progressão" },
    { icon: <CrownIcon className="w-6 h-6" />, title: "Sistema de raridade", description: "Sistema de raridade e qualidade dos itens", category: "Progressão" },
    { icon: <TargetIcon className="w-6 h-6" />, title: "Mecânicas de chefes", description: "Mecânicas de combate contra chefes aprimoradas", category: "PvE" },
    { icon: <ShieldIcon2 className="w-6 h-6" />, title: "Buff de guilda", description: "Buffs e bônus para toda a guilda", category: "Guilda" },
  ];

  const getCategoryColor = (category) => {
    const map = {
      "Automação": "from-green-500 to-emerald-500",
      Masmorra: "from-purple-500 to-pink-500",
      "Personalização": "from-blue-500 to-cyan-500",
      "Criação": "from-yellow-500 to-orange-500",
      PvP: "from-red-500 to-pink-500",
      PvE: "from-green-500 to-teal-500",
      Premium: "from-yellow-500 to-amber-500",
      Utilidade: "from-gray-500 to-slate-500",
      Social: "from-indigo-500 to-purple-500",
      Loja: "from-emerald-500 to-green-500",
      Economia: "from-amber-500 to-yellow-500",
      "Progressão": "from-violet-500 to-purple-500",
      Guilda: "from-orange-500 to-red-500",
    };
    return map[category] || "from-blue-500 to-cyan-500";
  };

  return (
    <>
      {/* Hero - centralizado, minimalista; o fundo é a estrela */}
      <section id="home" className="relative w-full min-h-screen flex flex-col overflow-hidden text-white">
        <ParticlesBackground />
<video
  autoPlay
  muted
  loop
  playsInline
  preload="auto"
  poster="/bg.png"
  className="absolute inset-0 w-full h-full object-cover object-center z-0"
  aria-hidden="true"
>
  <source src="/bg.mp4" type="video/mp4" />
</video>
        {/* Só uma vinheta leve - o fundo continua visível */}
        <div className="absolute inset-0 z-[1] bg-[radial-gradient(ellipse_100%_80%_at_50%_50%,transparent_30%,rgba(0,0,0,0.4)_80%,rgba(0,0,0,0.7)_100%)]" aria-hidden />
        <div className="absolute inset-0 z-[1] bg-gradient-to-t from-black/60 via-transparent to-black/30 pointer-events-none" aria-hidden />

        <div className="relative z-10 flex-1 flex flex-col items-center justify-center px-4 py-12 min-h-screen">
          <div className="w-full max-w-2xl mx-auto flex flex-col items-center gap-5 text-center">
            {/* Logo com efeito de raio */}
            <div className="relative inline-flex items-center justify-center">
              {/* Aura elétrica azul forte */}
              <div
                className="absolute inset-0 -m-10 rounded-full pointer-events-none animate-logo-lightning-flash"
                style={{
                  background: "radial-gradient(ellipse 85% 75% at 50% 50%, rgba(0,212,255,0.6) 0%, rgba(0,220,255,0.35) 25%, rgba(0,200,255,0.15) 50%, transparent 70%)",
                  boxShadow: "0 0 80px rgba(0,212,255,0.5), 0 0 120px rgba(0,212,255,0.25), inset 0 0 60px rgba(0,212,255,0.15)",
                }}
                aria-hidden
              />
              {/* Raios diagonais */}
              <div className="absolute inset-0 -m-6 pointer-events-none overflow-visible" aria-hidden>
                <div className="absolute left-[5%] top-[20%] w-16 h-0.5 rotate-[-25deg] animate-lightning-bolt bg-gradient-to-r from-transparent via-[#00D4FF] to-transparent" style={{ boxShadow: "0 0 10px rgba(0,212,255,0.9), 0 0 20px rgba(0,212,255,0.5)" }} />
                <div className="absolute right-[5%] top-[25%] w-14 h-0.5 rotate-[28deg] animate-lightning-bolt bg-gradient-to-r from-transparent via-white to-transparent" style={{ boxShadow: "0 0 10px rgba(0,212,255,0.9), 0 0 20px rgba(0,212,255,0.5)", animationDelay: "0.5s" }} />
                <div className="absolute left-[15%] bottom-[15%] w-12 h-0.5 rotate-[-15deg] animate-lightning-strike bg-gradient-to-r from-transparent via-[#00D4FF] to-transparent" style={{ boxShadow: "0 0 12px rgba(0,212,255,0.9)", animationDelay: "0.3s" }} />
                <div className="absolute right-[12%] bottom-[18%] w-14 h-0.5 rotate-[18deg] animate-lightning-strike bg-gradient-to-r from-transparent via-[#00D4FF] to-transparent" style={{ boxShadow: "0 0 12px rgba(0,212,255,0.9)", animationDelay: "0.7s" }} />
              </div>
              {/* Raio horizontal - esquerda */}
              <div className="absolute left-0 top-1/2 -translate-y-1/2 w-16 h-0.5 -translate-x-3 pointer-events-none animate-lightning-bolt bg-gradient-to-r from-transparent via-white to-[#00D4FF] shadow-[0_0_12px_rgba(0,212,255,0.9),0_0_24px_rgba(0,212,255,0.5)]" aria-hidden />
              {/* Raio horizontal - direita */}
              <div className="absolute right-0 top-1/2 -translate-y-1/2 w-16 h-0.5 translate-x-3 pointer-events-none animate-lightning-bolt bg-gradient-to-l from-transparent via-white to-[#00D4FF] shadow-[0_0_12px_rgba(0,212,255,0.9),0_0_24px_rgba(0,212,255,0.5)]" style={{ animationDelay: "0.6s" }} aria-hidden />
              {/* Raio - abaixo do logo */}
              <div className="absolute -bottom-5 left-1/2 -translate-x-1/2 w-32 h-0.5 pointer-events-none animate-lightning-bolt bg-gradient-to-r from-transparent via-white to-transparent" style={{ boxShadow: "0 0 16px rgba(0,212,255,0.9), 0 0 32px rgba(0,212,255,0.5)", animationDelay: "0.35s" }} aria-hidden />
              <div className="absolute inset-0 -m-6 rounded-full bg-gradient-to-br from-amber-500/20 via-transparent to-[#00D4FF]/20 blur-3xl animate-logo-legion-ring pointer-events-none" aria-hidden />
              <div
                className="absolute w-[120%] h-[140%] rounded-full opacity-60 pointer-events-none"
                style={{
                  background: "radial-gradient(ellipse 70% 60% at 50% 50%, rgba(212,175,55,0.25) 0%, rgba(0,212,255,0.1) 40%, transparent 70%)",
                  filter: "blur(20px)",
                  animation: "logo-legion-ring 3s ease-in-out infinite",
                }}
                aria-hidden
              />
              <div className="absolute inset-0 overflow-hidden rounded-lg pointer-events-none" aria-hidden>
                <div className="absolute top-0 bottom-0 w-1/3 bg-gradient-to-r from-transparent via-white/25 to-transparent skew-x-[-12deg] animate-logo-legion-shine" />
              </div>
              <img
                src="/logo-reaction.webp"
                alt="ReactioN MMO"
                className="relative z-10 w-full max-w-[420px] h-auto object-contain animate-logo-legion-pulse animate-logo-legion-float"
              />
            </div>

            {/* Botao Jogar: abre o jogo web direto */}
            <a
              href="/game/"
              className="mt-4 inline-flex items-center gap-3 px-14 py-5 rounded-full font-extrabold text-white text-2xl sm:text-3xl uppercase tracking-wider bg-gradient-to-r from-[#0099CC] to-[#00D4FF] border-2 border-[#00D4FF]/60 shadow-[0_0_30px_rgba(0,212,255,0.45)] hover:shadow-[0_0_45px_rgba(0,212,255,0.65)] hover:scale-[1.04] active:scale-[0.98] transition-all duration-200"
            >
              <Play className="w-7 h-7 sm:w-8 sm:h-8 fill-white" />
              Jogar
            </a>
          </div>
        </div>

        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 flex flex-col items-center gap-1 text-slate-400 text-xs">
          <span>Role para explorar</span>
          <div className="w-px h-5 bg-gradient-to-b from-slate-400 to-transparent rounded-full animate-pulse" aria-hidden />
        </div>
      </section>

      <ServerStats />

      {/* Por que o ReactioN */}
      <section className="py-12 bg-[#08080c] border-y border-white/5">
        <div className="max-w-5xl mx-auto px-6">
          <div className="text-center mb-6">
            <h2 className="text-xl sm:text-2xl font-bold text-white">
              Por que o <span className="text-amber-400">ReactioN MMO</span>
            </h2>
          </div>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {[
              { icon: Zap, title: "Taxas equilibradas", desc: "EXP médio-alto, Penya alto, Drop médio", accent: "border-l-[#00D4FF]" },
              { icon: Shield, title: "PvP e masmorras", desc: "PvP justo, masmorras exclusivas, chefes", accent: "border-l-amber-500" },
              { icon: Users2, title: "Comunidade ativa", desc: "Eventos, Discord, 24/7", accent: "border-l-[#00D4FF]" },
              { icon: Star, title: "V15 e roadmap", desc: "Cliente mais recente, fases de conteúdo", accent: "border-l-amber-500" },
            ].map((item) => (
              <div
                key={item.title}
                className={`group flex gap-3 p-3 rounded-lg bg-white/[0.03] border border-white/10 border-l-4 ${item.accent} hover:bg-white/[0.06] transition-all duration-200`}
              >
                <div className="shrink-0 w-8 h-8 rounded-md bg-white/5 flex items-center justify-center">
                  <item.icon className="w-4 h-4 text-amber-400" />
                </div>
                <div className="min-w-0">
                  <h3 className="font-semibold text-white text-sm mb-0.5">{item.title}</h3>
                  <p className="text-[11px] text-slate-400 leading-tight">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Recursos */}
      <section className="py-12 bg-black">
        <div className="max-w-7xl mx-auto px-6">
          <div className="text-center mb-6">
            <h2 className="text-2xl md:text-3xl font-bold text-amber-400 mb-1">
              Recursos do servidor
            </h2>
            <p className="text-slate-300 text-sm max-w-xl mx-auto">
              O que faz do ReactioN MMO o servidor privado de FlyFF mais avançado.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
            {advancedFeatures.map((feature, index) => (
              <div
                key={index}
                className="group bg-white/[0.03] backdrop-blur-sm border border-white/10 rounded-lg p-3 hover:border-amber-500/30 transition-all duration-200"
              >
                <div
                  className={`w-8 h-8 bg-gradient-to-br ${getCategoryColor(feature.category)} rounded-md flex items-center justify-center mb-2 text-white`}
                >
                  {feature.icon}
                </div>
                <h3 className="text-xs font-bold text-amber-400 mb-0.5">{feature.title}</h3>
                <p className="text-[11px] text-slate-400 mb-1.5 line-clamp-2 leading-tight">{feature.description}</p>
                <span className="inline-block px-1.5 py-0.5 bg-amber-500/15 text-amber-300 text-[10px] rounded border border-amber-500/25">
                  {feature.category}
                </span>
              </div>
            ))}
          </div>
        </div>
      </section>

      <CommunitySection />
      <Footer />
    </>
  );
}