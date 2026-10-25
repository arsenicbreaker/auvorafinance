#![cfg(target_os = "linux")]

use anyhow::Result;
use near_workspaces::types::{Gas, NearToken};
use serde_json::{Value, json};

const ONE_MILLI_NEAR: u128 = 10u128.pow(21);

#[tokio::test]
async fn executes_exact_transfer_and_restores_failed_transfer() -> Result<()> {
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

    Ok(())
}
