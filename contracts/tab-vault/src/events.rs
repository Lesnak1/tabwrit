use near_sdk::json_types::U128;
use near_sdk::serde::Serialize;
use near_sdk::{env, AccountId};

/// Custom NEP-297 event standard for the Tab protocol.
pub const STANDARD_NAME: &str = "tab";
pub const STANDARD_VERSION: &str = "1.0.0";

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde", tag = "event", content = "data")]
#[serde(rename_all = "snake_case")]
pub enum EventPayload<'a> {
    Deposit(DepositData<'a>),
    TabCreated(TabCreatedData<'a>),
    TabStatusChanged(TabStatusChangedData<'a>),
    ChargeExecuted(ChargeExecutedData<'a>),
    ChargeRejected(ChargeRejectedData<'a>),
    ChargeFailed(ChargeFailedData<'a>),
    Withdraw(WithdrawData<'a>),
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct EventEnvelope<'a> {
    pub standard: &'static str,
    pub version: &'static str,
    #[serde(flatten)]
    pub event: EventPayload<'a>,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct DepositData<'a> {
    pub owner: &'a AccountId,
    pub token: &'a AccountId,
    pub amount: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TabCreatedData<'a> {
    pub tab_id: u64,
    pub owner: &'a AccountId,
    pub spender: &'a AccountId,
    pub token: &'a AccountId,
    pub per_charge_cap: U128,
    pub per_period_cap: U128,
    pub total_cap: U128,
    pub period_secs: u64,
    pub expires_at_ns: u64,
    pub label: &'a str,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct TabStatusChangedData<'a> {
    pub tab_id: u64,
    pub owner: &'a AccountId,
    pub old_status: &'a str,
    pub new_status: &'a str,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ChargeExecutedData<'a> {
    pub tab_id: u64,
    pub nonce: u64,
    pub owner: &'a AccountId,
    pub spender: &'a AccountId,
    pub token: &'a AccountId,
    pub amount: U128,
    pub receiver_id: &'a AccountId,
    pub reference: &'a str,
    pub spent_in_period: U128,
    pub spent_total: U128,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ChargeRejectedData<'a> {
    pub tab_id: u64,
    pub owner: &'a AccountId,
    pub spender: &'a AccountId,
    pub token: &'a AccountId,
    pub amount: U128,
    pub receiver_id: &'a AccountId,
    pub reason: &'static str,
    pub reference: &'a str,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct ChargeFailedData<'a> {
    pub tab_id: u64,
    pub nonce: u64,
    pub owner: &'a AccountId,
    pub amount: U128,
    pub receiver_id: &'a AccountId,
    pub reason: &'a str,
    pub reference: &'a str,
}

#[derive(Serialize)]
#[serde(crate = "near_sdk::serde")]
pub struct WithdrawData<'a> {
    pub owner: &'a AccountId,
    pub token: &'a AccountId,
    pub amount: U128,
}

pub fn emit_event(payload: EventPayload) {
    let envelope = EventEnvelope {
        standard: STANDARD_NAME,
        version: STANDARD_VERSION,
        event: payload,
    };
    if let Ok(json) = near_sdk::serde_json::to_string(&envelope) {
        env::log_str(&format!("EVENT_JSON:{}", json));
    }
}
