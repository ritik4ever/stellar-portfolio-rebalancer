import { z } from 'zod';

// Strict boolean parsing (handles "true", "false", true, false)
const strictBoolean = z.preprocess((val) => {
    if (typeof val === 'string') {
        if (val.toLowerCase() === 'true') return true;
        if (val.toLowerCase() === 'false') return false;
    }
    return val;
}, z.boolean());

// Schema for POST /portfolio
export const createPortfolioSchema = z.object({
    userAddress: z.string().min(1, "userAddress is required"),
    allocations: z.record(z.string(), z.number().min(0).max(100)).refine(
        (allocations) => {
            const total = Object.values(allocations).reduce((sum, val) => sum + val, 0);
            return Math.abs(total - 100) <= 0.01;
        },
        {
            message: "Allocations must sum to 100%",
        }
    ),
    threshold: z.number().min(1, "Threshold must be between 1% and 50%").max(50, "Threshold must be between 1% and 50%"),
    slippageTolerance: z.number().min(0.1, "Slippage tolerance must be between 0.1% and 5%").max(5, "Slippage tolerance must be between 0.1% and 5%").optional(),
}).strict();

// Schema for POST /portfolio/:id/rebalance
export const rebalancePortfolioSchema = z.object({
    options: z.object({
        simulateOnly: strictBoolean.optional(),
        ignoreSafetyChecks: strictBoolean.optional(),
        slippageOverrides: z.record(z.string(), z.number()).optional()
    }).optional()
}).strict(); // Optional, but if body is present, it must strictly match

// Schema for POST /rebalance/history
export const recordRebalanceEventSchema = z.object({
    portfolioId: z.string().min(1, "portfolioId is required"),
    trigger: z.string().min(1, "trigger is required"),
    trades: z.number().int().min(0, "trades must be a positive integer"),
    gasUsed: z.string().min(1, "gasUsed is required"),
    status: z.enum(['completed', 'failed', 'pending']),

    // Optional / Extra fields mapped safely from the history service
    isAutomatic: strictBoolean.optional(),
    riskAlerts: z.array(z.any()).optional(),
    error: z.string().optional(),
    fromAsset: z.string().optional(),
    toAsset: z.string().optional(),
    amount: z.number().optional(),
    prices: z.record(z.string(), z.any()).optional(),
    portfolio: z.any().optional(),
    eventSource: z.enum(['offchain', 'simulated', 'onchain']).optional(),
    onChainConfirmed: strictBoolean.optional(),
    onChainEventType: z.string().optional(),
    onChainTxHash: z.string().optional(),
    onChainLedger: z.number().int().optional(),
    onChainContractId: z.string().optional(),
    onChainPagingToken: z.string().optional(),
    isSimulated: strictBoolean.optional()
}).strict();

// Auto-Rebalancer control schemas (must be entirely empty payloads)
export const autoRebalancerControlSchema = z.object({}).strict();
