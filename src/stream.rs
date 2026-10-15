use std::io::{self, Read, Write};
use std::net::{TcpStream, ToSocketAddrs};
use std::sync::{Arc, OnceLock};
use std::thread;
use std::time::{Duration, Instant};

use rustls::pki_types::ServerName;
use rustls::{ClientConfig, ClientConnection, RootCertStore, StreamOwned};
use tungstenite::client::IntoClientRequest;
use tungstenite::handshake::HandshakeError;
use tungstenite::http::{HeaderName, HeaderValue};
use tungstenite::{Error, Message, WebSocket};

use crate::client::Client;

const PING: Duration = Duration::from_secs(30);
const QUIET: Duration = Duration::from_secs(75);
const POLL: Duration = Duration::from_secs(5);
const CONNECT: Duration = Duration::from_secs(10);
const FIRST_WAIT: Duration = Duration::from_secs(1);
const LONGEST_WAIT: Duration = Duration::from_secs(30);
const SETTLED: Duration = Duration::from_secs(60);

pub enum Conn {
    Plain(TcpStream),
    Tls(Box<StreamOwned<ClientConnection, TcpStream>>),
}

impl Conn {
    fn tcp(&self) -> &TcpStream {
        match self {
            Conn::Plain(tcp) => tcp,
            Conn::Tls(tls) => &tls.sock,
        }
    }
}

impl Read for Conn {
    fn read(&mut self, buf: &mut [u8]) -> io::Result<usize> {
        match self {
            Conn::Plain(tcp) => tcp.read(buf),
            Conn::Tls(tls) => tls.read(buf),
        }
    }
}

impl Write for Conn {
    fn write(&mut self, buf: &[u8]) -> io::Result<usize> {
        match self {
            Conn::Plain(tcp) => tcp.write(buf),
            Conn::Tls(tls) => tls.write(buf),
        }
    }

    fn flush(&mut self) -> io::Result<()> {
        match self {
            Conn::Plain(tcp) => tcp.flush(),
            Conn::Tls(tls) => tls.flush(),
        }
    }
}

pub struct Refused {
    pub status: u16,
    pub content_type: String,
    pub location: String,
    pub body: Vec<u8>,
}

pub enum Opening {
    Refused(Refused),
    Failed(String),
}

pub enum Trouble {
    Fatal(String),
    Passing(String),
}

pub struct Stream {
    socket: WebSocket<Conn>,
    pinged: Instant,
    heard: Instant,
}

fn tls() -> Arc<ClientConfig> {
    static CONFIG: OnceLock<Arc<ClientConfig>> = OnceLock::new();
    Arc::clone(CONFIG.get_or_init(|| {
        let roots = RootCertStore {
            roots: webpki_roots::TLS_SERVER_ROOTS.to_vec(),
        };
        let provider = Arc::new(rustls::crypto::ring::default_provider());
        let config = ClientConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .expect("ring speaks TLS 1.2 and 1.3")
            .with_root_certificates(roots)
            .with_no_client_auth();
        Arc::new(config)
    }))
}

fn connect(host: &str, port: u16) -> Result<TcpStream, String> {
    let mut last = format!("{host} has no address");
    for address in (host, port).to_socket_addrs().map_err(|e| e.to_string())? {
        match TcpStream::connect_timeout(&address, CONNECT) {
            Ok(tcp) => return Ok(tcp),
            Err(error) => last = error.to_string(),
        }
    }
    Err(last)
}

