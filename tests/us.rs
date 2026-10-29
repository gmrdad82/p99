#[path = "us_support/desk.rs"]
mod desk;
#[path = "cli/fake.rs"]
mod fake;
#[path = "cli/home.rs"]
mod home;
#[cfg(unix)]
#[path = "us_support/live.rs"]
mod live;
#[path = "cli/stub.rs"]
mod stub;

#[path = "us/board.rs"]
mod board;
#[path = "us/cloudflare.rs"]
mod cloudflare;
#[path = "us/delete.rs"]
mod delete;
#[path = "us/deploy.rs"]
mod deploy;
#[path = "us/install.rs"]
mod install;
#[path = "us/invite.rs"]
mod invite;
#[path = "us/licence.rs"]
mod licence;
#[path = "us/link.rs"]
mod link;
#[path = "us/migrate.rs"]
mod migrate;
#[path = "us/projects.rs"]
mod projects;
#[path = "us/relink.rs"]
mod relink;
#[path = "us/report.rs"]
mod report;
#[path = "us/revoke.rs"]
mod revoke;
#[path = "us/setup.rs"]
mod setup;
#[path = "us/site.rs"]
mod site;
#[path = "us/spaces.rs"]
mod spaces;
#[path = "us/triage.rs"]
mod triage;
#[path = "us/waiting.rs"]
mod waiting;
