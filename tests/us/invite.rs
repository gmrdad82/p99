use serde_json::json;

use crate::fake;
use crate::home::Home;
use crate::stub::{Reply, Req, minted};

fn mail_said(said: &'static str) -> Home {
    Home::new(&format!("us-invite-mail-{said}"), move |req: &Req| {
        if req.is("POST", "/_p99/v1/codes") {
            Reply::json(
                201,
                minted(
                    9,
                    "Grace Hopper",
                    "grace@example.com",
                    &["shop.example.com"],
                    Some(said),
                ),
            )
        } else {
            fake::any(req)
        }
    })
}

#[test]
fn us_invite_001_a_mail_that_did_not_go_out_says_why() {
    for (said, note) in [
        (
            "off",
            "mail is off for this space, so nothing was mailed; send the link yourself (p99 email set turns mail on)",
        ),
        (
            "skipped",
            "this e-mail takes no mail; send the link yourself",
        ),
        ("failed", "the mail didn't go out; send the link yourself"),
    ] {
        let h = mail_said(said);
        let out = h.p99(&[
            "invite",
            "--project",
            "Shop",
            "--name",
            "Grace Hopper",
            "--email",
            "grace@example.com",
        ]);
        out.ok();
        let lines = out.lines();
        assert_eq!(lines[0], "Grace Hopper <grace@example.com>", "{said}");
        assert_eq!(lines[1], "secret: abcd-efgh-jkmn", "{said}");
        assert_eq!(
            lines[2], "link:   https://shop.example.com/#p99=abcdefghjkmn",
            "{said}"
        );
        assert_eq!(lines[lines.len() - 2], note, "{said}");
        assert_eq!(
            lines[lines.len() - 1],
            "this is the only time the secret is shown",
            "{said}"
        );
        assert!(!out.stdout.contains("mailed the link"), "{said}");
        let writes = h.stub.writes();
        assert_eq!(writes.len(), 1, "{said}: the invite is the only write");
        let sent = writes[0].json();
        assert_eq!(sent["mail"], true, "{said}");
        assert_eq!(sent["grant"], json!({"projects": ["Shop"]}), "{said}");
    }
}

#[test]
fn us_invite_002_an_old_host_list_becomes_the_projects_of_its_hosts_and_says_so() {
    let h = Home::new("us-invite-legacy", fake::any);
    let out = h.p99(&[
        "invite",
        "shop.example.com",
        "dev.example.com",
        "--name",
        "Grace Hopper",
        "--email",
        "grace@example.com",
        "--no-mail",
    ]);
    out.ok();
    assert_eq!(
        out.lines(),
        [
            "Grace Hopper <grace@example.com>",
            "secret: abcd-efgh-jkmn",
            "link:   https://shop.example.com/#p99=abcdefghjkmn",
            "link:   https://blog.example.com/#p99=abcdefghjkmn",
            "link:   https://dev.example.com/#p99=abcdefghjkmn",
            "this is the only time the secret is shown",
        ]
    );
    assert!(
        out.stderr.contains(
            "a code grants projects now; shop.example.com, dev.example.com became Shop, Blog"
        ),
        "{}",
        out.stderr
    );
    let body = h.stub.call("POST", "/_p99/v1/codes").json();
    assert_eq!(body["grant"], json!({"projects": ["Shop", "Blog"]}));
    assert!(body.get("hosts").is_none());
    assert_eq!(body["mail"], false);
}

#[test]
fn us_invite_002_an_invite_that_does_not_say_what_it_grants_is_refused_and_nothing_is_minted() {
    let h = Home::new("us-invite-grant-bad", fake::any);
    h.p99(&["invite", "--name", "G", "--email", "g@example.com"])
        .refused("say what the code grants: --space for the whole space, or --project <name> (repeat it)");
    h.p99(&[
        "invite",
        "shop.example.com",
        "--project",
        "Shop",
        "--name",
        "G",
        "--email",
        "g@example.com",
    ])
    .refused("a host list is the old way and cannot go with --project or a bare --space; name projects, or --space alone");
    h.p99(&[
        "invite",
        "gone.example.com",
        "--name",
        "G",
        "--email",
        "g@example.com",
    ])
    .refused("gone.example.com is in no project; p99 hosts set gone.example.com --project <name>");
    assert!(h.stub.calls("POST", "/_p99/v1/codes").is_empty());
    assert!(h.stub.writes().is_empty());
}

#[test]
fn us_invite_003_invites_set_without_a_choice_or_with_an_unknown_project_is_refused() {
    let h = Home::new("us-invite-set", |req: &Req| {
        if req.is("PATCH", "/_p99/v1/codes/4") && req.json()["grant"]["projects"][0] == "Nope" {
            Reply::problem(400, "no project is called Nope; p99 projects add makes one")
        } else {
            fake::any(req)
        }
    });
    h.p99(&["invites", "set", "4"]).refused(
        "say what the code grants: --space for the whole space, --project <name> for some, or --park for nothing",
    );
    h.p99(&["invites", "set", "4", "--project", "Shop", "--park"])
        .clap("the argument '");
    assert!(h.stub.writes().is_empty());
    h.p99(&["invites", "set", "4", "--project", "Nope"])
        .refused("no project is called Nope; p99 projects add makes one");
    let tried = h.stub.calls("PATCH", "/_p99/v1/codes/4");
    assert_eq!(tried.len(), 1);
    assert_eq!(tried[0].json()["grant"], json!({"projects": ["Nope"]}));
    let parked = h.p99(&["invites", "set", "4", "--park"]);
    parked.ok();
    assert_eq!(
        parked.stdout,
        "code 4 of Grace Hopper <grace@example.com> is parked: it opens nothing and is not revoked; no one was mailed\n"
    );
    assert!(h.stub.calls("POST", "/_p99/v1/codes").is_empty());
}
