use std::collections::{BTreeMap, BTreeSet};

use near_sdk::{AccountId, Gas, NearToken, PanicOnDefault, Promise, env, json_types::U128, near};

const MIN_INTERVAL_MS: u64 = 60_000;
const MAX_INTERVAL_MS: u64 = 31_536_000_000;
const MAX_RUNS: u32 = 1_000;
const MAX_RECIPIENTS_PER_OWNER: usize = 50;
const MAX_WORKFLOWS_PER_OWNER: usize = 100;
const WITHDRAW_CALLBACK_GAS: Gas = Gas::from_tgas(5);

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorkflowState {
    Active,
    Paused,
    Completed,
    Cancelled,
}

#[near(serializers = [borsh])]
#[derive(Clone)]
pub struct Workflow {
    id: u64,
    owner_id: AccountId,
    recipient_id: AccountId,
    amount: u128,
    max_per_run: u128,
    min_reserve: u128,
    interval_ms: u64,
    next_run_at_ms: u64,
    max_runs: u32,
    runs_completed: u32,
    available_balance: u128,
    state: WorkflowState,
    config_hash: String,
    created_at_ms: u64,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct WorkflowView {
    pub id: u64,
    pub owner_id: AccountId,
    pub recipient_id: AccountId,
    pub amount: U128,
    pub max_per_run: U128,
    pub min_reserve: U128,
    pub interval_ms: u64,
    pub next_run_at_ms: u64,
    pub max_runs: u32,
    pub runs_completed: u32,
    pub available_balance: U128,
    pub state: WorkflowState,
    pub config_hash: String,
    pub created_at_ms: u64,
    pub withdrawable: U128,
}

impl From<&Workflow> for WorkflowView {
    fn from(w: &Workflow) -> Self {
        Self {
            id: w.id,
            owner_id: w.owner_id.clone(),
            recipient_id: w.recipient_id.clone(),
            amount: U128(w.amount),
            max_per_run: U128(w.max_per_run),
            min_reserve: U128(w.min_reserve),
            interval_ms: w.interval_ms,
            next_run_at_ms: w.next_run_at_ms,
            max_runs: w.max_runs,
            runs_completed: w.runs_completed,
            available_balance: U128(w.available_balance),
            state: w.state.clone(),
            config_hash: w.config_hash.clone(),
            created_at_ms: w.created_at_ms,
            withdrawable: U128(withdrawable(w)),
        }
    }
}

#[near(serializers = [json])]
pub struct CreateWorkflowArgs {
    pub recipient_id: AccountId,
    pub amount: U128,
    pub max_per_run: U128,
    pub min_reserve: U128,
    pub interval_ms: u64,
    pub start_at_ms: u64,
    pub max_runs: u32,
    pub config_hash: String,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ContractStatus {
    pub last_keeper: Option<AccountId>,
    pub owner_id: AccountId,
    pub status: String,
}

#[near(serializers = [borsh])]
struct LegacyTreasuryContract {
    last_keeper: Option<AccountId>,
    owner_id: AccountId,
    status: String,
}

#[near(contract_state)]
#[derive(PanicOnDefault)]
pub struct TreasuryContract {
    last_keeper: Option<AccountId>,
    owner_id: AccountId,
    status: String,
    next_workflow_id: u64,
    workflows: BTreeMap<u64, Workflow>,
    owner_workflows: BTreeMap<AccountId, Vec<u64>>,
    allowlists: BTreeMap<AccountId, BTreeSet<AccountId>>,
}

#[near]
impl TreasuryContract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self {
            last_keeper: None,
            owner_id,
            status: "phase-1-ready".to_owned(),
            next_workflow_id: 0,
            workflows: BTreeMap::new(),
            owner_workflows: BTreeMap::new(),
            allowlists: BTreeMap::new(),
        }
    }

    #[init(ignore_state)]
    pub fn migrate() -> Self {
        let old: LegacyTreasuryContract =
            env::state_read().unwrap_or_else(|| env::panic_str("LEGACY_STATE_REQUIRED"));
        Self {
            last_keeper: old.last_keeper,
            owner_id: old.owner_id,
            status: old.status,
            next_workflow_id: 0,
            workflows: BTreeMap::new(),
            owner_workflows: BTreeMap::new(),
            allowlists: BTreeMap::new(),
        }
    }

