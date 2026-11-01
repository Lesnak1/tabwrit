#[cfg(test)]
mod tests {
    use crate::types::{ChargeExecutionResult, ChargeRejectReason, ReceiverPolicy, TabStatus};
    use crate::{TabVault, MAX_LABEL_LEN, MIN_TAB_STORAGE};
    use near_sdk::json_types::U128;
    use near_sdk::test_utils::VMContextBuilder;
    use near_sdk::{testing_env, AccountId, NearToken, PromiseResult};

    fn alice() -> AccountId {
        "alice.near".parse().unwrap()
    }

    fn bob_spender() -> AccountId {
        "bob_spender.near".parse().unwrap()
    }

    fn charlie_merchant() -> AccountId {
        "charlie_merchant.near".parse().unwrap()
    }

    fn usdc_token() -> AccountId {
        "usdc.near".parse().unwrap()
    }

    fn fake_token() -> AccountId {
        "fake.near".parse().unwrap()
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

    #[allow(deprecated)]
    fn set_callback_context(promise_result: PromiseResult) {
        let mut builder = VMContextBuilder::new();
        builder
            .current_account_id(contract_id())
            .signer_account_id(contract_id())
            .predecessor_account_id(contract_id())
            .account_balance(NearToken::from_near(100));
        near_sdk::test_utils::testing_env_with_promise_results(builder.build(), promise_result);
    }

    fn setup_contract() -> TabVault {
        set_context(&contract_id(), 1_000_000_000_000_000_000, NearToken::from_yoctonear(0));
        TabVault::new(vec![usdc_token()])
    }

    fn deposit(vault: &mut TabVault, amount: u128) {
        set_context(&usdc_token(), 1_000_000_000_000_000_000, NearToken::from_yoctonear(0));
        let refund = vault.ft_on_transfer(alice(), U128(amount), "".to_string());
        match refund {
            near_sdk::PromiseOrValue::Value(unused) => assert_eq!(unused.0, 0),
            _ => panic!("Expected Value with 0 unused"),
        }
    }

    fn create_tab(vault: &mut TabVault, now_ns: u64, policy: ReceiverPolicy) -> u64 {
        set_context(&alice(), now_ns, MIN_TAB_STORAGE);
        vault.create_tab(
            bob_spender(),
            usdc_token(),
            U128(10_000_000),
            U128(25_000_000),
            U128(50_000_000),
            86400,
            now_ns + 30 * 86400 * 1_000_000_000,
            policy,
            "Monthly Subscription".to_string(),
        )
    }

    #[test]
    fn test_conservation_and_deposit_refund() {
        let mut vault = setup_contract();

        // Unallowlisted token deposits are returned in full.
        set_context(&fake_token(), 1_000_000_000_000_000_000, NearToken::from_yoctonear(0));
        let refund = vault.ft_on_transfer(alice(), U128(1_000_000), "".to_string());
        match refund {
            near_sdk::PromiseOrValue::Value(unused) => assert_eq!(unused.0, 1_000_000),
            _ => panic!("Expected Value with full refund"),
        }
        assert_eq!(vault.get_balance(alice(), fake_token()).0, 0);

        // Allowlisted token deposit is credited exactly once.
        deposit(&mut vault, 10_000_000);
        assert_eq!(vault.get_balance(alice(), usdc_token()).0, 10_000_000);
    }

    #[test]
    fn test_tab_lifecycle_and_caps() {
        let mut vault = setup_contract();
        deposit(&mut vault, 100_000_000);

        let now_ns = 1_000_000_000_000_000_000u64;
        let tab_id = create_tab(
            &mut vault,
            now_ns,
            ReceiverPolicy::Allowlist(vec![charlie_merchant()]),
        );
        assert_eq!(tab_id, 1);
        assert_eq!(vault.get_tab(1).unwrap().status, TabStatus::Active);
        assert_eq!(vault.get_tab(1).unwrap().next_nonce, 0);

        // S1: legitimate charge
        set_context(&bob_spender(), now_ns, NearToken::from_yoctonear(0));
        let res = vault.charge(
            1,
            U128(10_000_000),
            charlie_merchant(),
            "inv-1".to_string(),
            0,
        );
        assert!(matches!(res, near_sdk::PromiseOrValue::Promise(_)));
        assert_eq!(vault.get_balance(alice(), usdc_token()).0, 90_000_000);
        let tab = vault.get_tab(1).unwrap();
        assert_eq!(tab.spent_in_period.0, 10_000_000);
        assert_eq!(tab.spent_total.0, 10_000_000);
        assert_eq!(tab.charge_count, 1);
        assert_eq!(tab.next_nonce, 1);

        // S2: per-charge cap
        let res = vault.charge(
            1,
            U128(15_000_000),
            charlie_merchant(),
            "inv-2".to_string(),
            1,
        );
        match res {
            near_sdk::PromiseOrValue::Value(ChargeExecutionResult::Rejected { reason }) => {
                assert_eq!(reason, ChargeRejectReason::PerChargeCap);
            }
            _ => panic!("Expected per-charge rejection"),
        }
        // A rejected request must not consume the nonce.
        assert_eq!(vault.get_tab(1).unwrap().next_nonce, 1);

        // S4: receiver not allowlisted
        let eve: AccountId = "eve.near".parse().unwrap();
        let res = vault.charge(1, U128(5_000_000), eve, "inv-evil".to_string(), 1);
        match res {
            near_sdk::PromiseOrValue::Value(ChargeExecutionResult::Rejected { reason }) => {
                assert_eq!(reason, ChargeRejectReason::ReceiverNotAllowed);
            }
            _ => panic!("Expected receiver rejection"),
        }

        // Second valid charge, then period cap.
        let _ = vault.charge(
            1,
            U128(10_000_000),
            charlie_merchant(),
            "inv-3".to_string(),
            1,
        );
        assert_eq!(vault.get_tab(1).unwrap().spent_in_period.0, 20_000_000);

        let res = vault.charge(
            1,
            U128(10_000_000),
            charlie_merchant(),
            "inv-4".to_string(),
            2,
        );
        match res {
            near_sdk::PromiseOrValue::Value(ChargeExecutionResult::Rejected { reason }) => {
                assert_eq!(reason, ChargeRejectReason::PeriodCap);
            }
            _ => panic!("Expected period cap rejection"),
        }

        // S9: period rollover
        set_context(
            &bob_spender(),
            now_ns + 86400 * 1_000_000_000 + 1,
            NearToken::from_yoctonear(0),
        );
        let remaining = vault.get_remaining(1).unwrap();
        assert_eq!(remaining.remaining_in_period.0, 25_000_000);
        assert_eq!(remaining.current_period_index, 1);

        let res = vault.charge(
            1,
            U128(10_000_000),
            charlie_merchant(),
            "inv-5".to_string(),
            2,
        );
        assert!(matches!(res, near_sdk::PromiseOrValue::Promise(_)));
        let tab = vault.get_tab(1).unwrap();
        assert_eq!(tab.spent_in_period.0, 10_000_000);
        assert_eq!(tab.spent_total.0, 30_000_000);
    }

    #[test]
    fn test_pause_resume_revoke() {
        let mut vault = setup_contract();
        deposit(&mut vault, 100_000_000);

        let now_ns = 1_000_000_000_000_000_000u64;
        create_tab(&mut vault, now_ns, ReceiverPolicy::Any);

        set_context(&alice(), now_ns, NearToken::from_yoctonear(0));
        vault.pause_tab(1);
        assert_eq!(vault.get_tab(1).unwrap().status, TabStatus::Paused);

        set_context(&bob_spender(), now_ns, NearToken::from_yoctonear(0));
        let res = vault.charge(
            1,
            U128(5_000_000),
            charlie_merchant(),
            "inv".to_string(),
            0,
        );
        match res {
            near_sdk::PromiseOrValue::Value(ChargeExecutionResult::Rejected { reason }) => {
                assert_eq!(reason, ChargeRejectReason::TabNotActive);
            }
            _ => panic!("Expected TAB_NOT_ACTIVE"),
        }

        set_context(&alice(), now_ns, NearToken::from_yoctonear(0));
        vault.resume_tab(1);
        assert_eq!(vault.get_tab(1).unwrap().status, TabStatus::Active);

        set_context(&bob_spender(), now_ns, NearToken::from_yoctonear(0));
        let res = vault.charge(
            1,
            U128(5_000_000),
            charlie_merchant(),
            "inv".to_string(),
            0,
        );
        assert!(matches!(res, near_sdk::PromiseOrValue::Promise(_)));

        set_context(&alice(), now_ns, NearToken::from_yoctonear(0));
        vault.revoke_tab(1);
        assert_eq!(vault.get_tab(1).unwrap().status, TabStatus::Revoked);

        set_context(&bob_spender(), now_ns, NearToken::from_yoctonear(0));
        let res = vault.charge(
            1,
            U128(5_000_000),
            charlie_merchant(),
            "inv".to_string(),
            1,
        );
        match res {
            near_sdk::PromiseOrValue::Value(ChargeExecutionResult::Rejected { reason }) => {
                assert_eq!(reason, ChargeRejectReason::TabNotActive);
            }
            _ => panic!("Expected TAB_NOT_ACTIVE"),
        }
    }

    #[test]
    fn test_expired_tab_rejected() {
        let mut vault = setup_contract();
        deposit(&mut vault, 100_000_000);

        let now_ns = 1_000_000_000_000_000_000u64;
        let expires_ns = now_ns + 3600 * 1_000_000_000;
        set_context(&alice(), now_ns, MIN_TAB_STORAGE);
        vault.create_tab(
            bob_spender(),
            usdc_token(),
            U128(10_000_000),
            U128(20_000_000),
            U128(50_000_000),
            86400,
            expires_ns,
            ReceiverPolicy::Any,
            "Expiring Tab".to_string(),
        );

        set_context(
            &bob_spender(),
            expires_ns + 10,
            NearToken::from_yoctonear(0),
        );
        let res = vault.charge(
            1,
            U128(5_000_000),
            charlie_merchant(),
            "inv".to_string(),
            0,
        );
        match res {
            near_sdk::PromiseOrValue::Value(ChargeExecutionResult::Rejected { reason }) => {
                assert_eq!(reason, ChargeRejectReason::TabExpired);
            }
            _ => panic!("Expected TAB_EXPIRED"),
        }
    }

    #[test]
    #[should_panic(expected = "ERR_CALLER_NOT_SPENDER")]
    fn test_unauthorized_spender_panics() {
        let mut vault = setup_contract();
        deposit(&mut vault, 100_000_000);

        let now_ns = 1_000_000_000_000_000_000u64;
        create_tab(&mut vault, now_ns, ReceiverPolicy::Any);

        let eve: AccountId = "eve.near".parse().unwrap();
        set_context(&eve, now_ns, NearToken::from_yoctonear(0));
        let _ = vault.charge(
            1,
            U128(5_000_000),
            charlie_merchant(),
            "inv".to_string(),
            0,
        );
    }

    #[test]
    fn test_insufficient_balance_rejected() {
        let mut vault = setup_contract();
        deposit(&mut vault, 5_000_000);

        let now_ns = 1_000_000_000_000_000_000u64;
        create_tab(&mut vault, now_ns, ReceiverPolicy::Any);

        set_context(&bob_spender(), now_ns, NearToken::from_yoctonear(0));
        let res = vault.charge(
            1,
            U128(10_000_000),
            charlie_merchant(),
            "inv".to_string(),
            0,
        );
        match res {
            near_sdk::PromiseOrValue::Value(ChargeExecutionResult::Rejected { reason }) => {
                assert_eq!(reason, ChargeRejectReason::InsufficientBalance);
            }
            _ => panic!("Expected INSUFFICIENT_BALANCE"),
        }
    }

    #[test]
    #[should_panic(expected = "ERR_STORAGE_DEPOSIT_REQUIRED")]
    fn test_create_tab_requires_storage_deposit() {
        let mut vault = setup_contract();
        let now_ns = 1_000_000_000_000_000_000u64;
        set_context(&alice(), now_ns, NearToken::from_yoctonear(0));
        vault.create_tab(
            bob_spender(),
            usdc_token(),
            U128(10_000_000),
            U128(25_000_000),
            U128(50_000_000),
            86400,
            now_ns + 86400 * 1_000_000_000,
            ReceiverPolicy::Any,
            "No storage".to_string(),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_LABEL_TOO_LONG")]
    fn test_create_tab_label_limit() {
        let mut vault = setup_contract();
        let now_ns = 1_000_000_000_000_000_000u64;
        set_context(&alice(), now_ns, MIN_TAB_STORAGE);
        vault.create_tab(
            bob_spender(),
            usdc_token(),
            U128(10_000_000),
            U128(25_000_000),
            U128(50_000_000),
            86400,
            now_ns + 86400 * 1_000_000_000,
            ReceiverPolicy::Any,
            "x".repeat((MAX_LABEL_LEN + 1) as usize),
        );
    }

    #[test]
    #[should_panic(expected = "ERR_NONCE_MISMATCH")]
    fn test_nonce_replay_rejected() {
        let mut vault = setup_contract();
        deposit(&mut vault, 100_000_000);
        let now_ns = 1_000_000_000_000_000_000u64;
        create_tab(&mut vault, now_ns, ReceiverPolicy::Any);

        set_context(&bob_spender(), now_ns, NearToken::from_yoctonear(0));
        let _ = vault.charge(
            1,
            U128(5_000_000),
            charlie_merchant(),
            "inv-1".to_string(),
            0,
        );
        // Replaying nonce 0 must panic before any state change.
        let _ = vault.charge(
            1,
            U128(5_000_000),
            charlie_merchant(),
            "inv-1".to_string(),
            0,
        );
    }

    #[test]
    fn test_success_callback_updates_stats_once() {
        let mut vault = setup_contract();
        deposit(&mut vault, 100_000_000);
        let now_ns = 1_000_000_000_000_000_000u64;
        create_tab(&mut vault, now_ns, ReceiverPolicy::Any);

        set_context(&bob_spender(), now_ns, NearToken::from_yoctonear(0));
        let _ = vault.charge(
            1,
            U128(10_000_000),
            charlie_merchant(),
            "inv-1".to_string(),
            0,
        );

        set_callback_context(PromiseResult::Successful(vec![]));
        let result = vault.on_charge_transfer_callback(
            1,
            0,
            U128(10_000_000),
            charlie_merchant(),
            "inv-1".to_string(),
            0,
        );
        match result {
            ChargeExecutionResult::Executed { amount, nonce } => {
                assert_eq!(amount.0, 10_000_000);
                assert_eq!(nonce, 0);
            }
            other => panic!("Expected Executed, got {:?}", other),
        }

        let stats = vault.get_stats(usdc_token());
        assert_eq!(stats.total_charges, 1);
        assert_eq!(stats.total_volume.0, 10_000_000);
        assert_eq!(stats.total_tabs, 1);
    }

    #[test]
    fn test_interleaved_charge_rollback_preserves_later_charge() {
        let mut vault = setup_contract();
        deposit(&mut vault, 100_000_000);
        let now_ns = 1_000_000_000_000_000_000u64;
        create_tab(&mut vault, now_ns, ReceiverPolicy::Any);

        // Charge A (nonce 0) and charge B (nonce 1) are both in flight.
        set_context(&bob_spender(), now_ns, NearToken::from_yoctonear(0));
        let _ = vault.charge(
            1,
            U128(10_000_000),
            charlie_merchant(),
            "inv-a".to_string(),
            0,
        );
        let _ = vault.charge(
            1,
            U128(10_000_000),
            charlie_merchant(),
            "inv-b".to_string(),
            1,
        );
        assert_eq!(vault.get_tab(1).unwrap().spent_in_period.0, 20_000_000);
        assert_eq!(vault.get_balance(alice(), usdc_token()).0, 80_000_000);

        // A fails. B's accounting must survive. A's nonce is NOT rewound
        // because B is newer, so the spender must continue from nonce 2.
        set_callback_context(PromiseResult::Failed);
        let result = vault.on_charge_transfer_callback(
            1,
            0,
            U128(10_000_000),
            charlie_merchant(),
            "inv-a".to_string(),
            0,
        );
        assert!(matches!(result, ChargeExecutionResult::Failed { .. }));
        let tab = vault.get_tab(1).unwrap();
        assert_eq!(tab.spent_in_period.0, 10_000_000);
        assert_eq!(tab.spent_total.0, 10_000_000);
        assert_eq!(tab.charge_count, 1);
        assert_eq!(tab.next_nonce, 2);
        assert_eq!(vault.get_balance(alice(), usdc_token()).0, 90_000_000);

        // B succeeds.
        set_callback_context(PromiseResult::Successful(vec![]));
        let result = vault.on_charge_transfer_callback(
            1,
            1,
            U128(10_000_000),
            charlie_merchant(),
            "inv-b".to_string(),
            0,
        );
        assert!(matches!(result, ChargeExecutionResult::Executed { .. }));
        assert_eq!(vault.get_balance(alice(), usdc_token()).0, 90_000_000);
        assert_eq!(vault.get_tab(1).unwrap().spent_in_period.0, 10_000_000);
        assert_eq!(vault.get_stats(usdc_token()).total_volume.0, 10_000_000);
    }

    #[test]
    fn test_withdraw_callback_rollback() {
        let mut vault = setup_contract();
        deposit(&mut vault, 50_000_000);

        set_context(&alice(), 1_000_000_000_000_000_000, NearToken::from_yoctonear(0));
        let _ = vault.withdraw(usdc_token(), U128(20_000_000));
        assert_eq!(vault.get_balance(alice(), usdc_token()).0, 30_000_000);

        set_callback_context(PromiseResult::Failed);
        let ok = vault.on_withdraw_callback(alice(), usdc_token(), U128(20_000_000));
        assert!(!ok);
        assert_eq!(vault.get_balance(alice(), usdc_token()).0, 50_000_000);
    }

    #[test]
    fn test_events_are_nep297_envelopes() {
        let mut vault = setup_contract();
        deposit(&mut vault, 10_000_000);
        let logs = near_sdk::test_utils::get_logs();
        assert!(logs.iter().any(|l| l.starts_with("EVENT_JSON:")));
        let deposit_log = logs
            .iter()
            .find(|l| l.contains("\"event\":\"deposit\""))
            .expect("deposit event");
        assert!(deposit_log.contains("\"standard\":\"tab\""));
        assert!(deposit_log.contains("\"version\":\"1.0.0\""));
    }

    #[test]
    fn test_config_and_stats() {
        let mut vault = setup_contract();
        let config = vault.get_config();
        assert_eq!(config.allowed_tokens, vec![usdc_token()]);
        assert_eq!(config.min_tab_storage_yocto.0, MIN_TAB_STORAGE.as_yoctonear());
        assert_eq!(config.max_tabs_per_owner, 100);

        let stats = vault.get_stats(usdc_token());
        assert_eq!(stats.total_tabs, 0);
        assert_eq!(stats.total_charges, 0);
        assert_eq!(stats.total_volume.0, 0);

        deposit(&mut vault, 1_000_000);
        let now_ns = 1_000_000_000_000_000_000u64;
        create_tab(&mut vault, now_ns, ReceiverPolicy::Any);
        assert_eq!(vault.get_owner_tab_count(alice()), 1);
        assert_eq!(vault.get_stats(usdc_token()).total_tabs, 1);
    }
}
