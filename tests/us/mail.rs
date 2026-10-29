use serde_json::json;

use crate::fake;
use crate::home::Home;
use crate::stub::{Reply, Req};

const FROM: &str = "P99 <p99@example.com>";
const SECRETS: &str = "/cf/accounts/acc1/workers/scripts/p99/secrets";
const D1: &str = "/cf/accounts/acc1/d1/database/db1/query";

fn email_set(h: &Home, from: &str) -> crate::home::Out {
    h.p99_env(
        &[
            "email",
            "set",
            "--provider",
            "resend",
            "--key-ref",
            "env:P99_TEST_RESEND",
            "--from",
            from,
        ],
        &[("P99_TEST_RESEND", "re_example")],
    )
}

fn resend_answers(status: u16, body: serde_json::Value) -> Home {
    Home::new("us-mail-resend", move |req: &Req| {
        if req.is("GET", "/resend/domains") {
            Reply::json(status, body.clone())
        } else {
            fake::any(req)
        }
    })
}

fn nothing_stored(h: &Home) {
    assert!(
        h.stub.calls("POST", D1).is_empty(),
        "the database was written"
    );
    assert!(
        h.stub.calls("PUT", SECRETS).is_empty(),
        "the Worker was handed a key"
    );
}

#[test]
fn us_mail_001_a_sender_resend_will_not_send_from_is_refused() {
    let h = Home::new("us-mail-sender", fake::any);
    email_set(&h, "P99 <p99@example.org>").refused(
        "example.org is pending with Resend, not verified; finish it at https://resend.com/domains and run this again",
    );
    email_set(&h, "p99@example.net").refused(
        "example.net is not a domain of this Resend account; add and verify it at https://resend.com/domains",
    );
    email_set(&h, "nobody").refused("nobody is not an e-mail address");
    nothing_stored(&h);
    let refused = resend_answers(401, json!({"message": "API key is invalid"}));
    email_set(&refused, FROM).refused("Resend refused the key (401)");
    nothing_stored(&refused);
    let accepted = email_set(&h, FROM);
    accepted.ok();
    assert!(
        accepted
            .stdout
            .contains("mail is on for the space main: Resend, from P99 <p99@example.com>"),
        "{}",
        accepted.stdout
    );
    assert_eq!(h.stub.calls("PUT", SECRETS).len(), 1);
}
