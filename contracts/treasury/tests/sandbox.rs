#![cfg(target_os = "linux")]

use anyhow::Result;
use near_workspaces::types::{Gas, NearToken};
use serde_json::{Value, json};

const ONE_MILLI_NEAR: u128 = 10u128.pow(21);

async fn advance_until_due(
    worker: &near_workspaces::Worker<near_workspaces::network::Sandbox>,
    due_at_ms: u64,
) -> Result<()> {
    for _ in 0..10 {
        let now_ms = worker.view_block().await?.header().timestamp_nanosec() / 1_000_000;
        if now_ms >= due_at_ms {
            return Ok(());
        }
        worker.fast_forward(600).await?;
    }
    anyhow::bail!("Sandbox timestamp did not reach workflow due time");
}

#[tokio::test]
async fn verifies_dispatch_lifecycle_and_failed_transfer_accounting() -> Result<()> {
    let project_directory = env!("CARGO_MANIFEST_DIR");
    let wasm = near_workspaces::compile_project(project_directory).await?;
    let worker = near_workspaces::sandbox().await?;
    let contract = worker.dev_deploy(&wasm).await?;
    let recipient = worker.dev_create_account().await?;
    let keeper = worker.dev_create_account().await?;
    let second_keeper = worker.dev_create_account().await?;

    contract
        .call("new")
        .args_json(json!({ "owner_id": contract.id() }))
        .transact()
        .await?
        .into_result()?;
    let status: Value = contract.view("get_status").await?.json()?;
    assert_eq!(status["status"], "phase-2-ready");

    contract
        .call("add_allowed_recipient")
        .args_json(json!({ "account_id": recipient.id() }))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    let now_ms = worker.view_block().await?.header().timestamp_nanosec() / 1_000_000;
    contract
        .call("create_workflow")
        .args_json(json!({
            "args": {
                "recipient_id": recipient.id(),
                "amount": (10 * ONE_MILLI_NEAR).to_string(),
                "max_per_run": (10 * ONE_MILLI_NEAR).to_string(),
                "min_reserve": (20 * ONE_MILLI_NEAR).to_string(),
                "interval_ms": 60_000,
                "start_at_ms": now_ms + 1_000,
                "max_runs": 2,
                "config_hash": "sandbox-success"
            }
        }))
        .deposit(NearToken::from_millinear(100))
        .transact()
        .await?
        .into_result()?;
    let discovered: Value = contract
        .view("list_workflows")
        .args_json(json!({ "cursor": 0, "limit": 20 }))
        .await?
        .json()?;
    assert_eq!(discovered.as_array().map(Vec::len), Some(1));
    assert_eq!(discovered[0]["id"], 0);
    worker.fast_forward(5).await?;

    let recipient_before = recipient.view_account().await?.balance;
    let first_dispatch = keeper
        .call(contract.id(), "execute_due")
        .args_json(json!({ "workflow_id": 0 }))
        .gas(Gas::from_tgas(100))
        .transact();
    let competing_dispatch = second_keeper
        .call(contract.id(), "execute_due")
        .args_json(json!({ "workflow_id": 0 }))
        .gas(Gas::from_tgas(100))
        .transact();
    let (first_result, competing_result) = tokio::join!(first_dispatch, competing_dispatch);
    first_result?.into_result()?;
    competing_result?.into_result()?;
    let recipient_after = recipient.view_account().await?.balance;
    assert_eq!(
        recipient_after.as_yoctonear() - recipient_before.as_yoctonear(),
        10 * ONE_MILLI_NEAR
    );
    let successful: Value = contract
        .view("get_workflow")
        .args_json(json!({ "workflow_id": 0 }))
        .await?
        .json()?;
    assert_eq!(successful["runs_completed"], 1);
    assert!(successful["pending_execution"].is_null());

    // Retry after finality must not pay the same scheduled slot again.
    let retried: Value = keeper
        .call(contract.id(), "execute_due")
        .args_json(json!({ "workflow_id": 0 }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?
        .json()?;
    assert_eq!(retried["reason_code"], "NOT_DUE");
    assert_eq!(recipient.view_account().await?.balance, recipient_after);

    contract
        .call("pause_workflow")
        .args_json(json!({ "workflow_id": 0 }))
        .transact()
        .await?
        .into_result()?;
    advance_until_due(&worker, successful["next_run_at_ms"].as_u64().unwrap()).await?;
    let paused: Value = contract
        .view("get_workflow")
        .args_json(json!({ "workflow_id": 0 }))
        .await?
        .json()?;
    let blocked: Value = keeper
        .call(contract.id(), "execute_due")
        .args_json(json!({ "workflow_id": 0 }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?
        .json()?;
    assert_eq!(blocked["reason_code"], "PAUSED");
    assert_eq!(recipient.view_account().await?.balance, recipient_after);
    let after_pause: Value = contract
        .view("get_workflow")
        .args_json(json!({ "workflow_id": 0 }))
        .await?
        .json()?;
    assert_eq!(after_pause, paused);

    let withdrawable: u128 = paused["withdrawable"].as_str().unwrap().parse()?;
    let rejected = contract
        .call("withdraw_available")
        .args_json(json!({ "workflow_id": 0, "amount": (withdrawable + 1).to_string() }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(rejected.is_failure());
    assert!(format!("{:?}", rejected.failures()).contains("WITHDRAWAL_EXCEEDS_AVAILABLE"));
    let after_rejection: Value = contract
        .view("get_workflow")
        .args_json(json!({ "workflow_id": 0 }))
        .await?
        .json()?;
    assert_eq!(after_rejection, paused);

    contract
        .call("resume_workflow")
        .args_json(json!({ "workflow_id": 0 }))
        .transact()
        .await?
        .into_result()?;
    keeper
        .call(contract.id(), "execute_due")
        .args_json(json!({ "workflow_id": 0 }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    assert_eq!(
        recipient.view_account().await?.balance.as_yoctonear() - recipient_after.as_yoctonear(),
        10 * ONE_MILLI_NEAR
    );
    let completed: Value = contract
        .view("get_workflow")
        .args_json(json!({ "workflow_id": 0 }))
        .await?
        .json()?;
    assert_eq!(completed["state"], "Completed");
    assert_eq!(completed["runs_completed"], 2);
    assert_eq!(completed["withdrawable"], completed["available_balance"]);

    let missing_recipient = "missing-recipient.test.near";
    contract
        .call("add_allowed_recipient")
        .args_json(json!({ "account_id": missing_recipient }))
        .deposit(NearToken::from_millinear(10))
        .transact()
        .await?
        .into_result()?;
    let now_ms = worker.view_block().await?.header().timestamp_nanosec() / 1_000_000;
    contract
        .call("create_workflow")
        .args_json(json!({
            "args": {
                "recipient_id": missing_recipient,
                "amount": (10 * ONE_MILLI_NEAR).to_string(),
                "max_per_run": (10 * ONE_MILLI_NEAR).to_string(),
                "min_reserve": (20 * ONE_MILLI_NEAR).to_string(),
                "interval_ms": 60_000,
                "start_at_ms": now_ms + 1_000,
                "max_runs": 2,
                "config_hash": "sandbox-failure"
            }
        }))
        .deposit(NearToken::from_millinear(100))
        .transact()
        .await?
        .into_result()?;
    worker.fast_forward(5).await?;

    let before_failure: Value = contract
        .view("get_workflow")
        .args_json(json!({ "workflow_id": 1 }))
        .await?
        .json()?;
    let accounting_before_failure: Value = contract.view("get_accounting").await?.json()?;
    keeper
        .call(contract.id(), "execute_due")
        .args_json(json!({ "workflow_id": 1 }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    let after_failure: Value = contract
        .view("get_workflow")
        .args_json(json!({ "workflow_id": 1 }))
        .await?
        .json()?;
    assert_eq!(
        after_failure["available_balance"],
        before_failure["available_balance"]
    );
    assert_eq!(after_failure["runs_completed"], 0);
    assert_eq!(
        after_failure["next_run_at_ms"],
        before_failure["next_run_at_ms"]
    );
    assert!(after_failure["pending_execution"].is_null());
    let accounting_after_failure: Value = contract.view("get_accounting").await?.json()?;
    assert_eq!(accounting_after_failure, accounting_before_failure);

    // A second actual failed transfer must restore the ledger without accumulating credit.
    keeper
        .call(contract.id(), "execute_due")
        .args_json(json!({ "workflow_id": 1 }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    let after_retry: Value = contract
        .view("get_workflow")
        .args_json(json!({ "workflow_id": 1 }))
        .await?
        .json()?;
    assert_eq!(after_retry, after_failure);

    let external_callback = keeper
        .call(contract.id(), "on_execution_complete")
        .args_json(json!({
            "workflow_id": 1, "run_index": 0,
            "scheduled_for_ms": before_failure["next_run_at_ms"],
            "amount": (10 * ONE_MILLI_NEAR).to_string()
        }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?;
    assert!(external_callback.is_failure());
    let after_callback: Value = contract
        .view("get_workflow")
        .args_json(json!({ "workflow_id": 1 }))
        .await?
        .json()?;
    assert_eq!(after_callback, after_retry);
    let accounting_after_retry: Value = contract.view("get_accounting").await?.json()?;
    assert_eq!(accounting_after_retry, accounting_before_failure);

    contract
        .call("cancel_workflow")
        .args_json(json!({ "workflow_id": 1 }))
        .transact()
        .await?
        .into_result()?;
    let cancelled: Value = contract
        .view("get_workflow")
        .args_json(json!({ "workflow_id": 1 }))
        .await?
        .json()?;
    assert_eq!(cancelled["withdrawable"], cancelled["available_balance"]);
    worker.fast_forward(120).await?;
    let blocked: Value = keeper
        .call(contract.id(), "execute_due")
        .args_json(json!({ "workflow_id": 1 }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?
        .json()?;
    assert_eq!(blocked["reason_code"], "INACTIVE");
    let after_cancel: Value = contract
        .view("get_workflow")
        .args_json(json!({ "workflow_id": 1 }))
        .await?
        .json()?;
    assert_eq!(after_cancel, cancelled);

    contract
        .call("withdraw_available")
        .args_json(json!({ "workflow_id": 1, "amount": cancelled["available_balance"] }))
        .gas(Gas::from_tgas(100))
        .transact()
        .await?
        .into_result()?;
    let withdrawn: Value = contract
        .view("get_workflow")
        .args_json(json!({ "workflow_id": 1 }))
        .await?
        .json()?;
    assert_eq!(withdrawn["available_balance"], "0");
    assert_eq!(withdrawn["withdrawable"], "0");

    Ok(())
}
