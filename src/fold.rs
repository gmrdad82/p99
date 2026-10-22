use serde_json::Value;

use crate::cloudflare::Cloudflare;
use crate::config::Account;

pub fn plan(
    cf: &Cloudflare,
    account: &Account,
    plan: &mut Value,
    decisions: &mut Vec<String>,
) -> Result<(), String> {
    let _ = (cf, account, plan, decisions);
    todo!("0016_one_board's plan: the lane mapping, the boards and labels it archives, the order it keeps")
}

pub fn render(out: &mut String, plan: &Value) {
    if plan.get("one_board").is_none() {
        return;
    }
    let _ = out;
    todo!("0016_one_board's lines in p99 migrate --plan")
}
