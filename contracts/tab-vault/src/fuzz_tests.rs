#[cfg(test)]
mod fuzz {
    use crate::types::{ChargeExecutionResult, ChargeRejectReason, ReceiverPolicy};
    use crate::{TabVault, MIN_TAB_STORAGE};
    use near_sdk::json_types::U128;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, AccountId, NearToken};

    /// Fast, deterministic, zero-dependency PRNG (SplitMix64).
    struct SplitMix64(u64);

    impl SplitMix64 {
        fn new(seed: u64) -> Self {
            Self(seed)
        }

        fn next_u64(&mut self) -> u64 {
            self.0 = self.0.wrapping_add(0x9e3779b97f4a7c15);
            let mut z = self.0;
            z = (z ^ (z >> 30)).wrapping_mul(0xbf58476d1ce4e5b9);
            z = (z ^ (z >> 27)).wrapping_mul(0x94d049bb133111eb);
            z ^ (z >> 31)
        }

        fn gen_range(&mut self, min: u64, max: u64) -> u64 {
            if min >= max {
                return min;
            }
            min + (self.next_u64() % (max - min + 1))
        }

        fn gen_bool(&mut self) -> bool {
            (self.next_u64() & 1) == 1
        }
    }

    fn alice() -> AccountId {
        "alice.near".parse().unwrap()
    }

    fn bob_spender() -> AccountId {
        "bob_spender.near".parse().unwrap()
    }

    fn merchant() -> AccountId {
        "merchant.near".parse().unwrap()
    }

    fn attacker() -> AccountId {
        "attacker.near".parse().unwrap()
    }

    fn usdc() -> AccountId {
        "usdc.near".parse().unwrap()
    }

    fn contract_id() -> AccountId {
        "vault.near".parse().unwrap()
    }

    fn set_context(caller: &AccountId, timestamp_ns: u64, deposit: NearToken) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(contract_id())
            .signer_account_id(caller.clone())
            .predecessor_account_id(caller.clone())
            .block_timestamp(timestamp_ns)
            .account_balance(NearToken::from_near(100))
            .attached_deposit(deposit);
        testing_env!(builder.build());
    }

    #[test]
    fn test_fuzz_monotonic_cap_invariants() {
        let mut rng = SplitMix64::new(0x42_DECAF_CAFE);
        set_context(&contract_id(), 1_000_000_000_000_000_000, NearToken::from_yoctonear(0));
        let mut vault = TabVault::new(vec![usdc()]);

        // Fund the owner with 1,000,000 USDC (6 decimals).
        set_context(&usdc(), 1_000_000_000_000_000_000, NearToken::from_yoctonear(0));
        let _ = vault.ft_on_transfer(alice(), U128(1_000_000_000_000), "".to_string());

        let base_time_ns = 1_700_000_000_000_000_000u64;

        // 10 tabs x 100 randomized charge attempts. This is a real in-VM
        // property test of the Rust contract, not a TypeScript model.
        for tab_iter in 1..=10 {
            let per_charge_cap: u128 = rng.gen_range(10_000, 100_000) as u128;
            let per_period_cap: u128 = per_charge_cap * (rng.gen_range(2, 5) as u128);
            let total_cap: u128 = per_period_cap * (rng.gen_range(2, 6) as u128);
            let period_secs = rng.gen_range(3600, 86400);
            let duration_days = rng.gen_range(10, 60);
            let expires_ns = base_time_ns + duration_days * 86400 * 1_000_000_000;

            set_context(&alice(), base_time_ns, MIN_TAB_STORAGE);
            let tab_id = vault.create_tab(
                bob_spender(),
                usdc(),
                U128(per_charge_cap),
                U128(per_period_cap),
                U128(total_cap),
                period_secs,
                expires_ns,
                ReceiverPolicy::Allowlist(vec![merchant()]),
                format!("Fuzz Tab #{}", tab_iter),
            );

            let mut current_time_ns = base_time_ns;
            let mut expected_spent_total: u128 = 0;
            let mut expected_period_index: u64 = 0;
            let mut expected_spent_in_period: u128 = 0;
            let mut nonce: u64 = 0;

            for _step in 0..100 {
                let time_jump_ns = rng.gen_range(0, 48 * 3600) * 1_000_000_000;
                current_time_ns += time_jump_ns;

                let receiver = if rng.gen_range(0, 100) < 80 {
                    merchant()
                } else {
                    attacker()
                };

                let amount_u128: u128 = match rng.gen_range(0, 2) {
                    0 => rng.gen_range(1, per_charge_cap as u64) as u128,
                    1 => per_charge_cap + (rng.gen_range(1, per_charge_cap as u64) as u128),
                    _ => {
                        if rng.gen_bool() {
                            per_charge_cap
                        } else {
                            total_cap - expected_spent_total + 1
                        }
                    }
                };

                if amount_u128 == 0 {
                    continue;
                }

                let is_expired = current_time_ns >= expires_ns;
                let is_receiver_allowed = receiver == merchant();
                let is_per_charge_ok = amount_u128 <= per_charge_cap;

                let period_ns = (period_secs as u128) * 1_000_000_000;
                let active_period_index =
                    ((current_time_ns.saturating_sub(base_time_ns)) as u128 / period_ns) as u64;

                let effective_spent_in_period = if active_period_index > expected_period_index {
                    0
                } else {
                    expected_spent_in_period
                };

                let is_period_cap_ok = effective_spent_in_period + amount_u128 <= per_period_cap;
                let is_total_cap_ok = expected_spent_total + amount_u128 <= total_cap;
                let current_balance = vault.get_balance(alice(), usdc()).0;
                let is_balance_ok = current_balance >= amount_u128;

                let should_succeed = is_per_charge_ok
                    && is_receiver_allowed
                    && !is_expired
                    && is_period_cap_ok
                    && is_total_cap_ok
                    && is_balance_ok;

                set_context(&bob_spender(), current_time_ns, NearToken::from_yoctonear(0));
                let res = vault.charge(
                    tab_id,
                    U128(amount_u128),
                    receiver.clone(),
                    "fuzz".into(),
                    nonce,
                );

                if should_succeed {
                    assert!(
                        matches!(res, near_sdk::PromiseOrValue::Promise(_)),
                        "Expected successful promise for legitimate charge"
                    );
                    nonce += 1;
                    expected_period_index = active_period_index;
                    expected_spent_in_period = effective_spent_in_period + amount_u128;
                    expected_spent_total += amount_u128;

                    let tab_after = vault.get_tab(tab_id).unwrap();
                    assert_eq!(tab_after.spent_total.0, expected_spent_total);
                    assert_eq!(tab_after.spent_in_period.0, expected_spent_in_period);
                    assert!(tab_after.spent_in_period.0 <= per_period_cap);
                    assert!(tab_after.spent_total.0 <= total_cap);
                } else {
                    match res {
                        near_sdk::PromiseOrValue::Value(
                            ChargeExecutionResult::Rejected { reason },
                        ) => {
                            if is_expired {
                                assert_eq!(reason, ChargeRejectReason::TabExpired);
                            } else if !is_per_charge_ok {
                                assert_eq!(reason, ChargeRejectReason::PerChargeCap);
                            } else if !is_receiver_allowed {
                                assert_eq!(reason, ChargeRejectReason::ReceiverNotAllowed);
                            } else if !is_period_cap_ok {
                                assert_eq!(reason, ChargeRejectReason::PeriodCap);
                            } else if !is_total_cap_ok {
                                assert_eq!(reason, ChargeRejectReason::TotalCap);
                            } else if !is_balance_ok {
                                assert_eq!(reason, ChargeRejectReason::InsufficientBalance);
                            }
                        }
                        _ => panic!("Expected Rejected result when invariants are violated"),
                    }
                }
            }
        }
    }

    #[test]
    fn test_fuzz_conservation_of_funds_under_arbitrary_stress() {
        let mut rng = SplitMix64::new(0xDEAD_BEEF_CAFE);
        set_context(&contract_id(), 1_000_000_000_000_000_000, NearToken::from_yoctonear(0));
        let mut vault = TabVault::new(vec![usdc()]);

        let mut total_deposited: u128 = 0;
        let mut total_spent: u128 = 0;

        // The per-owner tab limit is 100, so this test uses 90 single-use
        // tabs. It is still a real in-VM stress test of ledger conservation.
        for op in 0..90 {
            if rng.gen_bool() {
                let deposit_amount = rng.gen_range(100, 100_000) as u128;
                set_context(&usdc(), 1_000_000_000_000_000_000, NearToken::from_yoctonear(0));
                let _ = vault.ft_on_transfer(alice(), U128(deposit_amount), "".to_string());
                total_deposited += deposit_amount;
            }

            let balance = vault.get_balance(alice(), usdc()).0;
            if balance > 100 {
                let charge_amount = rng.gen_range(1, balance as u64) as u128;
                let now_ns = 1_000_000_000u64 + (op as u64) * 1000;

                set_context(&alice(), now_ns, MIN_TAB_STORAGE);
                let tab_id = vault.create_tab(
                    bob_spender(),
                    usdc(),
                    U128(charge_amount),
                    U128(charge_amount),
                    U128(charge_amount),
                    3600,
                    now_ns + 3600 * 1_000_000_000,
                    ReceiverPolicy::Any,
                    "Stress Tab".to_string(),
                );

                set_context(&bob_spender(), now_ns, NearToken::from_yoctonear(0));
                let res = vault.charge(
                    tab_id,
                    U128(charge_amount),
                    merchant(),
                    format!("ref-{}", op),
                    0,
                );
                assert!(matches!(res, near_sdk::PromiseOrValue::Promise(_)));
                total_spent += charge_amount;
            }

            let current_balance = vault.get_balance(alice(), usdc()).0;
            assert_eq!(
                current_balance + total_spent,
                total_deposited,
                "Conservation of ledger balance violated at step {}: balance ({}) + spent ({}) != deposited ({})",
                op,
                current_balance,
                total_spent,
                total_deposited
            );
        }
    }
}
