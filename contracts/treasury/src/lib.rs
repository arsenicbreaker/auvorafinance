use std::collections::{BTreeMap, BTreeSet};

use near_sdk::{
    AccountId, Gas, NearToken, PanicOnDefault, Promise, PromiseOrValue, env, json_types::U128, near,
};

const MIN_INTERVAL_MS: u64 = 60_000;
const MAX_INTERVAL_MS: u64 = 31_536_000_000;
const MAX_RUNS: u32 = 1_000;
const MAX_RECIPIENTS_PER_OWNER: usize = 50;
const MAX_WORKFLOWS_PER_OWNER: usize = 100;
const WITHDRAW_CALLBACK_GAS: Gas = Gas::from_tgas(5);
const EXECUTION_CALLBACK_GAS: Gas = Gas::from_tgas(10);

const REASON_NOT_DUE: &str = "NOT_DUE";
const REASON_PAUSED: &str = "PAUSED";
const REASON_INACTIVE: &str = "INACTIVE";
const REASON_RECIPIENT_NOT_ALLOWED: &str = "RECIPIENT_NOT_ALLOWED";
const REASON_RESERVE_GUARD: &str = "RESERVE_GUARD";
const REASON_ALREADY_DISPATCHED: &str = "ALREADY_DISPATCHED";
const REASON_TRANSFER_FAILED: &str = "TRANSFER_FAILED";
const REASON_CALLBACK_ALREADY_RESOLVED: &str = "CALLBACK_ALREADY_RESOLVED";

#[near(serializers = [borsh, json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum WorkflowState {
    Active,
    Paused,
    Completed,
    Cancelled,
}

