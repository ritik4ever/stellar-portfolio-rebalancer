#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_cooldown_bounds_validation() {
        let env = Env::default();
        
        // Out of lower bound (< 60s)
        assert!(PortfolioRebalancer::set_cooldown(env.clone(), 30).is_err());
        
        // Out of upper bound (> 7 days)
        assert!(PortfolioRebalancer::set_cooldown(env.clone(), 1_000_000).is_err());

        // Valid bound
        PortfolioRebalancer::set_cooldown(env.clone(), 300);
        assert_eq!(PortfolioRebalancer::get_cooldown(env.clone()), 300);
    }

    #[test]
    fn test_same_ledger_boundary_two_rebalances_and_failure_preserves_timestamp() {
        let env = Env::default();
        env.ledger().set_timestamp(1000);
        PortfolioRebalancer::set_cooldown(env.clone(), 60);

        // First successful rebalance with exact integer units
        let res1 = PortfolioRebalancer::rebalance(env.clone(), 10000, true);
        assert!(res1.is_ok());
        assert_eq!(PortfolioRebalancer::get_last_rebalance_time(env.clone()), 1000);

        // Immediate second rebalance attempt on the exact same ledger boundary timestamp (should fail due to cooldown)
        let res2 = PortfolioRebalancer::rebalance(env.clone(), 5000, true);
        assert_eq!(res2, Err(ContractError::CooldownActive));

        // Move ledger forward past cooldown limit
        env.ledger().set_timestamp(1061);

        // Attempt execution that fails internally
        let res3 = PortfolioRebalancer::rebalance(env.clone(), 5000, false);
        assert_eq!(res3, Err(ContractError::ExecutionFailed));

        // Verify timestamp was preserved from previous successful run (remains 1000, NOT updated to 1061)
        assert_eq!(PortfolioRebalancer::get_last_rebalance_time(env.clone()), 1000);
    }
}
