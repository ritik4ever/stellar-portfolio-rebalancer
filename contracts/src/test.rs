// contracts/src/test.rs

#![cfg(test)]

use super::governance::{
    GovernanceContract, GovernanceContractClient, GovernanceError, OperationType,
};
use soroban_sdk::{testutils::Address as _, vec, Env, Address, Bytes};

#[test]
fn test_initialize_governance() {
    let env = Env::default();
    let contract_id = env.register_contract(None, GovernanceContract);
    let client = GovernanceContractClient::new(&env, &contract_id);

    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let signers = vec![&env, signer1, signer2, signer3];

    let result = client.initialize(&signers, &2u32);
    assert!(result.is_ok());

    let config = client.get_config().unwrap();
    assert_eq!(config.signers.len(), 3);
    assert_eq!(config.threshold, 2);
}

#[test]
fn test_duplicate_signers_rejected() {
    let env = Env::default();
    let contract_id = env.register_contract(None, GovernanceContract);
    let client = GovernanceContractClient::new(&env, &contract_id);

    let signer = Address::generate(&env);
    let signers = vec![
        &env,
        signer.clone(),
        signer,
        Address::generate(&env),
    ];

    let result = client.initialize(&signers, &2u32);
    assert!(result.is_err());
}

#[test]
fn test_single_signer_cannot_execute_alone() {
    let env = Env::default();
    let contract_id = env.register_contract(None, GovernanceContract);
    let client = GovernanceContractClient::new(&env, &contract_id);

    let signer1 = Address::generate(&env);
    let signer2 = Address::generate(&env);
    let signer3 = Address::generate(&env);
    let signers = vec![&env, signer1.clone(), signer2.clone(), signer3.clone()];

    client.initialize(&signers, &2u32).unwrap();

    let empty_data = Bytes::new(&env);
    let nonce = client
        .create_proposal(&signer1, &OperationType::Pause, &empty_data)
        .unwrap();

    let result = client.add_signature(&nonce, &signer1, &empty_data);
    assert!(matches!(result, Err(GovernanceError::DuplicateSignature)));

    let result = client.add_signature(&nonce, &signer2, &empty_data);
    assert!(result.is_ok());
}

#[test]
fn test_valid_quorum_executes() {
    let env = Env::default();
    let contract_id = env.register_contract(None, GovernanceContract);
    let client = GovernanceContractClient::new(&env, &contract_id);

    let signers = vec![
        &env,
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
        Address::generate(&env),
    ];

    client.initialize(&signers, &3u32).unwrap();

    let empty_data = Bytes::new(&env);
    let nonce = client
        .create_proposal(&signers.get(0).unwrap(), &OperationType::Pause, &empty_data)
        .unwrap();

    client
        .add_signature(&nonce, &signers.get(1).unwrap(), &empty_data)
        .unwrap();
    client
        .add_signature(&nonce, &signers.get(2).unwrap(), &empty_data)
        .unwrap();

    let events = env.events().all();
}