pub fn open(url: &str, headers: &[(&str, String)]) -> Result<Stream, Opening> {
    let failed = |e: &dyn std::fmt::Display| Opening::Failed(e.to_string());
    let mut request = url.into_client_request().map_err(|e| failed(&e))?;
    for (name, value) in headers {
        let name = HeaderName::from_bytes(name.as_bytes()).map_err(|e| failed(&e))?;
        let value = HeaderValue::from_str(value).map_err(|e| failed(&e))?;
        request.headers_mut().insert(name, value);
    }
    let uri = request.uri().clone();
    let secure = uri.scheme_str() == Some("wss");
    let host = uri
        .host()
        .ok_or_else(|| Opening::Failed(format!("{url} names no host")))?
        .trim_start_matches('[')
        .trim_end_matches(']')
        .to_owned();
    let port = uri.port_u16().unwrap_or(if secure { 443 } else { 80 });
    let tcp = connect(&host, port).map_err(Opening::Failed)?;
    tcp.set_read_timeout(Some(CONNECT))
        .map_err(|e| failed(&e))?;
    tcp.set_write_timeout(Some(CONNECT))
        .map_err(|e| failed(&e))?;
    let _ = tcp.set_nodelay(true);
    let conn = if secure {
        let name = ServerName::try_from(host).map_err(|e| failed(&e))?;
        let session = ClientConnection::new(tls(), name).map_err(|e| failed(&e))?;
        Conn::Tls(Box::new(StreamOwned::new(session, tcp)))
    } else {
        Conn::Plain(tcp)
    };
    match tungstenite::client(request, conn) {
        Ok((socket, _)) => {
            socket
                .get_ref()
                .tcp()
                .set_read_timeout(Some(POLL))
                .map_err(|e| failed(&e))?;
            let now = Instant::now();
            Ok(Stream {
                socket,
                pinged: now,
                heard: now,
            })
        }
        Err(HandshakeError::Failure(Error::Http(response))) => {
            let header = |name: &str| {
                response
                    .headers()
                    .get(name)
                    .and_then(|v| v.to_str().ok())
                    .unwrap_or("")
                    .to_owned()
            };
            Err(Opening::Refused(Refused {
                status: response.status().as_u16(),
                content_type: header("content-type"),
                location: header("location"),
                body: response.body().clone().unwrap_or_default(),
            }))
        }
        Err(HandshakeError::Failure(error)) => Err(failed(&error)),
        Err(HandshakeError::Interrupted(_)) => {
            Err(Opening::Failed("the handshake timed out".to_owned()))
        }
    }
}

impl Stream {
    pub fn next(&mut self) -> Result<String, String> {
        loop {
            let now = Instant::now();
            if now.duration_since(self.heard) > QUIET {
                return Err("the Worker went quiet".to_owned());
            }
            if now.duration_since(self.pinged) >= PING {
                self.socket
                    .send(Message::text("ping"))
                    .map_err(|e| e.to_string())?;
                self.pinged = now;
            }
            match self.socket.read() {
                Ok(Message::Text(text)) => {
                    self.heard = Instant::now();
                    if text.as_str() != "pong" {
                        return Ok(text.as_str().to_owned());
                    }
                }
                Ok(Message::Close(_)) => return Err("the Worker closed the stream".to_owned()),
                Ok(_) => self.heard = Instant::now(),
                Err(Error::Io(error))
                    if matches!(
                        error.kind(),
                        io::ErrorKind::WouldBlock | io::ErrorKind::TimedOut
                    ) => {}
                Err(Error::ConnectionClosed | Error::AlreadyClosed) => {
                    return Err("the stream closed".to_owned());
                }
                Err(error) => return Err(error.to_string()),
            }
        }
    }
}

pub enum Heard<'a> {
    Open { again: bool },
    Event(&'a str),
    Dropped(&'a str, Duration),
}

pub fn follow(
    client: &Client,
    host: Option<&str>,
    mut heard: impl FnMut(Heard<'_>) -> bool,
) -> Result<(), String> {
    let mut wait = FIRST_WAIT;
    let mut again = false;
    loop {
        let began = Instant::now();
        let why = match client.stream(host) {
            Ok(mut stream) => {
                if !heard(Heard::Open { again }) {
                    return Ok(());
                }
                again = true;
                loop {
                    match stream.next() {
                        Ok(text) => {
                            if !heard(Heard::Event(&text)) {
                                return Ok(());
                            }
                        }
                        Err(why) => break why,
                    }
                }
            }
            Err(Trouble::Fatal(why)) => return Err(why),
            Err(Trouble::Passing(why)) => why,
        };
        if began.elapsed() >= SETTLED {
            wait = FIRST_WAIT;
        }
        if !heard(Heard::Dropped(&why, wait)) {
            return Ok(());
        }
        thread::sleep(wait);
        wait = (wait * 2).min(LONGEST_WAIT);
    }
}

pub fn websocket_base(base: &str) -> String {
    if let Some(rest) = base.strip_prefix("https://") {
        format!("wss://{rest}")
    } else if let Some(rest) = base.strip_prefix("http://") {
        format!("ws://{rest}")
    } else {
        base.to_owned()
    }
}
