#![cfg(target_os = "linux")]

use anyhow::Result;
use serde_json::{Value, json};

#[tokio::test]
async fn deploys_initializes_and_reads_status() -> Result<()> {
    let project_directory = env!("CARGO_MANIFEST_DIR");
    let wasm = near_workspaces::compile_project(project_directory).await?;
    let worker = near_workspaces::sandbox().await?;
    let contract = worker.dev_deploy(&wasm).await?;

    contract
        .call("new")
        .args_json(json!({ "owner_id": contract.id() }))
        .transact()
        .await?
        .into_result()?;

    let status: Value = contract.view("get_status").await?.json()?;
    assert_eq!(status["owner_id"], contract.id().as_str());
    assert_eq!(status["status"], "phase-1-ready");
    assert!(status["last_keeper"].is_null());

    Ok(())
}
