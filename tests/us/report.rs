use serde_json::json;

use crate::fake;
use crate::home::Home;

#[test]
fn us_report_001_p99_file_sends_the_item_with_the_page_and_each_attachment() {
    let h = Home::new("us-report-file", fake::any);
    std::fs::write(h.dir.join("order.txt"), "order 1042: card accepted\n").unwrap();
    std::fs::write(h.dir.join("cart.png"), [0x89, b'P', b'N', b'G']).unwrap();
    std::fs::write(h.dir.join("page.html"), "<p>").unwrap();

    h.p99(&[
        "file",
        "shop.example.com",
        "--kind",
        "bug",
        "--title",
        "Pay stays grey",
        "--attach",
        "page.html",
    ])
    .refused("page.html: P99 takes images, PDFs, text, CSV, JSON, zip and office files");
    assert!(
        h.stub.seen().is_empty(),
        "a refused file reached the Worker"
    );

    let out = h.p99_in(
        &[
            "file",
            "shop.example.com",
            "--kind",
            "bug",
            "--title",
            "Pay stays grey after the card is accepted",
            "--body",
            "-",
            "--page",
            "/checkout?order=1042#pay",
            "--attach",
            "order.txt",
            "--attach",
            "cart.png",
        ],
        "Card accepted, but Pay never turns on.\n",
    );
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "BUG-21 filed on shop.example.com: Pay stays grey after the card is accepted",
            "attached order.txt as 41",
            "attached cart.png as 41",
        ]
    );

    let filed = h.stub.call("POST", "/_p99/v1/issues");
    assert!(filed.signed, "the item was sent unsigned");
    assert_eq!(filed.param("host"), Some("shop.example.com"));
    assert_eq!(filed.actor()["email"], "ada@example.com");
    let body = filed.json();
    assert_eq!(body["host"], "shop.example.com");
    assert_eq!(body["kind"], "bug");
    assert_eq!(body["body"], "Card accepted, but Pay never turns on.");
    assert_eq!(body["page"]["path"], "/checkout");
    assert_eq!(body["page"]["url"], "https://shop.example.com/checkout");
    assert_eq!(body["context"], json!({"source": "cli"}));

    let files = h.stub.under("PUT", "/_p99/v1/issues/21/attachments/");
    assert_eq!(files.len(), 2, "each file follows the item once");
    assert_eq!(files[0].param("name"), Some("order.txt"));
    assert_eq!(files[0].param("role"), Some("file"));
    assert_eq!(files[0].body, b"order 1042: card accepted\n");
    assert_eq!(files[1].param("name"), Some("cart.png"));
    assert_eq!(files[1].header("content-type"), Some("image/png"));
    assert!(files.iter().all(|f| f.signed));
}

#[test]
fn us_report_001_p99_card_new_on_a_host_files_the_card_with_its_page_and_each_file() {
    let h = Home::new("us-report-card-new", fake::any);
    std::fs::write(h.dir.join("order.txt"), "order 1042: card accepted\n").unwrap();
    std::fs::write(h.dir.join("cart.png"), [0x89, b'P', b'N', b'G']).unwrap();

    let out = h.p99_in(
        &[
            "card",
            "new",
            "--host",
            "Shop.Example.com",
            "--kind",
            "bug",
            "--title",
            "Pay stays grey after the card is accepted",
            "--body",
            "-",
            "--page",
            "/checkout?order=1042#pay",
            "--attach",
            "order.txt",
            "--attach",
            "cart.png",
        ],
        "Card accepted, but Pay never turns on.\n",
    );
    out.ok();
    assert!(out.stderr.is_empty(), "{}", out.stderr);
    assert_eq!(
        out.lines(),
        [
            "BUG-21 filed on shop.example.com: Pay stays grey after the card is accepted",
            "attached order.txt as 41",
            "attached cart.png as 41",
        ]
    );
    let filed = h.stub.calls("POST", "/_p99/v1/issues");
    assert_eq!(filed.len(), 1, "one card, filed once");
    assert!(h.stub.calls("POST", "/_p99/v1/cards").is_empty());
    let body = filed[0].json();
    assert_eq!(body["host"], "shop.example.com");
    assert_eq!(body["kind"], "bug");
    assert_eq!(body["body"], "Card accepted, but Pay never turns on.");
    assert_eq!(body["page"]["path"], "/checkout");
    assert_eq!(body["page"]["url"], "https://shop.example.com/checkout");
    assert_eq!(body["context"], json!({"source": "cli"}));
    let files = h.stub.under("PUT", "/_p99/v1/issues/21/attachments/");
    assert_eq!(files.len(), 2, "each file follows the card once");
    assert_eq!(files[0].param("name"), Some("order.txt"));
    assert_eq!(files[0].body, b"order 1042: card accepted\n");
    assert_eq!(files[1].header("content-type"), Some("image/png"));
    assert!(
        files
            .iter()
            .all(|f| f.signed && f.param("comment").is_none())
    );

    let bare = h.p99(&[
        "card",
        "new",
        "--host",
        "shop.example.com",
        "--title",
        "Add a gift note",
        "--json",
    ]);
    bare.ok();
    let printed = bare.json();
    assert_eq!(printed["issue"]["key"], "BUG-21");
    assert_eq!(printed["attachments"], json!([]));
    let body = h.stub.calls("POST", "/_p99/v1/issues")[1].json();
    assert_eq!(body["kind"], "feature");
    assert_eq!(body["page"]["path"], "");
    assert_eq!(body["page"]["url"], "https://shop.example.com/");
}

#[test]
fn us_report_001_p99_file_still_files_once_and_says_it_is_now_p99_card_new() {
    let h = Home::new("us-report-file-renamed", fake::any);
    let out = h.p99(&[
        "file",
        "shop.example.com",
        "--kind",
        "bug",
        "--title",
        "Pay stays grey",
        "--json",
    ]);
    out.ok();
    assert_eq!(out.stderr, "p99: p99 file is now p99 card new\n");
    assert_eq!(out.json()["issue"]["key"], "BUG-21");
    assert_eq!(h.stub.calls("POST", "/_p99/v1/issues").len(), 1);
    let help = h.p99(&["--help"]);
    assert!(!help.stdout.contains("\n  file "), "{}", help.stdout);
    assert!(help.stdout.contains("\n  card "), "{}", help.stdout);
}
