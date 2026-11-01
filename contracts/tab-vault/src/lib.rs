pub mod events;
pub mod external;
pub mod types;

#[cfg(test)]
mod fuzz_tests;
#[cfg(test)]
mod tests;

use external::{ext_ft, ext_self, GAS_FOR_CALLBACK, GAS_FOR_FT_TRANSFER};
use near_sdk::collections::{LookupMap, LookupSet, Vector};
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, require, AccountId, NearToken, PanicOnDefault, Promise, PromiseOrValue,
};
use types::{
    ChargeExecutionResult, ChargeRejectReason, ReceiverPolicy, RemainingAllowance, Tab, TabStatus,
    VaultConfig, VaultStats,
};

/// 0.01 NEAR is a conservative prepayment for one Tab plus its two index
/// entries. Any excess stays in the contract as a shared storage buffer.
pub const MIN_TAB_STORAGE: NearToken = NearToken::from_millinear(10);
pub const MAX_TABS_PER_OWNER: u64 = 100;
pub const MAX_LABEL_LEN: u64 = 64;
pub const MAX_REFERENCE_LEN: u64 = 128;
pub const MAX_ALLOWLIST_LEN: u64 = 20;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TabVault {
    pub allowed_tokens: LookupSet<AccountId>,
    pub token_list: Vec<AccountId>,
    pub balances: LookupMap<(AccountId, AccountId), u128>,
    pub tabs: LookupMap<u64, Tab>,
    pub owner_tabs: LookupMap<AccountId, Vector<u64>>,
    pub spender_tabs: LookupMap<AccountId, Vector<u64>>,
    pub next_tab_id: u64,
    pub total_charges: u64,
    pub token_volume: LookupMap<AccountId, u128>,
}

#[near]
impl TabVault {
    #[init]
    pub fn new(allowed_tokens: Vec<AccountId>) -> Self {
        require!(!env::state_exists(), "ERR_ALREADY_INITIALIZED");
        require!(!allowed_tokens.is_empty(), "ERR_NO_ALLOWED_TOKENS");

        let mut set = LookupSet::new(b"a");
        let mut token_list = Vec::new();
        for token in allowed_tokens {
            if !set.contains(&token) {
                set.insert(&token);
                token_list.push(token);
            }
        }

        Self {
            allowed_tokens: set,
            token_list,
            balances: LookupMap::new(b"b"),
            tabs: LookupMap::new(b"t"),
            owner_tabs: LookupMap::new(b"o"),
            spender_tabs: LookupMap::new(b"s"),
            next_tab_id: 1,
            total_charges: 0,
            token_volume: LookupMap::new(b"v"),
        }
    }

    /// NEP-141 receiver. Only allowlisted tokens are accepted; any other
    /// token is returned in full to the sender by the token contract.
    pub fn ft_on_transfer(
        &mut self,
        sender_id: AccountId,
        amount: U128,
        #[allow(unused_variables)] msg: String,
    ) -> PromiseOrValue<U128> {
        let token_id = env::predecessor_account_id();
        if !self.allowed_tokens.contains(&token_id) {
            return PromiseOrValue::Value(amount);
        }

        let amount_u128: u128 = amount.into();
        require!(amount_u128 > 0, "ERR_AMOUNT_ZERO");

        let key = (sender_id.clone(), token_id.clone());
        let current_balance = self.balances.get(&key).unwrap_or(0);
        let new_balance = current_balance
            .checked_add(amount_u128)
            .expect("ERR_BALANCE_OVERFLOW");
        self.balances.insert(&key, &new_balance);

        events::emit_event(events::EventPayload::Deposit(events::DepositData {
            owner: &sender_id,
            token: &token_id,
            amount,
        }));

        PromiseOrValue::Value(U128(0))
    }

