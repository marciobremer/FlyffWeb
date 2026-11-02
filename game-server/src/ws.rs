//! Servidor WebSocket do Rust: os navegadores conectam direto aqui (sem passar pelo Node) e as mensagens de/para o jogador
//! viajam pelo link com o Node em quadros crus. Roda num runtime tokio próprio; a thread de mapa só enxerga duas filas.
//!   navegador ⇄ [tarefa por conexão] ⇄ (mpsc) ⇄ thread de mapa
use futures_util::{SinkExt, StreamExt};
use std::net::SocketAddr;
use std::sync::mpsc::Sender as StdSender;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::mpsc::{self, Sender};
use tokio_tungstenite::tungstenite::handshake::server::{ErrorResponse, Request, Response};
use tokio_tungstenite::tungstenite::protocol::WebSocketConfig;
use tokio_tungstenite::tungstenite::Message;

/// maior mensagem aceita do cliente (como o `maxPayload` do Node)
pub const MAX_CLIENT_MSG: usize = 4096;
/// mensagens pendentes por conexão antes de começar a descartar (as de posição se refazem sozinhas)
const OUT_QUEUE: usize = 512;
const PING_EVERY: Duration = Duration::from_secs(15);
const IDLE_LIMIT: Duration = Duration::from_secs(45);

/// o que a conexão avisa à thread de mapa
pub enum WsEvent {
    Open { ws: u32, tx: Sender<Out>, ip: String },
    Msg { ws: u32, payload: Vec<u8> },
    Closed { ws: u32 },
}

/// o que a thread de mapa manda para a conexão
pub enum Out {
    Text(String),
    Close,
}

/// sobe o servidor WS em `addr`; `events` entrega o que acontece nas conexões. Devolve o endereço real (porta 0 escolhe uma).
pub fn spawn_server(addr: &str, events: StdSender<WsEvent>) -> std::io::Result<SocketAddr> {
    let std_listener = std::net::TcpListener::bind(addr)?;
    std_listener.set_nonblocking(true)?;
    let local = std_listener.local_addr()?;
    std::thread::Builder::new().name("ws-runtime".into()).spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread().worker_threads(2).enable_all().build().expect("runtime tokio");
        rt.block_on(async move {
            let listener = TcpListener::from_std(std_listener).expect("listener tokio");
            let mut next: u32 = 0;
            loop {
                let Ok((stream, peer)) = listener.accept().await else { continue };
                let _ = stream.set_nodelay(true);
                next = next.wrapping_add(1).max(1);
                tokio::spawn(connection(next, stream, peer, events.clone()));
            }
        });
    })?;
    Ok(local)
}

async fn connection(ws_id: u32, stream: tokio::net::TcpStream, peer: SocketAddr, events: StdSender<WsEvent>) {
    let cfg = WebSocketConfig::default().max_message_size(Some(MAX_CLIENT_MSG)).max_frame_size(Some(MAX_CLIENT_MSG));
    let check = |req: &Request, resp: Response| -> Result<Response, ErrorResponse> {
        if req.uri().path() == "/ws" { Ok(resp) } else { Err(ErrorResponse::new(Some("só /ws".into()))) }
    };
    let Ok(ws) = tokio_tungstenite::accept_hdr_async_with_config(stream, check, Some(cfg)).await else { return };
    let (mut sink, mut stream) = ws.split();
    let (tx, mut rx) = mpsc::channel::<Out>(OUT_QUEUE);
    if events.send(WsEvent::Open { ws: ws_id, tx, ip: peer.ip().to_string() }).is_err() { return; }

    // escrita: junta o que já está na fila e esvazia o buffer uma vez só
    let writer = tokio::spawn(async move {
        let mut ping = tokio::time::interval(PING_EVERY);
        ping.tick().await;
        loop {
            tokio::select! {
                out = rx.recv() => {
                    let Some(out) = out else { break };
                    let mut closing = false;
                    match out { Out::Text(t) => { if sink.feed(Message::Text(t.into())).await.is_err() { break; } } Out::Close => closing = true }
                    while let Ok(more) = rx.try_recv() {
                        match more { Out::Text(t) => { if sink.feed(Message::Text(t.into())).await.is_err() { return; } } Out::Close => { closing = true; break; } }
                    }
                    if sink.flush().await.is_err() { break; }
                    if closing { let _ = sink.close().await; break; }
                }
                _ = ping.tick() => { if sink.send(Message::Ping(Vec::new().into())).await.is_err() { break; } }
            }
        }
    });

    // leitura: qualquer quadro (inclusive pong) conta como vida; calado por IDLE_LIMIT = conexão morta
    loop {
        match tokio::time::timeout(IDLE_LIMIT, stream.next()).await {
            Ok(Some(Ok(Message::Text(t)))) => {
                if events.send(WsEvent::Msg { ws: ws_id, payload: t.as_bytes().to_vec() }).is_err() { break; }
            }
            Ok(Some(Ok(Message::Close(_)))) | Ok(None) | Ok(Some(Err(_))) | Err(_) => break,
            Ok(Some(Ok(_))) => {} // ping/pong/binário: o tungstenite já responde ao ping
        }
    }
    writer.abort();
    let _ = events.send(WsEvent::Closed { ws: ws_id });
}
