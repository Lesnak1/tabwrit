use near_contract_standards::fungible_token::core::FungibleTokenCore;
use near_contract_standards::fungible_token::metadata::{
    FungibleTokenMetadata, FungibleTokenMetadataProvider, FT_METADATA_SPEC,
};
use near_contract_standards::fungible_token::FungibleToken;
use near_contract_standards::storage_management::{
    StorageBalance, StorageBalanceBounds, StorageManagement,
};
use near_sdk::json_types::U128;
use near_sdk::{
    env, near, require, AccountId, NearToken, PanicOnDefault, PromiseOrValue,
};

/// Testnet-only faucet amount: 100 tUSDC (6 decimals).
pub const FAUCET_AMOUNT: u128 = 100_000_000;

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct Contract {
    token: FungibleToken,
    owner_id: AccountId,
}

#[near]
impl Contract {
    #[init]
    pub fn new_default_meta(owner_id: AccountId, total_supply: U128) -> Self {
        require!(!env::state_exists(), "Already initialized");
        let mut this = Self {
            token: FungibleToken::new(b"a"),
            owner_id,
        };
        this.token.internal_register_account(&this.owner_id);
        this.token
            .internal_deposit(&this.owner_id, total_supply.into());
        this
    }

    /// Owner-only mint for testnet setup.
    pub fn mint(&mut self, account_id: AccountId, amount: U128) {
        require!(
            env::predecessor_account_id() == self.owner_id,
            "ERR_CALLER_NOT_OWNER"
        );
        if !self.token.accounts.contains_key(&account_id) {
            self.token.internal_register_account(&account_id);
        }
        self.token.internal_deposit(&account_id, amount.into());
    }

    /// Public testnet faucet. It mints a fixed amount to the caller so a
    /// judge can try the product without hunting for test USDC. This token
    /// has no monetary value and exists only on testnet.
    pub fn faucet(&mut self) -> U128 {
        let caller = env::predecessor_account_id();
        if !self.token.accounts.contains_key(&caller) {
            self.token.internal_register_account(&caller);
        }
        self.token.internal_deposit(&caller, FAUCET_AMOUNT);
        U128(FAUCET_AMOUNT)
    }

    pub fn owner_id(&self) -> AccountId {
        self.owner_id.clone()
    }
}

#[near]
impl FungibleTokenMetadataProvider for Contract {
    fn ft_metadata(&self) -> FungibleTokenMetadata {
        FungibleTokenMetadata {
            spec: FT_METADATA_SPEC.to_string(),
            name: "Tab Test USDC".to_string(),
            symbol: "tUSDC".to_string(),
            icon: None,
            reference: None,
            reference_hash: None,
            decimals: 6,
        }
    }
}

#[near]
impl StorageManagement for Contract {
    #[payable]
    fn storage_deposit(
        &mut self,
        account_id: Option<AccountId>,
        registration_only: Option<bool>,
    ) -> StorageBalance {
        self.token.storage_deposit(account_id, registration_only)
    }

    #[payable]
    fn storage_withdraw(&mut self, amount: Option<NearToken>) -> StorageBalance {
        self.token.storage_withdraw(amount)
    }

    #[payable]
    fn storage_unregister(&mut self, force: Option<bool>) -> bool {
        self.token.storage_unregister(force)
    }

    fn storage_balance_bounds(&self) -> StorageBalanceBounds {
        self.token.storage_balance_bounds()
    }

    fn storage_balance_of(&self, account_id: AccountId) -> Option<StorageBalance> {
        self.token.storage_balance_of(account_id)
    }
}

#[near]
impl Contract {
    #[payable]
    pub fn ft_transfer(&mut self, receiver_id: AccountId, amount: U128, memo: Option<String>) {
        self.token.ft_transfer(receiver_id, amount, memo);
    }

    #[payable]
    pub fn ft_transfer_call(
        &mut self,
        receiver_id: AccountId,
        amount: U128,
        memo: Option<String>,
        msg: String,
    ) -> PromiseOrValue<U128> {
        self.token.ft_transfer_call(receiver_id, amount, memo, msg)
    }

    pub fn ft_total_supply(&self) -> U128 {
        self.token.ft_total_supply()
    }

    pub fn ft_balance_of(&self, account_id: AccountId) -> U128 {
        self.token.ft_balance_of(account_id)
    }

    #[private]
    pub fn ft_resolve_transfer(
        &mut self,
        sender_id: AccountId,
        receiver_id: AccountId,
        amount: U128,
    ) -> U128 {
        let (used_amount, burned_amount) =
            self.token
                .internal_ft_resolve_transfer(&sender_id, receiver_id, amount);
        if burned_amount > 0 {
            env::log_str(&format!("Burned {}", burned_amount));
        }
        used_amount.into()
    }
}