    /// Creates a new spending Tab. The attached deposit covers the storage
    /// for the Tab and its owner/spender indexes.
    #[payable]
    pub fn create_tab(
        &mut self,
        spender: AccountId,
        token: AccountId,
        per_charge_cap: U128,
        per_period_cap: U128,
        total_cap: U128,
        period_secs: u64,
        expires_at_ns: u64,
        receiver_policy: ReceiverPolicy,
        label: String,
    ) -> u64 {
        let owner = env::predecessor_account_id();
        require!(
            env::attached_deposit() >= MIN_TAB_STORAGE,
            "ERR_STORAGE_DEPOSIT_REQUIRED"
        );
        require!(
            self.allowed_tokens.contains(&token),
            "ERR_TOKEN_NOT_ALLOWED"
        );
        require!(
            label.len() as u64 <= MAX_LABEL_LEN,
            "ERR_LABEL_TOO_LONG"
        );

        let per_charge: u128 = per_charge_cap.into();
        let per_period: u128 = per_period_cap.into();
        let total: u128 = total_cap.into();

        require!(per_charge > 0, "ERR_PER_CHARGE_CAP_ZERO");
        require!(
            per_charge <= per_period,
            "ERR_PER_CHARGE_EXCEEDS_PERIOD"
        );
        require!(per_period <= total, "ERR_PERIOD_EXCEEDS_TOTAL");
        require!(period_secs > 0, "ERR_PERIOD_SECS_ZERO");
        require!(
            expires_at_ns > env::block_timestamp(),
            "ERR_EXPIRY_IN_PAST"
        );

        if let ReceiverPolicy::Allowlist(ref list) = receiver_policy {
            require!(!list.is_empty(), "ERR_EMPTY_ALLOWLIST");
            require!(
                list.len() as u64 <= MAX_ALLOWLIST_LEN,
                "ERR_ALLOWLIST_TOO_LONG"
            );
        }

        let existing_len = self
            .owner_tabs
            .get(&owner)
            .map(|v| v.len())
            .unwrap_or(0);
        require!(
            existing_len < MAX_TABS_PER_OWNER,
            "ERR_TOO_MANY_TABS"
        );

        let tab_id = self.next_tab_id;
        self.next_tab_id = self
            .next_tab_id
            .checked_add(1)
            .expect("ERR_TAB_ID_OVERFLOW");

        let now_ns = env::block_timestamp();
        let tab = Tab {
            id: tab_id,
            owner: owner.clone(),
            spender: spender.clone(),
            token: token.clone(),
            per_charge_cap,
            per_period_cap,
            total_cap,
            period_secs,
            start_ns: now_ns,
            expires_at_ns,
            receiver_policy,
            status: TabStatus::Active,
            spent_total: U128(0),
            period_index: 0,
            spent_in_period: U128(0),
            charge_count: 0,
            next_nonce: 0,
            label: label.clone(),
        };

        self.tabs.insert(&tab_id, &tab);

        let mut o_vec = self
            .owner_tabs
            .get(&owner)
            .unwrap_or_else(|| Vector::new(format!("o_{}", owner).as_bytes()));
        o_vec.push(&tab_id);
        self.owner_tabs.insert(&owner, &o_vec);

        let mut s_vec = self
            .spender_tabs
            .get(&spender)
            .unwrap_or_else(|| Vector::new(format!("s_{}", spender).as_bytes()));
        s_vec.push(&tab_id);
        self.spender_tabs.insert(&spender, &s_vec);

        events::emit_event(events::EventPayload::TabCreated(events::TabCreatedData {
            tab_id,
            owner: &owner,
            spender: &spender,
            token: &token,
            per_charge_cap,
            per_period_cap,
            total_cap,
            period_secs,
            expires_at_ns,
            label: &label,
        }));

        tab_id
    }

    /// Pauses an active tab. Only the owner can pause.
    pub fn pause_tab(&mut self, id: u64) {
        let mut tab = self.tabs.get(&id).expect("ERR_TAB_NOT_FOUND");
        let caller = env::predecessor_account_id();
        require!(caller == tab.owner, "ERR_CALLER_NOT_OWNER");
        require!(tab.status == TabStatus::Active, "ERR_TAB_NOT_ACTIVE");

        tab.status = TabStatus::Paused;
        self.tabs.insert(&id, &tab);

        events::emit_event(events::EventPayload::TabStatusChanged(
            events::TabStatusChangedData {
                tab_id: id,
                owner: &tab.owner,
                old_status: "Active",
                new_status: "Paused",
            },
        ));
    }

