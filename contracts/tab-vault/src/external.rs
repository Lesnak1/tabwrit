use near_sdk::ext_contract;
use near_sdk::json_types::U128;
use near_sdk::{AccountId, Gas, Promise};

/// NEP-141 `ft_transfer` is cheap for standard tokens, but some tokens
/// (e.g. those with storage bookkeeping) need more. 30 Tgas leaves room.
pub const GAS_FOR_FT_TRANSFER: Gas = Gas::from_tgas(30);
/// The callback writes the tab, balance, stats and an event. 30 Tgas is
/// enough for the worst case and still leaves 40 Tgas of the 100 Tgas
/// attached to `charge` for the token call.
pub const GAS_FOR_CALLBACK: Gas = Gas::from_tgas(30);

#[ext_contract(ext_ft)]
pub trait ExtFungibleToken {
    fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) -> Promise;
}

#[ext_contract(ext_self)]
pub trait ExtSelf {
    fn on_charge_transfer_callback(
        &mut self,
        tab_id: u64,
        nonce: u64,
        amount: U128,
        receiver_id: AccountId,
        reference: String,
        charge_period_index: u64,
    ) -> crate::types::ChargeExecutionResult;

    fn on_withdraw_callback(
        &mut self,
        owner: AccountId,
        token: AccountId,
        amount: U128,
    ) -> bool;
}
