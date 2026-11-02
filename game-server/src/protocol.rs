//! Protocolo Gateway ↔ Rust (docs/ARQUITETURA.md §5). Quadros: `u32` big-endian com o tamanho + corpo.
//! Corpo = JSON nesta etapa (fácil de depurar; trocar por MessagePack depois mexe só em `encode`/`decode`).
//! O que vai DENTRO de `msg` é o protocolo JSON do cliente (`{t:'atk',id}`, `{t:'mobs',…}`) — o Gateway só repassa.
use crate::combat::{Attacker, Defender};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::io::{self, Read, Write};

pub const VERSION: u32 = 1;
pub const MAX_FRAME: usize = 1 << 20;

fn one() -> f32 { 1.0 }

/// o personagem que o Gateway anexa (já autenticado; o Node monta os atributos de luta a partir do inventário)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Character {
    pub id: u32,
    pub name: String,
    pub level: i64,
    pub x: f64,
    pub z: f64,
    pub hp: i64,
    pub max_hp: i64,
    /// conexão WebSocket (do servidor WS do Rust) deste jogador: as mensagens dele vão direto, sem passar pelo Node
    #[serde(default)]
    pub ws: Option<u32>,
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct AttackerIn {
    pub level: i64, pub dex: i64, pub hit_bonus: i64, pub atk_min: i64, pub atk_max: i64, pub crit: i64,
    pub crit_bonus: i64, pub atk_rate: i64, pub monster_dmg: i64, pub atk_power: i64,
    #[serde(default = "one")]
    pub w_rare: f32,
}
impl From<&AttackerIn> for Attacker {
    fn from(a: &AttackerIn) -> Self {
        Attacker { level: a.level, dex: a.dex, hit_bonus: a.hit_bonus, atk_min: a.atk_min, atk_max: a.atk_max, crit_chance: a.crit, crit_bonus: a.crit_bonus,
            atkpower_rate: a.atk_rate, monster_dmg: a.monster_dmg, atkpower: a.atk_power, w_rare: a.w_rare }
    }
}

#[derive(Debug, Clone, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct DefenderIn { pub level: i64, pub dodge: i64, pub def_base: i64, pub def_min: i64, pub def_max: i64, pub def_rate: i64 }
impl From<&DefenderIn> for Defender {
    fn from(d: &DefenderIn) -> Self { Defender { level: d.level, dodge: d.dodge, def_base: d.def_base, def_min: d.def_min, def_max: d.def_max, def_rate: d.def_rate } }
}

/// o que o Rust precisa do estado de luta de um personagem (o Node manda de novo quando muda: equipar, buff, nível, HP, postura…)
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FighterIn {
    pub attacker: AttackerIn,
    pub defender: DefenderIn,
    /// elemento e nível da arma e da suit ([0, 0] = nenhum)
    #[serde(default)]
    pub w_elem: [i64; 2],
    #[serde(default)]
    pub s_elem: [i64; 2],
    /// alcance do golpe (u, já com a folga de rede) e intervalo mínimo entre golpes (ms)
    pub reach: f64,
    pub interval_ms: u64,
    /// sons do golpe da arma (vão no `hit`)
    #[serde(default)]
    pub snd: [i64; 2],
    pub hp: i64,
    pub max_hp: i64,
    #[serde(default)]
    pub dead: bool,
    /// GM/admin imortal: o golpe acontece e o dano aparece, o HP não cai
    #[serde(default)]
    pub god: bool,
}

/// movimento de um personagem (mesmo formato do `states` do cliente: id, x, y, z, rumo em graus, estado)
#[derive(Debug, Clone, Deserialize)]
pub struct PosIn { pub id: u32, pub x: f64, pub y: f64, pub z: f64, pub h: f64, pub s: String }