    /// Resumes a paused tab. Only the owner can resume.
    pub fn resume_tab(&mut self, id: u64) {
        let mut tab = self.tabs.get(&id).expect("ERR_TAB_NOT_FOUND");
        let caller = env::predecessor_account_id();
        require!(caller == tab.owner, "ERR_CALLER_NOT_OWNER");
        require!(tab.status == TabStatus::Paused, "ERR_TAB_NOT_PAUSED");

        tab.status = TabStatus::Active;
        self.tabs.insert(&id, &tab);

        events::emit_event(events::EventPayload::TabStatusChanged(
            events::TabStatusChangedData {
                tab_id: id,
                owner: &tab.owner,
                old_status: "Paused",
                new_status: "Active",
            },
        ));
    }

    /// Revokes a tab permanently. Only the owner can revoke.
    pub fn revoke_tab(&mut self, id: u64) {
        let mut tab = self.tabs.get(&id).expect("ERR_TAB_NOT_FOUND");
        let caller = env::predecessor_account_id();
        require!(caller == tab.owner, "ERR_CALLER_NOT_OWNER");
        require!(tab.status != TabStatus::Revoked, "ERR_TAB_ALREADY_REVOKED");

        let old_status = match tab.status {
            TabStatus::Active => "Active",
            TabStatus::Paused => "Paused",
            TabStatus::Revoked => "Revoked",
        };

        tab.status = TabStatus::Revoked;
        self.tabs.insert(&id, &tab);

        events::emit_event(events::EventPayload::TabStatusChanged(
            events::TabStatusChangedData {
                tab_id: id,
                owner: &tab.owner,
                old_status,
                new_status: "Revoked",
            },
        ));
    }

