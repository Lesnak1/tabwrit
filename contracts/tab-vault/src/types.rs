use near_sdk::json_types::U128;
use near_sdk::{near, AccountId};

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum TabStatus {
    Active,
    Paused,
    Revoked,
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ReceiverPolicy {
    /// The spender may direct funds to any NEAR account. Required for
    /// NEAR Intents 1Click, whose deposit address changes for every quote.
    Any,
    /// The spender may only direct funds to the listed NEAR accounts.
    /// This is a fixed-recipient policy (payroll, API providers, on-chain
    /// merchants) and intentionally does not support rotating 1Click
    /// deposit addresses.
    Allowlist(Vec<AccountId>),
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ChargeRejectReason {
    TabNotActive,
    TabExpired,
    PerChargeCap,
    PeriodCap,
    TotalCap,
    ReceiverNotAllowed,
    InsufficientBalance,
}

impl ChargeRejectReason {
    pub fn as_str(&self) -> &'static str {
        match self {
            ChargeRejectReason::TabNotActive => "TAB_NOT_ACTIVE",
            ChargeRejectReason::TabExpired => "TAB_EXPIRED",
            ChargeRejectReason::PerChargeCap => "PER_CHARGE_CAP",
            ChargeRejectReason::PeriodCap => "PERIOD_CAP",
            ChargeRejectReason::TotalCap => "TOTAL_CAP",
            ChargeRejectReason::ReceiverNotAllowed => "RECEIVER_NOT_ALLOWED",
            ChargeRejectReason::InsufficientBalance => "INSUFFICIENT_BALANCE",
        }
    }
}

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug)]
pub struct Tab {
    pub id: u64,
    pub owner: AccountId,
    pub spender: AccountId,
    pub token: AccountId,
    pub per_charge_cap: U128,
    pub per_period_cap: U128,
    pub total_cap: U128,
    pub period_secs: u64,
    pub start_ns: u64,
    pub expires_at_ns: u64,
    pub receiver_policy: ReceiverPolicy,
    pub status: TabStatus,
    pub spent_total: U128,
    pub period_index: u64,
    pub spent_in_period: U128,
    pub charge_count: u64,
    /// Monotonic charge nonce. The spender must pass this exact value to
    /// `charge`; it is incremented before the transfer and is never reused.
    pub next_nonce: u64,
    pub label: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ChargeExecutionResult {
    Executed { amount: U128, nonce: u64 },
    Rejected { reason: ChargeRejectReason },
    Failed { reason: String },
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RemainingAllowance {
    pub remaining_in_period: U128,
    pub remaining_total: U128,
    pub current_period_index: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VaultStats {
    pub token: AccountId,
    pub total_tabs: u64,
    pub total_charges: u64,
    pub total_volume: U128,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct VaultConfig {
    pub allowed_tokens: Vec<AccountId>,
    pub min_tab_storage_yocto: U128,
    pub max_tabs_per_owner: u64,
    pub max_label_len: u64,
    pub max_reference_len: u64,
    pub max_allowlist_len: u64,
}
