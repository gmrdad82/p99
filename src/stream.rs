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

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    fn serve(answer: impl FnOnce(TcpStream) + Send + 'static) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        thread::spawn(move || {
            if let Ok((tcp, _)) = listener.accept() {
                answer(tcp);
            }
        });
        format!("ws://{address}/_p99/v1/stream")
    }

    fn failed(opening: Result<Stream, Opening>) -> String {
        match opening {
            Err(Opening::Failed(why)) => why,
            Err(Opening::Refused(r)) => panic!("refused with {}", r.status),
            Ok(_) => panic!("opened"),
        }
    }

    #[test]
    fn websocket_base_swaps_the_scheme_only() {
        assert_eq!(
            websocket_base("https://shop.example.com/_p99"),
            "wss://shop.example.com/_p99"
        );
        assert_eq!(
            websocket_base("http://127.0.0.1:8787/_p99"),
            "ws://127.0.0.1:8787/_p99"
        );
        assert_eq!(
            websocket_base("wss://already.example.com"),
            "wss://already.example.com"
        );
        assert_eq!(websocket_base(""), "");
    }

    #[test]
    fn open_reads_text_skips_pongs_and_ends_on_close() {
        let url = serve(|tcp| {
            let mut ws = tungstenite::accept(tcp).unwrap();
            ws.send(Message::text("pong")).unwrap();
            ws.send(Message::binary(vec![1, 2, 3])).unwrap();
            ws.send(Message::text("{\"type\":\"issue\"}")).unwrap();
            ws.send(Message::text("second")).unwrap();
            let _ = ws.close(None);
            let _ = ws.flush();
            let _ = ws.read();
        });
        let mut stream = open(&url, &[("x-p99-test", "yes".to_owned())])
            .unwrap_or_else(|o| panic!("{}", failed(Err(o))));
        assert_eq!(stream.next().unwrap(), "{\"type\":\"issue\"}");
        assert_eq!(stream.next().unwrap(), "second");
        assert_eq!(stream.next().unwrap_err(), "the Worker closed the stream");
    }

    #[test]
    #[allow(clippy::result_large_err)]
    fn open_sends_the_headers_it_was_given() {
        let (tx, rx) = std::sync::mpsc::channel();
        let url = serve(move |tcp| {
            let callback =
                |request: &tungstenite::handshake::server::Request,
                 response: tungstenite::handshake::server::Response| {
                    let header = request
                        .headers()
                        .get("x-p99-auth")
                        .and_then(|v| v.to_str().ok())
                        .unwrap_or("")
                        .to_owned();
                    let _ = tx.send((request.uri().to_string(), header));
                    Ok(response)
                };
            let _ = tungstenite::accept_hdr(tcp, callback);
        });
        let opened = open(
            &format!("{url}?host=shop.example.com"),
            &[("x-p99-auth", "v1 ts=1,sig=ab".to_owned())],
        );
        assert!(opened.is_ok());
        let (uri, auth) = rx.recv_timeout(Duration::from_secs(30)).unwrap();
        assert_eq!(uri, "/_p99/v1/stream?host=shop.example.com");
        assert_eq!(auth, "v1 ts=1,sig=ab");
    }

    #[test]
    fn a_refusal_carries_its_status_type_location_and_body() {
        let url = serve(|mut tcp| {
            let mut buf = [0u8; 4096];
            let _ = tcp.read(&mut buf);
            let _ = tcp.write_all(
                b"HTTP/1.1 302 Found\r\nlocation: https://team.cloudflareaccess.com/cdn-cgi/access/login\r\ncontent-type: text/plain\r\ncontent-length: 5\r\nconnection: close\r\n\r\nmoved",
            );
        });
        match open(&url, &[]) {
            Err(Opening::Refused(r)) => {
                assert_eq!(r.status, 302);
                assert_eq!(r.content_type, "text/plain");
                assert_eq!(
                    r.location,
                    "https://team.cloudflareaccess.com/cdn-cgi/access/login"
                );
                assert_eq!(r.body, b"moved");
            }
            other => panic!("{}", failed(other)),
        }
    }

    #[test]
    fn a_connection_dropped_mid_handshake_fails() {
        let url = serve(|mut tcp| {
            let mut buf = [0u8; 4096];
            let _ = tcp.read(&mut buf);
        });
        assert!(!failed(open(&url, &[])).is_empty());
    }

    #[test]
    fn a_closed_port_fails_to_connect() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        assert!(!failed(open(&format!("ws://{address}/x"), &[])).is_empty());
    }

    #[test]
    fn a_bad_url_or_header_fails_before_connecting() {
        assert!(!failed(open("not a url", &[])).is_empty());
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let url = format!("ws://{}/x", listener.local_addr().unwrap());
        for header in [
            ("bad header", "v".to_owned()),
            ("x-ok", "bad\nvalue".to_owned()),
        ] {
            assert!(!failed(open(&url, &[header])).is_empty());
        }
        listener.set_nonblocking(true).unwrap();
        assert_eq!(
            listener.accept().map(drop).unwrap_err().kind(),
            io::ErrorKind::WouldBlock
        );
        let _probe = TcpStream::connect(listener.local_addr().unwrap()).unwrap();
        assert!(listener.accept().is_ok());
    }

    #[test]
    fn a_stream_the_server_drops_ends_with_a_reason() {
        let url = serve(|tcp| {
            let ws = tungstenite::accept(tcp).unwrap();
            drop(ws);
        });
        let mut stream = open(&url, &[]).unwrap_or_else(|o| panic!("{}", failed(Err(o))));
        assert!(!stream.next().unwrap_err().is_empty());
    }
}
