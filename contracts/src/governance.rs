// contracts/src/governance.rs
// Multi-signature admin governance for Stellar Portfolio Rebalancer

use soroban_sdk::{contract, contractimpl, contracttype, Address, Bytes, Env, Symbol, Vec};

// ============= STORAGE KEYS =============
const GOVERNANCE_CONFIG_KEY: &str = "gov_config";
const PROPOSAL_KEY: &str = "proposal";

// ============= DATA STRUCTURES =============

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct GovernanceConfig {
    pub signers: Vec<Address>,
    pub threshold: u32,
    pub nonce: u64,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum OperationType {
    Pause,
    Unpause,
    Upgrade,
    ParamChange,
    UpdateSigners,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Signature {
    pub signer: Address,
    pub signature_data: Bytes,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Proposal {
    pub op_type: OperationType,
    pub data: Bytes,
    pub signatures: Vec<Signature>,
    pub nonce: u64,
    pub executed: bool,
}

// ============= ERROR TYPES =============

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub enum GovernanceError {
    UnauthorizedSigner,
    InvalidThreshold,
    InsufficientUniqueSigners,
    ProposalNotFound,
    ProposalAlreadyExecuted,
    DuplicateSignature,
    InvalidSignature,
    InsufficientSignatures,
    NotEnoughSigners,
    InvalidOperationData,
}

impl From<GovernanceError> for soroban_sdk::Error {
    fn from(e: GovernanceError) -> Self {
        match e {
            GovernanceError::UnauthorizedSigner => soroban_sdk::Error::from_contract_error(1),
            GovernanceError::InvalidThreshold => soroban_sdk::Error::from_contract_error(2),
            GovernanceError::InsufficientUniqueSigners => soroban_sdk::Error::from_contract_error(3),
            GovernanceError::ProposalNotFound => soroban_sdk::Error::from_contract_error(4),
            GovernanceError::ProposalAlreadyExecuted => soroban_sdk::Error::from_contract_error(5),
            GovernanceError::DuplicateSignature => soroban_sdk::Error::from_contract_error(6),
            GovernanceError::InvalidSignature => soroban_sdk::Error::from_contract_error(7),
            GovernanceError::InsufficientSignatures => soroban_sdk::Error::from_contract_error(8),
            GovernanceError::NotEnoughSigners => soroban_sdk::Error::from_contract_error(9),
            GovernanceError::InvalidOperationData => soroban_sdk::Error::from_contract_error(10),
        }
    }
}

// ============= MAIN CONTRACT =============

#[contract]
pub struct GovernanceContract;

#[contractimpl]
impl GovernanceContract {
    pub fn initialize(
        env: Env,
        initial_signers: Vec<Address>,
        threshold: u32,
    ) -> Result<(), GovernanceError> {
        if threshold == 0 {
            return Err(GovernanceError::InvalidThreshold);
        }

        if initial_signers.len() < threshold as usize {
            return Err(GovernanceError::InsufficientUniqueSigners);
        }

        let mut unique_signers = Vec::new(&env);
        for signer in initial_signers.iter() {
            if !unique_signers.contains(&signer) {
                unique_signers.push_back(signer);
            }
        }

        if unique_signers.len() < threshold as usize {
            return Err(GovernanceError::InsufficientUniqueSigners);
        }

        let config = GovernanceConfig {
            signers: unique_signers,
            threshold,
            nonce: 0,
        };

        env.storage().persistent().set(
            &Symbol::new(&env, GOVERNANCE_CONFIG_KEY),
            &config,
        );

        env.events().publish(
            (Symbol::new(&env, "governance_initialized"),),
            (config.signers, config.threshold),
        );

        Ok(())
    }

    pub fn get_config(env: Env) -> Option<GovernanceConfig> {
        env.storage()
            .persistent()
            .get(&Symbol::new(&env, GOVERNANCE_CONFIG_KEY))
    }

    pub fn create_proposal(
        env: Env,
        signer: Address,
        op_type: OperationType,
        data: Bytes,
    ) -> Result<u64, GovernanceError> {
        let mut config = Self::get_governance_config(&env)?;
        if !config.signers.contains(&signer) {
            return Err(GovernanceError::UnauthorizedSigner);
        }

        let new_nonce = config.nonce + 1;
        config.nonce = new_nonce;
        env.storage()
            .persistent()
            .set(&Symbol::new(&env, GOVERNANCE_CONFIG_KEY), &config);

        let mut signatures = Vec::new(&env);
        signatures.push_back(Signature {
            signer: signer.clone(),
            signature_data: Bytes::new(&env),
        });

        let proposal = Proposal {
            op_type: op_type.clone(),
            data: data.clone(),
            signatures,
            nonce: new_nonce,
            executed: false,
        };

        env.storage().temporary().set(
            &Symbol::new(&env, PROPOSAL_KEY),
            &proposal,
        );

        env.events().publish(
            (Symbol::new(&env, "proposal_created"),),
            (new_nonce, signer, op_type),
        );

        Ok(new_nonce)
    }

    pub fn add_signature(
        env: Env,
        proposal_nonce: u64,
        signer: Address,
        signature_data: Bytes,
    ) -> Result<(), GovernanceError> {
        let config = Self::get_governance_config(&env)?;
        if !config.signers.contains(&signer) {
            return Err(GovernanceError::UnauthorizedSigner);
        }

        let mut proposal: Proposal = env.storage()
            .temporary()
            .get(&Symbol::new(&env, PROPOSAL_KEY))
            .ok_or(GovernanceError::ProposalNotFound)?;

        if proposal.executed {
            return Err(GovernanceError::ProposalAlreadyExecuted);
        }

        for sig in proposal.signatures.iter() {
            if sig.signer == signer {
                return Err(GovernanceError::DuplicateSignature);
            }
        }

        proposal.signatures.push_back(Signature {
            signer: signer.clone(),
            signature_data,
        });

        env.storage().temporary().set(
            &Symbol::new(&env, PROPOSAL_KEY),
            &proposal,
        );

        env.events().publish(
            (Symbol::new(&env, "signature_added"),),
            (proposal_nonce, signer, proposal.signatures.len()),
        );

        if proposal.signatures.len() as u32 >= config.threshold {
            Self::execute_proposal(&env, proposal_nonce, proposal)?;
        }

        Ok(())
    }

    fn execute_proposal(
        env: &Env,
        proposal_nonce: u64,
        mut proposal: Proposal,
    ) -> Result<(), GovernanceError> {
        proposal.executed = true;
        env.storage().temporary().set(
            &Symbol::new(env, PROPOSAL_KEY),
            &proposal,
        );

        let mut signers_list = Vec::new(env);
        for sig in proposal.signatures.iter() {
            signers_list.push_back(sig.signer.clone());
        }

        match proposal.op_type {
            OperationType::Pause => {
                env.events().publish(
                    (Symbol::new(env, "contract_paused"),),
                    (proposal_nonce, signers_list.clone()),
                );
            }
            OperationType::Unpause => {
                env.events().publish(
                    (Symbol::new(env, "contract_unpaused"),),
                    (proposal_nonce, signers_list.clone()),
                );
            }
            OperationType::Upgrade => {
                env.events().publish(
                    (Symbol::new(env, "contract_upgraded"),),
                    (proposal_nonce, signers_list.clone(), proposal.data),
                );
            }
            OperationType::ParamChange => {
                env.events().publish(
                    (Symbol::new(env, "parameter_changed"),),
                    (proposal_nonce, signers_list.clone(), proposal.data),
                );
            }
            OperationType::UpdateSigners => {
                env.events().publish(
                    (Symbol::new(env, "signers_updated"),),
                    (proposal_nonce, signers_list.clone(), proposal.data),
                );
            }
        }

        // Required event: GovernanceActionExecuted
        env.events().publish(
            (Symbol::new(env, "governance_action_executed"),),
            (
                proposal_nonce,
                proposal.op_type,
                signers_list,
                proposal.signatures.len(),
            ),
        );

        Ok(())
    }

    fn get_governance_config(env: &Env) -> Result<GovernanceConfig, GovernanceError> {
        env.storage()
            .persistent()
            .get(&Symbol::new(env, GOVERNANCE_CONFIG_KEY))
            .ok_or(GovernanceError::NotEnoughSigners)
    }
}