#[near(serializers = [borsh])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingExecution {
    run_index: u32,
    scheduled_for_ms: u64,
    amount: u128,
    dispatched_at_ms: u64,
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
    pending_execution: Option<PendingExecution>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PendingExecutionView {
    pub run_index: u32,
    pub scheduled_for_ms: u64,
    pub amount: U128,
    pub dispatched_at_ms: u64,
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
    pub pending_execution: Option<PendingExecutionView>,
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
            pending_execution: w
                .pending_execution
                .as_ref()
                .map(|pending| PendingExecutionView {
                    run_index: pending.run_index,
                    scheduled_for_ms: pending.scheduled_for_ms,
                    amount: U128(pending.amount),
                    dispatched_at_ms: pending.dispatched_at_ms,
                }),
        }
    }
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum ExecutionStatus {
    Dispatched,
    Skipped,
    Succeeded,
    Failed,
    Ignored,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct ExecutionOutcome {
    pub workflow_id: u64,
    pub run_index: u32,
    pub scheduled_for_ms: u64,
    pub amount: U128,
    pub status: ExecutionStatus,
    pub reason_code: Option<String>,
}

#[near(serializers = [json])]
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct AccountingView {
    pub total_available_liability: U128,
    pub total_pending_liability: U128,
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

#[near(serializers = [borsh])]
struct PhaseOneWorkflow {
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

#[near(serializers = [borsh])]
struct PhaseOneTreasuryContract {
    last_keeper: Option<AccountId>,
    owner_id: AccountId,
    status: String,
    next_workflow_id: u64,
    workflows: BTreeMap<u64, PhaseOneWorkflow>,
    owner_workflows: BTreeMap<AccountId, Vec<u64>>,
    allowlists: BTreeMap<AccountId, BTreeSet<AccountId>>,
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
    total_available_liability: u128,
    total_pending_liability: u128,
}

#[near]
impl TreasuryContract {
    #[init]
    pub fn new(owner_id: AccountId) -> Self {
        Self {
            last_keeper: None,
            owner_id,
            status: "phase-2-ready".to_owned(),
            next_workflow_id: 0,
            workflows: BTreeMap::new(),
            owner_workflows: BTreeMap::new(),
            allowlists: BTreeMap::new(),
            total_available_liability: 0,
            total_pending_liability: 0,
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
            total_available_liability: 0,
            total_pending_liability: 0,
        }
    }

    #[init(ignore_state)]
    pub fn migrate_phase_2() -> Self {
        let old: PhaseOneTreasuryContract =
            env::state_read().unwrap_or_else(|| env::panic_str("PHASE_ONE_STATE_REQUIRED"));
        let mut total_available_liability = 0u128;
        let workflows = old
            .workflows
            .into_iter()
            .map(|(id, workflow)| {
                total_available_liability = total_available_liability
                    .checked_add(workflow.available_balance)
                    .expect("BALANCE_OVERFLOW");
                (
                    id,
                    Workflow {
                        id: workflow.id,
                        owner_id: workflow.owner_id,
                        recipient_id: workflow.recipient_id,
                        amount: workflow.amount,
                        max_per_run: workflow.max_per_run,
                        min_reserve: workflow.min_reserve,
                        interval_ms: workflow.interval_ms,
                        next_run_at_ms: workflow.next_run_at_ms,
                        max_runs: workflow.max_runs,
                        runs_completed: workflow.runs_completed,
                        available_balance: workflow.available_balance,
                        state: workflow.state,
                        config_hash: workflow.config_hash,
                        created_at_ms: workflow.created_at_ms,
                        pending_execution: None,
                    },
                )
            })
            .collect();
        Self {
            last_keeper: old.last_keeper,
            owner_id: old.owner_id,
            status: old.status,
            next_workflow_id: old.next_workflow_id,
            workflows,
            owner_workflows: old.owner_workflows,
            allowlists: old.allowlists,
            total_available_liability,
            total_pending_liability: 0,
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
            args.interval_ms
                .checked_mul(u64::from(args.max_runs))
                .and_then(|duration| args.start_at_ms.checked_add(duration))
                .is_some(),
            "SCHEDULE_OVERFLOW"
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
                pending_execution: None,
            },
        );
        self.owner_workflows
            .entry(owner.clone())
            .or_default()
            .push(id);
        let cost = self.storage_cost_since(before);
        let deposit = env::attached_deposit().as_yoctonear();
        assert!(deposit >= cost, "INSUFFICIENT_STORAGE_DEPOSIT");
        let workflow_balance = deposit - cost;
        self.workflows
            .get_mut(&id)
            .expect("WORKFLOW_NOT_FOUND")
            .available_balance = workflow_balance;
        self.total_available_liability = self
            .total_available_liability
            .checked_add(workflow_balance)
            .expect("BALANCE_OVERFLOW");
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
        self.total_available_liability = self
            .total_available_liability
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
        self.total_available_liability -= amount.0;
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
        self.assert_private_callback();
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
        self.total_available_liability = self
            .total_available_liability
            .checked_add(amount.0)
            .expect("BALANCE_OVERFLOW");
        emit(
            "workflow_withdrawal_failed",
            format!(r#"{{"workflow_id":{workflow_id},"amount":"{}"}}"#, amount.0),
        );
        false
    }

    pub fn execute_due(&mut self, workflow_id: u64) -> PromiseOrValue<ExecutionOutcome> {
        let now_ms = env::block_timestamp_ms();
        let workflow = self
            .workflows
            .get(&workflow_id)
            .expect("WORKFLOW_NOT_FOUND");

        if workflow.pending_execution.is_some() {
            return PromiseOrValue::Value(skipped_execution(workflow, REASON_ALREADY_DISPATCHED));
        }
        if workflow.state == WorkflowState::Paused {
            return PromiseOrValue::Value(skipped_execution(workflow, REASON_PAUSED));
        }
        if workflow.state != WorkflowState::Active {
            return PromiseOrValue::Value(skipped_execution(workflow, REASON_INACTIVE));
        }
        if now_ms < workflow.next_run_at_ms {
            return PromiseOrValue::Value(skipped_execution(workflow, REASON_NOT_DUE));
        }
        if !self.is_recipient_allowed(workflow.owner_id.clone(), workflow.recipient_id.clone()) {
            return PromiseOrValue::Value(skipped_execution(
                workflow,
                REASON_RECIPIENT_NOT_ALLOWED,
            ));
        }
        let required = workflow
            .amount
            .checked_add(workflow.min_reserve)
            .expect("BALANCE_OVERFLOW");
        if workflow.available_balance < required {
            return PromiseOrValue::Value(skipped_execution(workflow, REASON_RESERVE_GUARD));
        }
        self.assert_global_solvency();

        let run_index = workflow.runs_completed;
        let scheduled_for_ms = workflow.next_run_at_ms;
        let amount = workflow.amount;
        let recipient_id = workflow.recipient_id.clone();
        let pending = PendingExecution {
            run_index,
            scheduled_for_ms,
            amount,
            dispatched_at_ms: now_ms,
        };
        let workflow = self
            .workflows
            .get_mut(&workflow_id)
            .expect("WORKFLOW_NOT_FOUND");
        workflow.available_balance -= amount;
        workflow.pending_execution = Some(pending);
        self.total_available_liability -= amount;
        self.total_pending_liability = self
            .total_pending_liability
            .checked_add(amount)
            .expect("BALANCE_OVERFLOW");
        self.last_keeper = Some(env::predecessor_account_id());
        emit(
            "execution_dispatched",
            execution_event_data(workflow_id, run_index, scheduled_for_ms, amount, None),
        );

        PromiseOrValue::Promise(
            Promise::new(recipient_id)
                .transfer(NearToken::from_yoctonear(amount))
                .then(
                    Self::ext_self()
                        .with_static_gas(EXECUTION_CALLBACK_GAS)
                        .on_execution_complete(
                            workflow_id,
                            run_index,
                            scheduled_for_ms,
                            U128(amount),
                        ),
                ),
        )
    }

    #[private]
    pub fn on_execution_complete(
        &mut self,
        workflow_id: u64,
        run_index: u32,
        scheduled_for_ms: u64,
        amount: U128,
    ) -> ExecutionOutcome {
        self.assert_private_callback();
        assert_eq!(env::promise_results_count(), 1, "INVALID_PROMISE_RESULTS");
        let matches_pending = self
            .workflows
            .get(&workflow_id)
            .and_then(|workflow| workflow.pending_execution.as_ref())
            .is_some_and(|pending| {
                pending.run_index == run_index
                    && pending.scheduled_for_ms == scheduled_for_ms
                    && pending.amount == amount.0
            });
        if !matches_pending {
            return ExecutionOutcome {
                workflow_id,
                run_index,
                scheduled_for_ms,
                amount,
                status: ExecutionStatus::Ignored,
                reason_code: Some(REASON_CALLBACK_ALREADY_RESOLVED.to_owned()),
            };
        }

        self.total_pending_liability -= amount.0;
        let succeeded = env::promise_result_checked(0, 0).is_ok();
        let workflow = self
            .workflows
            .get_mut(&workflow_id)
            .expect("WORKFLOW_NOT_FOUND");
        workflow.pending_execution = None;
        if succeeded {
            workflow.runs_completed = workflow
                .runs_completed
                .checked_add(1)
                .expect("RUN_COUNT_OVERFLOW");
            if workflow.runs_completed == workflow.max_runs {
                if workflow.state != WorkflowState::Cancelled {
                    workflow.state = WorkflowState::Completed;
                }
            } else {
                workflow.next_run_at_ms = env::block_timestamp_ms()
                    .max(scheduled_for_ms)
                    .checked_add(workflow.interval_ms)
                    .expect("SCHEDULE_OVERFLOW");
            }
            emit(
                "execution_succeeded",
                execution_event_data(workflow_id, run_index, scheduled_for_ms, amount.0, None),
            );
            return ExecutionOutcome {
                workflow_id,
                run_index,
                scheduled_for_ms,
                amount,
                status: ExecutionStatus::Succeeded,
                reason_code: None,
            };
        }

        workflow.available_balance = workflow
            .available_balance
            .checked_add(amount.0)
            .expect("BALANCE_OVERFLOW");
        self.total_available_liability = self
            .total_available_liability
            .checked_add(amount.0)
            .expect("BALANCE_OVERFLOW");
        emit(
            "execution_failed",
            execution_event_data(
                workflow_id,
                run_index,
                scheduled_for_ms,
                amount.0,
                Some(REASON_TRANSFER_FAILED),
            ),
        );
        ExecutionOutcome {
            workflow_id,
            run_index,
            scheduled_for_ms,
            amount,
            status: ExecutionStatus::Failed,
            reason_code: Some(REASON_TRANSFER_FAILED.to_owned()),
        }
    }

    pub fn get_workflow(&self, workflow_id: u64) -> Option<WorkflowView> {
        self.workflows.get(&workflow_id).map(WorkflowView::from)
    }
    pub fn get_withdrawable(&self, workflow_id: u64) -> U128 {
        U128(self.workflows.get(&workflow_id).map_or(0, withdrawable))
    }
    pub fn get_accounting(&self) -> AccountingView {
        AccountingView {
            total_available_liability: U128(self.total_available_liability),
            total_pending_liability: U128(self.total_pending_liability),
        }
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
    fn assert_private_callback(&self) {
        assert_eq!(
            env::predecessor_account_id(),
            env::current_account_id(),
            "PRIVATE_CALLBACK"
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
    fn assert_global_solvency(&self) {
        let storage_stake = u128::from(env::storage_usage())
            .saturating_mul(env::storage_byte_cost().as_yoctonear());
        let liquid_balance = env::account_balance()
            .as_yoctonear()
            .saturating_sub(storage_stake);
        let liabilities = self
            .total_available_liability
            .checked_add(self.total_pending_liability)
            .expect("BALANCE_OVERFLOW");
        assert!(liquid_balance >= liabilities, "CONTRACT_INSOLVENT");
    }
}

fn withdrawable(w: &Workflow) -> u128 {
    if matches!(w.state, WorkflowState::Cancelled | WorkflowState::Completed) {
        return w.available_balance;
    }
    let pending_runs = u32::from(w.pending_execution.is_some());
    let remaining_runs = w
        .max_runs
        .saturating_sub(w.runs_completed)
        .saturating_sub(pending_runs);
    let locked = w
        .amount
        .saturating_mul(u128::from(remaining_runs))
        .saturating_add(w.min_reserve);
    w.available_balance.saturating_sub(locked)
}

fn skipped_execution(workflow: &Workflow, reason_code: &str) -> ExecutionOutcome {
    let outcome = ExecutionOutcome {
        workflow_id: workflow.id,
        run_index: workflow.runs_completed,
        scheduled_for_ms: workflow.next_run_at_ms,
        amount: U128(workflow.amount),
        status: ExecutionStatus::Skipped,
        reason_code: Some(reason_code.to_owned()),
    };
    emit(
        "execution_skipped",
        execution_event_data(
            outcome.workflow_id,
            outcome.run_index,
            outcome.scheduled_for_ms,
            outcome.amount.0,
            Some(reason_code),
        ),
    );
    outcome
}

fn execution_event_data(
    workflow_id: u64,
    run_index: u32,
    scheduled_for_ms: u64,
    amount: u128,
    reason_code: Option<&str>,
) -> String {
    let reason =
        reason_code.map_or_else(String::new, |code| format!(",\"reason_code\":\"{code}\""));
    format!(
        r#"{{"workflow_id":{workflow_id},"run_index":{run_index},"scheduled_for_ms":{scheduled_for_ms},"amount":"{amount}"{reason}}}"#
    )
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
        test_utils::{VMContextBuilder, get_created_receipts, get_logs},
        testing_env,
    };
    use std::collections::HashMap;
    fn account(v: &str) -> AccountId {
        v.parse().unwrap()
    }
    fn context(predecessor: &str, deposit: u128) -> VMContext {
        context_at(predecessor, deposit, 1_700_000_000_000)
    }
    fn context_at(predecessor: &str, deposit: u128, block_timestamp_ms: u64) -> VMContext {
        VMContextBuilder::new()
            .current_account_id(account("contract.testnet"))
            .predecessor_account_id(account(predecessor))
            .attached_deposit(NearToken::from_yoctonear(deposit))
            .block_timestamp(block_timestamp_ms * 1_000_000)
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
    fn due_workflow(balance: u128) -> (TreasuryContract, u64) {
        let mut c = setup();
        let id = create_with_deposit(&mut c, 10u128.pow(24));
        let old_balance = c.workflows.get(&id).unwrap().available_balance;
        c.workflows.get_mut(&id).unwrap().available_balance = balance;
        c.total_available_liability = c.total_available_liability - old_balance + balance;
        (c, id)
    }
    fn callback_context(result: PromiseResult, block_timestamp_ms: u64) {
        testing_env!(
            context_at("contract.testnet", 0, block_timestamp_ms),
            near_sdk::test_vm_config(),
            RuntimeFeesConfig::test(),
            HashMap::default(),
            vec![result],
        );
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

    #[test]
    fn migrates_phase_one_workflows_and_rebuilds_liability() {
        testing_env!(context("oceanear.testnet", 0));
        let workflow = PhaseOneWorkflow {
            id: 7,
            owner_id: account("oceanear.testnet"),
            recipient_id: account("recipient.testnet"),
            amount: 10,
            max_per_run: 10,
            min_reserve: 5,
            interval_ms: MIN_INTERVAL_MS,
            next_run_at_ms: 1_700_000_100_000,
            max_runs: 2,
            runs_completed: 0,
            available_balance: 123,
            state: WorkflowState::Active,
            config_hash: "phase-one".to_owned(),
            created_at_ms: 1_700_000_000_000,
        };
        env::state_write(&PhaseOneTreasuryContract {
            last_keeper: Some(account("oceankeeper.testnet")),
            owner_id: account("oceanear.testnet"),
            status: "phase-1-ready".to_owned(),
            next_workflow_id: 8,
            workflows: BTreeMap::from([(7, workflow)]),
            owner_workflows: BTreeMap::from([(account("oceanear.testnet"), vec![7])]),
            allowlists: BTreeMap::from([(
                account("oceanear.testnet"),
                BTreeSet::from([account("recipient.testnet")]),
            )]),
        });

        let c = TreasuryContract::migrate_phase_2();
        assert_eq!(c.total_available_liability, 123);
        assert_eq!(c.total_pending_liability, 0);
        assert!(c.workflows.get(&7).unwrap().pending_execution.is_none());
        assert_eq!(c.next_workflow_id, 8);
    }

    #[test]
    fn before_due_execution_is_skipped_without_mutation() {
        let (mut c, id) = due_workflow(100);
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_050_000));
        let before = c.get_workflow(id).unwrap();
        let PromiseOrValue::Value(outcome) = c.execute_due(id) else {
            panic!("expected a skip outcome");
        };
        assert_eq!(outcome.reason_code.as_deref(), Some(REASON_NOT_DUE));
        assert_eq!(c.get_workflow(id).unwrap(), before);
    }

    #[test]
    fn dispatch_debits_available_and_reserves_one_slot() {
        let (mut c, id) = due_workflow(100);
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        assert!(matches!(c.execute_due(id), PromiseOrValue::Promise(_)));
        let workflow = c.get_workflow(id).unwrap();
        assert_eq!(workflow.available_balance, U128(90));
        assert_eq!(workflow.pending_execution.unwrap().amount, U128(10));
        assert_eq!(c.total_available_liability, 90);
        assert_eq!(c.total_pending_liability, 10);
        assert_eq!(c.last_keeper, Some(account("keeper.testnet")));
    }

    #[test]
    fn duplicate_trigger_cannot_dispatch_the_same_slot_twice() {
        let (mut c, id) = due_workflow(100);
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        assert!(matches!(c.execute_due(id), PromiseOrValue::Promise(_)));
        let receipts_after_first = get_created_receipts().len();
        let PromiseOrValue::Value(second) = c.execute_due(id) else {
            panic!("duplicate dispatch created a promise");
        };
        assert_eq!(
            second.reason_code.as_deref(),
            Some(REASON_ALREADY_DISPATCHED)
        );
        assert_eq!(get_created_receipts().len(), receipts_after_first);
        assert_eq!(c.total_pending_liability, 10);
    }

    #[test]
    fn successful_callback_advances_once_and_replay_is_ignored() {
        let (mut c, id) = due_workflow(100);
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        assert!(matches!(c.execute_due(id), PromiseOrValue::Promise(_)));
        callback_context(PromiseResult::Successful(vec![]), 1_700_000_300_000);
        let success = c.on_execution_complete(id, 0, 1_700_000_100_000, U128(10));
        assert_eq!(success.status, ExecutionStatus::Succeeded);
        let workflow = c.get_workflow(id).unwrap();
        assert_eq!(workflow.runs_completed, 1);
        assert_eq!(workflow.next_run_at_ms, 1_700_000_360_000);
        assert!(workflow.pending_execution.is_none());
        assert_eq!(c.total_pending_liability, 0);

        let replay = c.on_execution_complete(id, 0, 1_700_000_100_000, U128(10));
        assert_eq!(replay.status, ExecutionStatus::Ignored);
        assert_eq!(c.get_workflow(id).unwrap().runs_completed, 1);
    }

    #[test]
    fn failed_callback_restores_ledger_and_same_slot_is_retryable() {
        let (mut c, id) = due_workflow(100);
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        assert!(matches!(c.execute_due(id), PromiseOrValue::Promise(_)));
        callback_context(PromiseResult::Failed, 1_700_000_300_000);
        let failure = c.on_execution_complete(id, 0, 1_700_000_100_000, U128(10));
        assert_eq!(failure.status, ExecutionStatus::Failed);
        let workflow = c.get_workflow(id).unwrap();
        assert_eq!(workflow.available_balance, U128(100));
        assert_eq!(workflow.runs_completed, 0);
        assert_eq!(workflow.next_run_at_ms, 1_700_000_100_000);
        assert!(workflow.pending_execution.is_none());
        assert_eq!(c.total_available_liability, 100);
        assert_eq!(c.total_pending_liability, 0);

        testing_env!(context_at("keeper.testnet", 0, 1_700_000_310_000));
        assert!(matches!(c.execute_due(id), PromiseOrValue::Promise(_)));
        assert_eq!(
            c.get_workflow(id)
                .unwrap()
                .pending_execution
                .unwrap()
                .scheduled_for_ms,
            1_700_000_100_000
        );
    }

    #[test]
    fn failed_callback_replay_does_not_restore_the_ledger_twice() {
        let (mut c, id) = due_workflow(100);
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        assert!(matches!(c.execute_due(id), PromiseOrValue::Promise(_)));
        callback_context(PromiseResult::Failed, 1_700_000_300_000);
        let first = c.on_execution_complete(id, 0, 1_700_000_100_000, U128(10));
        assert_eq!(first.status, ExecutionStatus::Failed);
        let replay = c.on_execution_complete(id, 0, 1_700_000_100_000, U128(10));
        assert_eq!(replay.status, ExecutionStatus::Ignored);
        assert_eq!(
            replay.reason_code.as_deref(),
            Some(REASON_CALLBACK_ALREADY_RESOLVED)
        );
        assert_eq!(c.get_workflow(id).unwrap().available_balance, U128(100));
        assert_eq!(c.total_available_liability, 100);
        assert_eq!(c.total_pending_liability, 0);
    }

    #[test]
    fn successful_late_run_schedules_from_confirmation_time_without_catch_up() {
        let (mut c, id) = due_workflow(100);
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        assert!(matches!(c.execute_due(id), PromiseOrValue::Promise(_)));
        callback_context(PromiseResult::Successful(vec![]), 1_700_001_000_000);
        c.on_execution_complete(id, 0, 1_700_000_100_000, U128(10));
        assert_eq!(
            c.get_workflow(id).unwrap().next_run_at_ms,
            1_700_001_060_000
        );
    }

    #[test]
    fn reserve_guard_is_exact_to_one_yocto() {
        let (mut exact, exact_id) = due_workflow(15);
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        assert!(matches!(
            exact.execute_due(exact_id),
            PromiseOrValue::Promise(_)
        ));
        assert_eq!(
            exact.get_workflow(exact_id).unwrap().available_balance,
            U128(5)
        );

        let (mut below, below_id) = due_workflow(14);
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        let PromiseOrValue::Value(outcome) = below.execute_due(below_id) else {
            panic!("reserve guard did not skip");
        };
        assert_eq!(outcome.reason_code.as_deref(), Some(REASON_RESERVE_GUARD));
        assert_eq!(
            below.get_workflow(below_id).unwrap().available_balance,
            U128(14)
        );
        assert!(
            get_logs()
                .iter()
                .any(|log| log.contains(REASON_RESERVE_GUARD))
        );
    }

    #[test]
    fn paused_cancelled_and_removed_recipient_are_not_dispatched() {
        let (mut paused, paused_id) = due_workflow(100);
        testing_env!(context_at("owner.testnet", 0, 1_700_000_200_000));
        paused.pause_workflow(paused_id);
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        let PromiseOrValue::Value(outcome) = paused.execute_due(paused_id) else {
            panic!("paused workflow dispatched");
        };
        assert_eq!(outcome.reason_code.as_deref(), Some(REASON_PAUSED));

        testing_env!(context_at("owner.testnet", 0, 1_700_000_200_000));
        paused.cancel_workflow(paused_id);
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        let PromiseOrValue::Value(outcome) = paused.execute_due(paused_id) else {
            panic!("cancelled workflow dispatched");
        };
        assert_eq!(outcome.reason_code.as_deref(), Some(REASON_INACTIVE));

        let (mut removed, removed_id) = due_workflow(100);
        testing_env!(context_at("owner.testnet", 0, 1_700_000_200_000));
        removed.remove_allowed_recipient(account("recipient.testnet"));
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        let PromiseOrValue::Value(outcome) = removed.execute_due(removed_id) else {
            panic!("removed recipient dispatched");
        };
        assert_eq!(
            outcome.reason_code.as_deref(),
            Some(REASON_RECIPIENT_NOT_ALLOWED)
        );
    }

    #[test]
    fn final_success_completes_workflow() {
        let (mut c, id) = due_workflow(15);
        c.workflows.get_mut(&id).unwrap().max_runs = 1;
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        assert!(matches!(c.execute_due(id), PromiseOrValue::Promise(_)));
        callback_context(PromiseResult::Successful(vec![]), 1_700_000_300_000);
        c.on_execution_complete(id, 0, 1_700_000_100_000, U128(10));
        let workflow = c.get_workflow(id).unwrap();
        assert_eq!(workflow.state, WorkflowState::Completed);
        assert_eq!(workflow.runs_completed, 1);
        assert_eq!(workflow.withdrawable, workflow.available_balance);
    }

    #[test]
    fn cancel_during_pending_keeps_cancelled_state_after_success() {
        let (mut c, id) = due_workflow(100);
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        assert!(matches!(c.execute_due(id), PromiseOrValue::Promise(_)));
        testing_env!(context_at("owner.testnet", 0, 1_700_000_250_000));
        c.cancel_workflow(id);
        assert_eq!(c.get_workflow(id).unwrap().withdrawable, U128(90));

        callback_context(PromiseResult::Successful(vec![]), 1_700_000_300_000);
        c.on_execution_complete(id, 0, 1_700_000_100_000, U128(10));
        let workflow = c.get_workflow(id).unwrap();
        assert_eq!(workflow.state, WorkflowState::Cancelled);
        assert_eq!(workflow.runs_completed, 1);
        assert_eq!(workflow.withdrawable, U128(90));
    }

    #[test]
    #[should_panic(expected = "PRIVATE_CALLBACK")]
    fn direct_external_callback_is_rejected() {
        let (mut c, id) = due_workflow(100);
        testing_env!(context_at("keeper.testnet", 0, 1_700_000_200_000));
        assert!(matches!(c.execute_due(id), PromiseOrValue::Promise(_)));
        testing_env!(
            context_at("attacker.testnet", 0, 1_700_000_300_000),
            near_sdk::test_vm_config(),
            RuntimeFeesConfig::test(),
            HashMap::default(),
            vec![PromiseResult::Successful(vec![])],
        );
        c.on_execution_complete(id, 0, 1_700_000_100_000, U128(10));
    }
}
