use soroban_sdk::{Env, BytesN, Address};
use crate::types::DataKey;

pub fn upgrade(env: &Env, new_wasm_hash: BytesN<32>) {
    let admin: Address = env.storage().instance().get(&DataKey::Admin).unwrap();
    admin.require_auth();
    
    // Migration guard: Validate existing storage schema before activating new WASM
    if !env.storage().instance().has(&DataKey::Admin) {
        panic!("Migration guard failed: invalid schema");
    }
    
    env.deployer().update_current_contract_wasm(new_wasm_hash.clone());
    
    env.events().publish(
        ("upgrade", "executed"),
        new_wasm_hash
    );
}