    /// Charges against a tab. The caller MUST be the designated spender.
    ///
    /// `nonce` must equal `tab.next_nonce`. It is incremented before the
    /// token transfer, so a retried transaction can never double-charge.
    ///
    /// Policy violations do NOT panic; they emit `charge_rejected` and
    /// return `Rejected`, leaving the nonce untouched so the spender can
    /// retry with a corrected request.
    pub fn charge(
        &mut self,
        tab_id: u64,
        amount: U128,
        receiver_id: AccountId,
        reference: String,
        nonce: u64,
    ) -> PromiseOrValue<ChargeExecutionResult> {
        let mut tab = self.tabs.get(&tab_id).expect("ERR_TAB_NOT_FOUND");
        let caller = env::predecessor_account_id();
        require!(caller == tab.spender, "ERR_CALLER_NOT_SPENDER");
        require!(
            reference.len() as u64 <= MAX_REFERENCE_LEN,
            "ERR_REFERENCE_TOO_LONG"
        );
        require!(nonce == tab.next_nonce, "ERR_NONCE_MISMATCH");

        let amount_u128: u128 = amount.into();
        require!(amount_u128 > 0, "ERR_AMOUNT_ZERO");

        // 1. Status check
        if tab.status != TabStatus::Active {
            return self.reject_charge(
                &tab,
                amount,
                &receiver_id,
                ChargeRejectReason::TabNotActive,
                &reference,
            );
        }

        // 2. Expiry check
        let now_ns = env::block_timestamp();
        if now_ns >= tab.expires_at_ns {
            return self.reject_charge(
                &tab,
                amount,
                &receiver_id,
                ChargeRejectReason::TabExpired,
                &reference,
            );
        }

        // 3. Per-charge cap
        let per_charge_cap: u128 = tab.per_charge_cap.into();
        if amount_u128 > per_charge_cap {
            return self.reject_charge(
                &tab,
                amount,
                &receiver_id,
                ChargeRejectReason::PerChargeCap,
                &reference,
            );
        }

        // 4. Receiver allowlist
        if let ReceiverPolicy::Allowlist(ref list) = tab.receiver_policy {
            if !list.contains(&receiver_id) {
                return self.reject_charge(
                    &tab,
                    amount,
                    &receiver_id,
                    ChargeRejectReason::ReceiverNotAllowed,
                    &reference,
                );
            }
        }

        // 5. Period calculation and cap
        let period_ns = (tab.period_secs as u128)
            .checked_mul(1_000_000_000)
            .expect("ERR_PERIOD_CALC_OVERFLOW");
        let current_period_index =
            ((now_ns.saturating_sub(tab.start_ns)) as u128 / period_ns) as u64;

        let current_spent_in_period: u128 = if current_period_index > tab.period_index {
            0
        } else {
            tab.spent_in_period.into()
        };

        let new_spent_in_period = match current_spent_in_period.checked_add(amount_u128) {
            Some(v) => v,
            None => {
                return self.reject_charge(
                    &tab,
                    amount,
                    &receiver_id,
                    ChargeRejectReason::PeriodCap,
                    &reference,
                )
            }
        };

        let per_period_cap: u128 = tab.per_period_cap.into();
        if new_spent_in_period > per_period_cap {
            return self.reject_charge(
                &tab,
                amount,
                &receiver_id,
                ChargeRejectReason::PeriodCap,
                &reference,
            );
        }

        // 6. Lifetime cap
        let current_spent_total: u128 = tab.spent_total.into();
        let new_spent_total = match current_spent_total.checked_add(amount_u128) {
            Some(v) => v,
            None => {
                return self.reject_charge(
                    &tab,
                    amount,
                    &receiver_id,
                    ChargeRejectReason::TotalCap,
                    &reference,
                )
            }
        };

        let total_cap: u128 = tab.total_cap.into();
        if new_spent_total > total_cap {
            return self.reject_charge(
                &tab,
                amount,
                &receiver_id,
                ChargeRejectReason::TotalCap,
                &reference,
            );
        }

        // 7. Vault balance
        let balance_key = (tab.owner.clone(), tab.token.clone());
        let owner_balance = self.balances.get(&balance_key).unwrap_or(0);
        if owner_balance < amount_u128 {
            return self.reject_charge(
                &tab,
                amount,
                &receiver_id,
                ChargeRejectReason::InsufficientBalance,
                &reference,
            );
        }

        // Checks passed: reserve the charge before the cross-contract call.
        // `nonce` is consumed here; the callback only settles the
        // accounting. This is what makes retries idempotent.
        tab.next_nonce = nonce.checked_add(1).expect("ERR_NONCE_OVERFLOW");
        tab.period_index = current_period_index;
        tab.spent_in_period = U128(new_spent_in_period);
        tab.spent_total = U128(new_spent_total);
        tab.charge_count = tab
            .charge_count
            .checked_add(1)
            .expect("ERR_CHARGE_COUNT_OVERFLOW");
        self.tabs.insert(&tab_id, &tab);

        let new_owner_balance = owner_balance - amount_u128;
        self.balances.insert(&balance_key, &new_owner_balance);

        let promise = ext_ft::ext(tab.token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(
                receiver_id.clone(),
                amount,
                Some(format!("Tab charge: ref={}", reference)),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_charge_transfer_callback(
                        tab_id,
                        nonce,
                        amount,
                        receiver_id,
                        reference,
                        current_period_index,
                    ),
            );

        PromiseOrValue::Promise(promise)
    }

    /// Settles a reserved charge after the NEP-141 transfer resolves.
    ///
    /// Failure handling subtracts the charge from the *current* counters
    /// instead of restoring a snapshot. A second charge may have been
    /// reserved while this transfer was in flight; a snapshot restore would
    /// erase that later charge's accounting. The nonce is only rewound when
    /// this was the latest reservation.
    #[private]
    pub fn on_charge_transfer_callback(
        &mut self,
        tab_id: u64,
        nonce: u64,
        amount: U128,
        receiver_id: AccountId,
        reference: String,
        charge_period_index: u64,
    ) -> ChargeExecutionResult {
        let mut tab = match self.tabs.get(&tab_id) {
            Some(tab) => tab,
            None => {
                return ChargeExecutionResult::Failed {
                    reason: "TAB_NOT_FOUND".to_string(),
                }
            }
        };

        // Defensive guard: the callback must correspond to a reservation
        // that is still ahead of the consumed nonce.
        if tab.next_nonce <= nonce {
            return ChargeExecutionResult::Failed {
                reason: "CHARGE_NOT_RESERVED".to_string(),
            };
        }

        let amount_u128: u128 = amount.into();

        if !near_sdk::is_promise_success() {
            tab.spent_total = U128(tab.spent_total.0.saturating_sub(amount_u128));
            if tab.period_index == charge_period_index {
                tab.spent_in_period = U128(tab.spent_in_period.0.saturating_sub(amount_u128));
            }
            tab.charge_count = tab.charge_count.saturating_sub(1);
            if tab.next_nonce == nonce.saturating_add(1) {
                tab.next_nonce = nonce;
            }
            self.tabs.insert(&tab_id, &tab);

            let balance_key = (tab.owner.clone(), tab.token.clone());
            let current_balance = self.balances.get(&balance_key).unwrap_or(0);
            let restored_balance = current_balance
                .checked_add(amount_u128)
                .expect("ERR_RESTORE_OVERFLOW");
            self.balances.insert(&balance_key, &restored_balance);

            events::emit_event(events::EventPayload::ChargeFailed(
                events::ChargeFailedData {
                    tab_id,
                    nonce,
                    owner: &tab.owner,
                    amount,
                    receiver_id: &receiver_id,
                    reason: "FT_TRANSFER_PROMISE_FAILED",
                    reference: &reference,
                },
            ));

            return ChargeExecutionResult::Failed {
                reason: "FT_TRANSFER_PROMISE_FAILED".to_string(),
            };
        }

        events::emit_event(events::EventPayload::ChargeExecuted(
            events::ChargeExecutedData {
                tab_id,
                nonce,
                owner: &tab.owner,
                spender: &tab.spender,
                token: &tab.token,
                amount,
                receiver_id: &receiver_id,
                reference: &reference,
                spent_in_period: tab.spent_in_period,
                spent_total: tab.spent_total,
            },
        ));

        // Global counters only move on confirmed settlement.
        self.total_charges = self
            .total_charges
            .checked_add(1)
            .expect("ERR_TOTAL_CHARGES_OVERFLOW");
        let volume = self.token_volume.get(&tab.token).unwrap_or(0);
        let new_volume = volume
            .checked_add(amount_u128)
            .expect("ERR_VOLUME_OVERFLOW");
        self.token_volume.insert(&tab.token, &new_volume);

        ChargeExecutionResult::Executed { amount, nonce }
    }

    /// Withdraws the caller's available balance to their own account.
    pub fn withdraw(&mut self, token: AccountId, amount: U128) -> Promise {
        let owner = env::predecessor_account_id();
        let amount_u128: u128 = amount.into();
        require!(amount_u128 > 0, "ERR_AMOUNT_ZERO");

        let balance_key = (owner.clone(), token.clone());
        let current_balance = self.balances.get(&balance_key).unwrap_or(0);
        require!(current_balance >= amount_u128, "ERR_INSUFFICIENT_BALANCE");

        let new_balance = current_balance - amount_u128;
        self.balances.insert(&balance_key, &new_balance);

        ext_ft::ext(token.clone())
            .with_attached_deposit(NearToken::from_yoctonear(1))
            .with_static_gas(GAS_FOR_FT_TRANSFER)
            .ft_transfer(
                owner.clone(),
                amount,
                Some("Withdrawal from Tab Vault".to_string()),
            )
            .then(
                ext_self::ext(env::current_account_id())
                    .with_static_gas(GAS_FOR_CALLBACK)
                    .on_withdraw_callback(owner, token, amount),
            )
    }

    #[private]
    pub fn on_withdraw_callback(
        &mut self,
        owner: AccountId,
        token: AccountId,
        amount: U128,
    ) -> bool {
        let amount_u128: u128 = amount.into();
        let balance_key = (owner.clone(), token.clone());

        if !near_sdk::is_promise_success() {
            let current_balance = self.balances.get(&balance_key).unwrap_or(0);
            let restored = current_balance
                .checked_add(amount_u128)
                .expect("ERR_RESTORE_OVERFLOW");
            self.balances.insert(&balance_key, &restored);
            false
        } else {
            events::emit_event(events::EventPayload::Withdraw(events::WithdrawData {
                owner: &owner,
                token: &token,
                amount,
            }));
            true
        }
    }

    // --- View methods ---

    pub fn get_tab(&self, tab_id: u64) -> Option<Tab> {
        self.tabs.get(&tab_id)
    }

    pub fn get_balance(&self, owner: AccountId, token: AccountId) -> U128 {
        U128(self.balances.get(&(owner, token)).unwrap_or(0))
    }

    pub fn get_remaining(&self, tab_id: u64) -> Option<RemainingAllowance> {
        let tab = self.tabs.get(&tab_id)?;
        let now_ns = env::block_timestamp();

        if tab.status != TabStatus::Active || now_ns >= tab.expires_at_ns {
            return Some(RemainingAllowance {
                remaining_in_period: U128(0),
                remaining_total: U128(0),
                current_period_index: tab.period_index,
            });
        }

        let period_ns = (tab.period_secs as u128)
            .checked_mul(1_000_000_000)
            .expect("ERR_PERIOD_CALC_OVERFLOW");
        let current_period_index =
            ((now_ns.saturating_sub(tab.start_ns)) as u128 / period_ns) as u64;

        let spent_in_period: u128 = if current_period_index > tab.period_index {
            0
        } else {
            tab.spent_in_period.into()
        };

        let per_period_cap: u128 = tab.per_period_cap.into();
        let total_cap: u128 = tab.total_cap.into();
        let spent_total: u128 = tab.spent_total.into();

        let remaining_in_period = per_period_cap.saturating_sub(spent_in_period);
        let remaining_total = total_cap.saturating_sub(spent_total);

        Some(RemainingAllowance {
            remaining_in_period: U128(remaining_in_period),
            remaining_total: U128(remaining_total),
            current_period_index,
        })
    }

    pub fn get_nonce(&self, tab_id: u64) -> u64 {
        self.tabs.get(&tab_id).map(|t| t.next_nonce).unwrap_or(0)
    }

    pub fn list_tabs_by_owner(
        &self,
        owner: AccountId,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<Tab> {
        let v = match self.owner_tabs.get(&owner) {
            Some(v) => v,
            None => return Vec::new(),
        };

        let start = from_index.unwrap_or(0);
        let max_limit = limit.unwrap_or(50).min(100);
        let len = v.len();

        (start..std::cmp::min(start.saturating_add(max_limit), len))
            .filter_map(|i| {
                let tab_id = v.get(i)?;
                self.tabs.get(&tab_id)
            })
            .collect()
    }

    pub fn list_tabs_by_spender(
        &self,
        spender: AccountId,
        from_index: Option<u64>,
        limit: Option<u64>,
    ) -> Vec<Tab> {
        let v = match self.spender_tabs.get(&spender) {
            Some(v) => v,
            None => return Vec::new(),
        };

        let start = from_index.unwrap_or(0);
        let max_limit = limit.unwrap_or(50).min(100);
        let len = v.len();

        (start..std::cmp::min(start.saturating_add(max_limit), len))
            .filter_map(|i| {
                let tab_id = v.get(i)?;
                self.tabs.get(&tab_id)
            })
            .collect()
    }

    pub fn is_token_allowed(&self, token: AccountId) -> bool {
        self.allowed_tokens.contains(&token)
    }

    pub fn get_token_list(&self) -> Vec<AccountId> {
        self.token_list.clone()
    }

    pub fn get_config(&self) -> VaultConfig {
        VaultConfig {
            allowed_tokens: self.token_list.clone(),
            min_tab_storage_yocto: U128(MIN_TAB_STORAGE.as_yoctonear()),
            max_tabs_per_owner: MAX_TABS_PER_OWNER,
            max_label_len: MAX_LABEL_LEN,
            max_reference_len: MAX_REFERENCE_LEN,
            max_allowlist_len: MAX_ALLOWLIST_LEN,
        }
    }

    pub fn get_stats(&self, token: AccountId) -> VaultStats {
        VaultStats {
            token: token.clone(),
            total_tabs: self.next_tab_id.saturating_sub(1),
            total_charges: self.total_charges,
            total_volume: U128(self.token_volume.get(&token).unwrap_or(0)),
        }
    }

    pub fn get_owner_tab_count(&self, owner: AccountId) -> u64 {
        self.owner_tabs
            .get(&owner)
            .map(|v| v.len())
            .unwrap_or(0)
    }

    pub fn version(&self) -> String {
        env!("CARGO_PKG_VERSION").to_string()
    }

    // --- Internal helpers ---

    fn reject_charge(
        &self,
        tab: &Tab,
        amount: U128,
        receiver_id: &AccountId,
        reason: ChargeRejectReason,
        reference: &str,
    ) -> PromiseOrValue<ChargeExecutionResult> {
        events::emit_event(events::EventPayload::ChargeRejected(
            events::ChargeRejectedData {
                tab_id: tab.id,
                owner: &tab.owner,
                spender: &tab.spender,
                token: &tab.token,
                amount,
                receiver_id,
                reason: reason.as_str(),
                reference,
            },
        ));
        PromiseOrValue::Value(ChargeExecutionResult::Rejected { reason })
    }
}