    pub fn get_status(&self) -> ContractStatus {
        ContractStatus {
            last_keeper: self.last_keeper.clone(),
            owner_id: self.owner_id.clone(),
            status: self.status.clone(),
        }
    }
    pub fn set_status(&mut self, status: String) {
        self.assert_contract_owner();
        assert!(!status.trim().is_empty(), "STATUS_REQUIRED");
        assert!(status.len() <= 64, "STATUS_TOO_LONG");
        self.status = status;
    }
    pub fn keeper_ping(&mut self) {
        self.last_keeper = Some(env::predecessor_account_id());
    }

    #[payable]
    pub fn add_allowed_recipient(&mut self, account_id: AccountId) {
        let owner = env::predecessor_account_id();
        let before = self.serialized_len();
        assert!(
            self.allowlists.get(&owner).map_or(0, BTreeSet::len) < MAX_RECIPIENTS_PER_OWNER,
            "RECIPIENT_LIMIT_REACHED"
        );
        assert!(
            self.allowlists
                .entry(owner.clone())
                .or_default()
                .insert(account_id.clone()),
            "RECIPIENT_ALREADY_ALLOWED"
        );
        self.refund_excess_storage_deposit(&owner, before);
        emit(
            "recipient_allowed",
            format!(r#"{{"owner_id":"{owner}","recipient_id":"{account_id}"}}"#),
        );
    }
    pub fn remove_allowed_recipient(&mut self, account_id: AccountId) {
        let owner = env::predecessor_account_id();
        let before = self.serialized_len();
        let removed = self
            .allowlists
            .get_mut(&owner)
            .is_some_and(|set| set.remove(&account_id));
        assert!(removed, "RECIPIENT_NOT_ALLOWED");
        if self.allowlists.get(&owner).is_some_and(BTreeSet::is_empty) {
            self.allowlists.remove(&owner);
        }
        self.refund_released_storage(&owner, before);
        emit(
            "recipient_removed",
            format!(r#"{{"owner_id":"{owner}","recipient_id":"{account_id}"}}"#),
        );
    }
    pub fn is_recipient_allowed(&self, owner_id: AccountId, account_id: AccountId) -> bool {
        self.allowlists
            .get(&owner_id)
            .is_some_and(|set| set.contains(&account_id))
    }

    #[payable]
    pub fn create_workflow(&mut self, args: CreateWorkflowArgs) -> u64 {
        let owner = env::predecessor_account_id();
        assert!(
            self.is_recipient_allowed(owner.clone(), args.recipient_id.clone()),
            "RECIPIENT_NOT_ALLOWED"
        );
        assert!(args.amount.0 > 0, "AMOUNT_REQUIRED");
        assert!(args.amount.0 <= args.max_per_run.0, "MAX_PER_RUN_EXCEEDED");
        assert!(
            (MIN_INTERVAL_MS..=MAX_INTERVAL_MS).contains(&args.interval_ms),
            "INVALID_INTERVAL"
        );
        assert!((1..=MAX_RUNS).contains(&args.max_runs), "INVALID_MAX_RUNS");
        assert!(
            args.start_at_ms >= env::block_timestamp_ms(),
            "INVALID_START_TIME"
        );
        assert!(
            !args.config_hash.trim().is_empty() && args.config_hash.len() <= 128,
            "INVALID_CONFIG_HASH"
        );
        assert!(
            self.owner_workflows.get(&owner).map_or(0, Vec::len) < MAX_WORKFLOWS_PER_OWNER,
            "WORKFLOW_LIMIT_REACHED"
        );
        let before = self.serialized_len();
        let id = self.next_workflow_id;
        self.next_workflow_id = self
            .next_workflow_id
            .checked_add(1)
            .expect("WORKFLOW_ID_OVERFLOW");
        self.workflows.insert(
            id,
            Workflow {
                id,
                owner_id: owner.clone(),
                recipient_id: args.recipient_id,
                amount: args.amount.0,
                max_per_run: args.max_per_run.0,
                min_reserve: args.min_reserve.0,
                interval_ms: args.interval_ms,
                next_run_at_ms: args.start_at_ms,
                max_runs: args.max_runs,
                runs_completed: 0,
                available_balance: 0,
                state: WorkflowState::Active,
                config_hash: args.config_hash,
                created_at_ms: env::block_timestamp_ms(),
            },
        );
        self.owner_workflows
            .entry(owner.clone())
            .or_default()
            .push(id);
        let cost = self.storage_cost_since(before);
        let deposit = env::attached_deposit().as_yoctonear();
        assert!(deposit >= cost, "INSUFFICIENT_STORAGE_DEPOSIT");
        self.workflows
            .get_mut(&id)
            .expect("WORKFLOW_NOT_FOUND")
            .available_balance = deposit - cost;
        emit(
            "workflow_created",
            format!(r#"{{"workflow_id":{id},"owner_id":"{owner}"}}"#),
        );
        id
    }

    #[payable]
    pub fn fund_workflow(&mut self, workflow_id: u64) {
        let deposit = env::attached_deposit().as_yoctonear();
        assert!(deposit > 0, "DEPOSIT_REQUIRED");
        let workflow = self.owned_workflow_mut(workflow_id);
        workflow.available_balance = workflow
            .available_balance
            .checked_add(deposit)
            .expect("BALANCE_OVERFLOW");
        emit(
            "workflow_funded",
            format!(r#"{{"workflow_id":{workflow_id},"amount":"{deposit}"}}"#),
        );
    }
    pub fn pause_workflow(&mut self, workflow_id: u64) {
        let w = self.owned_workflow_mut(workflow_id);
        assert_eq!(w.state, WorkflowState::Active, "INVALID_TRANSITION");
        w.state = WorkflowState::Paused;
        emit(
            "workflow_paused",
            format!(r#"{{"workflow_id":{workflow_id}}}"#),
        );
    }
    pub fn resume_workflow(&mut self, workflow_id: u64) {
        let w = self.owned_workflow_mut(workflow_id);
        assert_eq!(w.state, WorkflowState::Paused, "INVALID_TRANSITION");
        w.state = WorkflowState::Active;
        emit(
            "workflow_resumed",
            format!(r#"{{"workflow_id":{workflow_id}}}"#),
        );
    }
    pub fn cancel_workflow(&mut self, workflow_id: u64) {
        let w = self.owned_workflow_mut(workflow_id);
        assert!(
            matches!(w.state, WorkflowState::Active | WorkflowState::Paused),
            "INVALID_TRANSITION"
        );
        w.state = WorkflowState::Cancelled;
        emit(
            "workflow_cancelled",
            format!(r#"{{"workflow_id":{workflow_id}}}"#),
        );
    }
    pub fn withdraw_available(&mut self, workflow_id: u64, amount: U128) -> Promise {
        assert!(amount.0 > 0, "AMOUNT_REQUIRED");
        let owner = env::predecessor_account_id();
        let w = self.owned_workflow_mut(workflow_id);
        assert!(amount.0 <= withdrawable(w), "WITHDRAWAL_EXCEEDS_AVAILABLE");
        w.available_balance -= amount.0;
        emit(
            "workflow_withdrawn",
            format!(r#"{{"workflow_id":{workflow_id},"amount":"{}"}}"#, amount.0),
        );
        Promise::new(owner)
            .transfer(NearToken::from_yoctonear(amount.0))
            .then(
                Self::ext_self()
                    .with_static_gas(WITHDRAW_CALLBACK_GAS)
                    .on_withdraw_complete(workflow_id, amount),
            )
    }

    #[private]
    pub fn on_withdraw_complete(&mut self, workflow_id: u64, amount: U128) -> bool {
        assert_eq!(env::promise_results_count(), 1, "INVALID_PROMISE_RESULTS");
        if env::promise_result_checked(0, 0).is_ok() {
            return true;
        }

        let workflow = self
            .workflows
            .get_mut(&workflow_id)
            .expect("WORKFLOW_NOT_FOUND");
        workflow.available_balance = workflow
            .available_balance
            .checked_add(amount.0)
            .expect("BALANCE_OVERFLOW");
        emit(
            "workflow_withdrawal_failed",
            format!(r#"{{"workflow_id":{workflow_id},"amount":"{}"}}"#, amount.0),
        );
        false
    }

    pub fn get_workflow(&self, workflow_id: u64) -> Option<WorkflowView> {
        self.workflows.get(&workflow_id).map(WorkflowView::from)
    }
    pub fn get_withdrawable(&self, workflow_id: u64) -> U128 {
        U128(self.workflows.get(&workflow_id).map_or(0, withdrawable))
    }
    pub fn list_owner_workflows(
        &self,
        owner_id: AccountId,
        cursor: Option<u64>,
        limit: Option<u32>,
    ) -> Vec<WorkflowView> {
        self.owner_workflows
            .get(&owner_id)
            .into_iter()
            .flatten()
            .skip(cursor.unwrap_or(0) as usize)
            .take(limit.unwrap_or(20).min(50) as usize)
            .filter_map(|id| self.workflows.get(id))
            .map(WorkflowView::from)
            .collect()
    }

    fn assert_contract_owner(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            self.owner_id,
            "OWNER_REQUIRED"
        );
    }
    fn owned_workflow_mut(&mut self, id: u64) -> &mut Workflow {
        let predecessor = env::predecessor_account_id();
        let w = self.workflows.get_mut(&id).expect("WORKFLOW_NOT_FOUND");
        assert_eq!(predecessor, w.owner_id, "OWNER_REQUIRED");
        w
    }
    fn serialized_len(&self) -> u64 {
        near_sdk::borsh::to_vec(self)
            .unwrap_or_else(|_| env::panic_str("STATE_SERIALIZATION_FAILED"))
            .len() as u64
    }
    fn storage_cost_since(&self, before: u64) -> u128 {
        u128::from(self.serialized_len().saturating_sub(before))
            .saturating_mul(env::storage_byte_cost().as_yoctonear())
    }
    fn refund_excess_storage_deposit(&self, owner: &AccountId, before: u64) {
        let cost = self.storage_cost_since(before);
        let deposit = env::attached_deposit().as_yoctonear();
        assert!(deposit >= cost, "INSUFFICIENT_STORAGE_DEPOSIT");
        let excess = deposit - cost;
        if excess > 0 {
            Promise::new(owner.clone())
                .transfer(NearToken::from_yoctonear(excess))
                .detach();
        }
    }
    fn refund_released_storage(&self, owner: &AccountId, before: u64) {
        let released_bytes = before.saturating_sub(self.serialized_len());
        let refund =
            u128::from(released_bytes).saturating_mul(env::storage_byte_cost().as_yoctonear());
        if refund > 0 {
            Promise::new(owner.clone())
                .transfer(NearToken::from_yoctonear(refund))
                .detach();
        }
    }
}

fn withdrawable(w: &Workflow) -> u128 {
    if matches!(w.state, WorkflowState::Cancelled | WorkflowState::Completed) {
        return w.available_balance;
    }
    let locked = w
        .amount
        .saturating_mul(u128::from(w.max_runs - w.runs_completed))
        .saturating_add(w.min_reserve);
    w.available_balance.saturating_sub(locked)
}
fn emit(event: &str, data: String) {
    env::log_str(&format!(
        r#"EVENT_JSON:{{"standard":"auvora","version":"1.0.0","event":"{event}","data":[{data}]}}"#
    ));
}

#[cfg(test)]
mod tests {
    use super::*;
    use near_sdk::{
        NearToken, PromiseResult, RuntimeFeesConfig, VMContext,
        mock::MockAction,
        test_utils::{VMContextBuilder, get_created_receipts},
        testing_env,
    };
    use std::collections::HashMap;
    fn account(v: &str) -> AccountId {
        v.parse().unwrap()
    }
    fn context(predecessor: &str, deposit: u128) -> VMContext {
        VMContextBuilder::new()
            .current_account_id(account("contract.testnet"))
            .predecessor_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(1_700_000_000_000_000_000)
            .build()
    }
    fn args() -> CreateWorkflowArgs {
        CreateWorkflowArgs {
            recipient_id: account("recipient.testnet"),
            amount: U128(10),
            max_per_run: U128(10),
            min_reserve: U128(5),
            interval_ms: 60_000,
            start_at_ms: 1_700_000_100_000,
            max_runs: 2,
            config_hash: "abc123".to_owned(),
        }
    }
    fn setup() -> TreasuryContract {
        testing_env!(context("owner.testnet", 10u128.pow(24)));
        let mut c = TreasuryContract::new(account("admin.testnet"));
        c.add_allowed_recipient(account("recipient.testnet"));
        c
    }

    #[test]
    fn migrates_the_live_phase_zero_state_layout() {
        testing_env!(context("oceanear.testnet", 0));
        env::state_write(&LegacyTreasuryContract {
            last_keeper: Some(account("oceankeeper.testnet")),
            owner_id: account("oceanear.testnet"),
            status: "wallet-proof-confirmed".to_owned(),
        });
        let c = TreasuryContract::migrate();
        assert_eq!(c.owner_id, account("oceanear.testnet"));
        assert_eq!(c.last_keeper, Some(account("oceankeeper.testnet")));
        assert_eq!(c.status, "wallet-proof-confirmed");
        assert_eq!(c.next_workflow_id, 0);
    }
    fn create_with_deposit(c: &mut TreasuryContract, deposit: u128) -> u64 {
        testing_env!(context("owner.testnet", deposit));
        c.create_workflow(args())
    }
    #[test]
    fn creates_funds_and_segregates_ledgers() {
        let mut c = setup();
        testing_env!(context("owner.testnet", 10u128.pow(24)));
        let first = c.create_workflow(args());
        testing_env!(context("owner.testnet", 2 * 10u128.pow(24)));
        let second = c.create_workflow(args());
        let a = c.get_workflow(first).unwrap().available_balance.0;
        let b = c.get_workflow(second).unwrap().available_balance.0;
        testing_env!(context("owner.testnet", 100));
        c.fund_workflow(first);
        assert_eq!(c.get_workflow(first).unwrap().available_balance.0, a + 100);
        assert_eq!(c.get_workflow(second).unwrap().available_balance.0, b);
    }
    #[test]
    #[should_panic(expected = "RECIPIENT_NOT_ALLOWED")]
    fn rejects_non_allowlisted_recipient() {
        testing_env!(context("owner.testnet", 10u128.pow(24)));
        let mut c = TreasuryContract::new(account("admin.testnet"));
        c.create_workflow(args());
    }
    #[test]
    fn withdrawal_unlocks_after_cancel() {
        let mut c = setup();
        testing_env!(context("owner.testnet", 10u128.pow(24)));
        let id = c.create_workflow(args());
        let balance = c.get_workflow(id).unwrap().available_balance.0;
        assert_eq!(c.get_withdrawable(id).0, balance.saturating_sub(25));
        c.cancel_workflow(id);
        assert_eq!(c.get_withdrawable(id).0, balance);
    }
    #[test]
    fn lifecycle_transitions() {
        let mut c = setup();
        testing_env!(context("owner.testnet", 10u128.pow(24)));
        let id = c.create_workflow(args());
        c.pause_workflow(id);
        assert_eq!(c.get_workflow(id).unwrap().state, WorkflowState::Paused);
        c.resume_workflow(id);
        c.cancel_workflow(id);
        assert_eq!(c.get_workflow(id).unwrap().state, WorkflowState::Cancelled);
    }
    #[test]
    #[should_panic(expected = "MAX_PER_RUN_EXCEEDED")]
    fn rejects_amount_above_limit() {
        let mut c = setup();
        testing_env!(context("owner.testnet", 10u128.pow(24)));
        let mut a = args();
        a.max_per_run = U128(9);
        c.create_workflow(a);
    }

    #[test]
    #[should_panic(expected = "OWNER_REQUIRED")]
    fn rejects_non_owner_mutation() {
        let mut c = setup();
        let id = create_with_deposit(&mut c, 10u128.pow(24));
        testing_env!(context("attacker.testnet", 0));
        c.pause_workflow(id);
    }

    #[test]
    #[should_panic(expected = "INVALID_INTERVAL")]
    fn rejects_invalid_interval() {
        let mut c = setup();
        testing_env!(context("owner.testnet", 10u128.pow(24)));
        let mut a = args();
        a.interval_ms = MIN_INTERVAL_MS - 1;
        c.create_workflow(a);
    }

    #[test]
    #[should_panic(expected = "INVALID_MAX_RUNS")]
    fn rejects_invalid_max_runs() {
        let mut c = setup();
        testing_env!(context("owner.testnet", 10u128.pow(24)));
        let mut a = args();
        a.max_runs = 0;
        c.create_workflow(a);
    }

    #[test]
    #[should_panic(expected = "AMOUNT_REQUIRED")]
    fn rejects_zero_amount() {
        let mut c = setup();
        testing_env!(context("owner.testnet", 10u128.pow(24)));
        let mut a = args();
        a.amount = U128(0);
        c.create_workflow(a);
    }

    #[test]
    #[should_panic(expected = "INVALID_START_TIME")]
    fn rejects_start_time_in_the_past() {
        let mut c = setup();
        testing_env!(context("owner.testnet", 10u128.pow(24)));
        let mut a = args();
        a.start_at_ms = 1_699_999_999_999;
        c.create_workflow(a);
    }

    #[test]
    fn storage_cost_is_deducted_and_excess_becomes_workflow_balance() {
        let mut c = setup();
        let before = c.serialized_len();
        let deposit = 10u128.pow(24);
        let id = create_with_deposit(&mut c, deposit);
        let expected_cost =
            u128::from(c.serialized_len() - before) * env::storage_byte_cost().as_yoctonear();
        assert_eq!(
            c.get_workflow(id).unwrap().available_balance.0,
            deposit - expected_cost
        );
    }

    #[test]
    #[should_panic(expected = "INSUFFICIENT_STORAGE_DEPOSIT")]
    fn rejects_storage_underpayment() {
        let mut c = setup();
        create_with_deposit(&mut c, 1);
    }

    #[test]
    fn allowlist_storage_excess_is_refunded() {
        testing_env!(context("owner.testnet", 10u128.pow(24)));
        let mut c = TreasuryContract::new(account("admin.testnet"));
        let before = c.serialized_len();
        let deposit = 10u128.pow(24);
        c.add_allowed_recipient(account("recipient.testnet"));
        let cost =
            u128::from(c.serialized_len() - before) * env::storage_byte_cost().as_yoctonear();
        let refund = deposit - cost;
        assert!(get_created_receipts().iter().any(|receipt| {
            receipt.receiver_id == account("owner.testnet")
                && receipt.actions.iter().any(|action| {
                    matches!(action, MockAction::Transfer { deposit, .. } if deposit.as_yoctonear() == refund)
                })
        }));
    }

    #[test]
    fn withdrawal_boundaries_are_exact_to_one_yocto() {
        let mut c = setup();
        let id = create_with_deposit(&mut c, 10u128.pow(24));
        let w = c.workflows.get_mut(&id).unwrap();
        let locked = w.amount * u128::from(w.max_runs - w.runs_completed) + w.min_reserve;
        w.available_balance = locked;
        assert_eq!(c.get_withdrawable(id), U128(0));
        c.workflows.get_mut(&id).unwrap().available_balance += 1;
        assert_eq!(c.get_withdrawable(id), U128(1));
        let _withdrawal = c.withdraw_available(id, U128(1));
        assert_eq!(c.get_withdrawable(id), U128(0));
    }

    #[test]
    fn completed_workflow_unlocks_its_full_ledger() {
        let mut c = setup();
        let id = create_with_deposit(&mut c, 10u128.pow(24));
        let w = c.workflows.get_mut(&id).unwrap();
        w.state = WorkflowState::Completed;
        w.runs_completed = w.max_runs;
        let available_balance = w.available_balance;
        assert_eq!(c.get_withdrawable(id).0, available_balance);
    }

    #[test]
    fn failed_withdrawal_restores_the_workflow_ledger() {
        let mut c = setup();
        let id = create_with_deposit(&mut c, 10u128.pow(24));
        c.cancel_workflow(id);
        let before = c.get_workflow(id).unwrap().available_balance.0;
        let _withdrawal = c.withdraw_available(id, U128(1));
        assert_eq!(c.get_workflow(id).unwrap().available_balance.0, before - 1);

        testing_env!(
            context("contract.testnet", 0),
            near_sdk::test_vm_config(),
            RuntimeFeesConfig::test(),
            HashMap::default(),
            vec![PromiseResult::Failed],
        );
        assert!(!c.on_withdraw_complete(id, U128(1)));
        assert_eq!(c.get_workflow(id).unwrap().available_balance.0, before);
    }

    #[test]
    #[should_panic(expected = "INVALID_TRANSITION")]
    fn cancelled_workflow_cannot_resume() {
        let mut c = setup();
        let id = create_with_deposit(&mut c, 10u128.pow(24));
        c.cancel_workflow(id);
        c.resume_workflow(id);
    }
}
