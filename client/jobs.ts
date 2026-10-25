/** classes: nome, retrato do tema (Slot*.bmp: 4 quadros de 64×64) e descrição — usado pelas janelas de classe e de skills */
export const JOBS: Record<number, { name: string; file: string; desc: string }> = {
  0: { name: 'Vagrant', file: 'SlotVan.bmp', desc: 'Iniciante: aprende golpes básicos com espada.' },
  1: { name: 'Mercenary', file: 'SlotMer.bmp', desc: 'Guerreiro de corpo a corpo, com muita vida e defesa. Usa espadas e machados e abre caminho para Knight e Blade.' },
  2: { name: 'Acrobat', file: 'SlotArc.bmp', desc: 'Ágil e veloz, luta com arco e ioiô, com esquiva e crítico altos. Evolui para Jester ou Ranger.' },
  3: { name: 'Assist', file: 'SlotAs.bmp', desc: 'Especialista em apoio: bastões e punhos, recupera e fortalece aliados. Evolui para Ringmaster ou Billposter.' },
  4: { name: 'Magician', file: 'SlotMag.bmp', desc: 'Mestre das magias elementais, ataca de longe com varinhas e cajados. Evolui para Psykeeper ou Elementor.' },
  6: { name: 'Knight', file: 'SlotKnight.bmp', desc: 'Mercenary de duas mãos: tanque de muita defesa e golpes pesados.' },
  7: { name: 'Blade', file: 'SlotBlad.bmp', desc: 'Mercenary de duas armas: ataques rápidos e dano contínuo.' },
  8: { name: 'Jester', file: 'SlotJes.bmp', desc: 'Acrobat de ioiô: ataques velozes, esquiva e golpes surpresa.' },
  9: { name: 'Ranger', file: 'SlotRan.bmp', desc: 'Acrobat de arco: dano à distância e disparos poderosos.' },
  10: { name: 'Ringmaster', file: 'SlotRingm.bmp', desc: 'Assist de bastão: cura e benção para o grupo.' },
  11: { name: 'Billposter', file: 'SlotBillfor.bmp', desc: 'Assist de punhos: dano forte e enfraquece inimigos.' },
  12: { name: 'Psykeeper', file: 'SlotPsy.bmp', desc: 'Magician psíquico: controle, drenagem e ataques mentais.' },
  13: { name: 'Elementor', file: 'SlotElem.bmp', desc: 'Magician dos elementos: fogo, água, raio e vento em grande escala.' },
};

/** fundo da árvore de skills (Back_*.TGA / ImgSkillVagrant.tga, 225×135, com os ícones cinza e as setas) por classe */
export const TREE_BG: Record<number, string> = {
  0: 'ImgSkillVagrant.tga', 1: 'Back_Me.TGA', 2: 'Back_Acr.tga', 3: 'Back_As.TGA', 4: 'Back_Ma.TGA',
  6: 'Back_Night.TGA', 7: 'Back_Blade.TGA', 8: 'Back_Jst.TGA', 9: 'Back_Rag.TGA', 10: 'Back_Ring.TGA', 11: 'Back_Bill.TGA', 12: 'Back_Psy.TGA', 13: 'Back_Ele.TGA',
};