/// Gateway → Rust
#[derive(Debug, Deserialize)]
#[serde(tag = "k", rename_all = "snake_case")]
pub enum LinkIn {
    /// `probe`: conexão só de consulta (stats): não recebe eventos de navegador nem é o gateway
    Hello { secret: String, version: u32, #[serde(default)] probe: bool },
    Attach { conn: u32, ch: Character },
    Detach { conn: u32 },
    /// mensagem do cliente, no protocolo JSON dele
    C2s { conn: u32, msg: Value },
    Stats,
    /// estado de luta do personagem (atributos já somados, HP, alcance…)
    Fighter { char: u32, f: FighterIn },
    /// tabela de níveis do elemento: [dano, defesa, ataque extra] por nível
    Elements { table: Vec<[i64; 3]> },
    /// o Node pede para fechar uma conexão WebSocket (kick, ban, fim de sessão)
    WsClose { ws: u32 },
    /// posições aceitas pelo Node (autoritativo: teleportes e movimento já validados lá): quem se mexeu desde o último envio
    Pos { list: Vec<PosIn> },
    /// o Node calculou um dano (golpe, skill) em um mob: o Rust confere a visão, aplica e é dono do HP/morte
    Damage { char: u32, mob: u32, dmg: i64, peaceful: bool },
    /// o personagem saiu/morreu: mobs que o atacavam desistem
    Forget { char: u32 },
    /// morto ou invisível: os mobs não o veem. `invis`: só quem é `staff` (GM/admin) o enxerga na visão de jogadores
    Flags { char: u32, untargetable: bool, #[serde(default)] invis: bool, #[serde(default)] staff: bool },
    /// invoca mobs (painel de GM)
    Summon { spawn: crate::pack::SpawnIn, x: f64, z: f64, y: f64, n: u32 },
}

/// Rust → Gateway
#[derive(Debug, Serialize)]
#[serde(tag = "k", rename_all = "snake_case")]
pub enum LinkOut {
    HelloOk { version: u32 },
    /// mensagem para o cliente `conn`, no protocolo JSON dele
    S2c { conn: u32, msg: Value },
    Stats(Stats),
    Error { error: String },
    /// o jogador golpeou (o Rust resolveu o golpe): o Node desfaz Dark Illusion/modo de batalha e reinicia a espera dele
    Attacked { char: u32, cooldown_ms: u64 },
    /// HP do jogador mudou por golpe de mob (valor absoluto, `dmg` do golpe) e se morreu
    Hurt { char: u32, hp: i64, dmg: i64, dead: bool },
    /// o jogador matou o mob (quem causou mais dano): o Node dá exp e solta os itens
    Kill { char: u32, mob: u32, x: f64, z: f64 },
    /// novo navegador conectou no WebSocket do Rust (o Node cria o "socket virtual" e roda o `join` de sempre)
    WsOpen { ws: u32, ip: String },
    /// o navegador desconectou
    WsClose { ws: u32 },
    /// um mob golpeou o personagem (modo em que o Node calcula o dano)
    MobAttack { char: u32, mob: u32 },
    /// conjunto de mobs conhecidos de `char` mudou (as ações do Node conferem nele): ids que entraram e que saíram
    Known { char: u32, add: Vec<u32>, del: Vec<u32> },
    /// espelho dos mobs que alguém vê: [id, modelo, x, z, rumo, estado, y|null, hp em milésimos][] (uma vez por envio)
    Mirror { list: Vec<Value> },
    /// mudança na visão de JOGADORES de `char`: quem entrou e quem saiu da área dele (o Node manda o `enter` com o PlayerView)
    See { char: u32, enter: Vec<u32>, leave: Vec<u32> },
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct Stats {
    pub players: usize,
    pub mobs: usize,
    pub ticks: u64,
    pub tick_avg_ms: f64,
    pub tick_max_ms: f64,
    pub hits: u64,
    pub mob_hits: u64,
    /// entradas/saídas de jogadores na visão e atualizações de posição enviadas
    pub see_enter: u64,
    pub see_leave: u64,
    pub state_updates: u64,
    /// conexões WebSocket abertas e mensagens descartadas por fila cheia (cliente lento)
    pub ws_open: usize,
    pub ws_dropped: u64,
    /// golpes de mob anotados pela IA (resolvidos aqui ou enviados ao Node)
    pub mob_attacks: u64,
    pub kills: u64,
    /// golpes de jogador resolvidos no Rust (o `atk` não passou pelo Node)
    pub direct_atk: u64,
    /// ações recusadas por motivo (AOI = o alvo não está no conjunto de visão do jogador)
    pub rejects_not_visible: u64,
    pub rejects_range: u64,
    pub rejects_cooldown: u64,
    pub rejects_dead: u64,
}

pub fn encode(v: &impl Serialize) -> Vec<u8> {
    let body = serde_json::to_vec(v).expect("serializar");
    let mut out = Vec::with_capacity(body.len() + 4);
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    out.extend_from_slice(&body);
    out
}

pub fn read_frame(r: &mut impl Read) -> io::Result<Vec<u8>> {
    let mut len = [0u8; 4];
    r.read_exact(&mut len)?;
    let n = u32::from_be_bytes(len) as usize;
    if n > MAX_FRAME { return Err(io::Error::new(io::ErrorKind::InvalidData, "quadro grande demais")); }
    let mut body = vec![0u8; n];
    r.read_exact(&mut body)?;
    Ok(body)
}

pub fn write_frame(w: &mut impl Write, body: &[u8]) -> io::Result<()> {
    w.write_all(&(body.len() as u32).to_be_bytes())?;
    w.write_all(body)
}
