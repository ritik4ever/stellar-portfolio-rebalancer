import { z } from 'zod';

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
    strategy: z.enum(['threshold', 'periodic', 'volatility', 'custom']).optional(),
    strategyConfig: z.object({
        intervalDays: z.number().min(1).max(365).optional(),
        volatilityThresholdPct: z.number().min(1).max(100).optional(),
        minDaysBetweenRebalance: z.number().min(0).max(365).optional(),
    }).optional(),
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

// ─── Auth schemas ────────────────────────────────────────────────────────────
export const loginSchema = z.object({
    address: z.string().min(1, 'address is required').trim()
}).strict();

export const refreshTokenSchema = z.object({
    refreshToken: z.string().min(1, 'refreshToken is required')
}).strict();

// ─── Consent schemas ─────────────────────────────────────────────────────────
export const consentStatusQuerySchema = z.object({
    userId: z.string().min(1, 'userId is required').optional(),
    user_id: z.string().min(1).optional()
}).refine(
    (data) => !!(data.userId || data.user_id),
    { message: 'userId is required', path: ['userId'] }
);

export const recordConsentSchema = z.object({
    userId: z.string().min(1, 'userId is required'),
    terms: z.boolean().refine((v) => v === true, { message: 'You must accept Terms of Service' }),
    privacy: z.boolean().refine((v) => v === true, { message: 'You must accept Privacy Policy' }),
    cookies: z.boolean().refine((v) => v === true, { message: 'You must accept Cookie Policy' })
}).strict();

// ─── Notification schemas ─────────────────────────────────────────────────────
const notificationEventsSchema = z.object({
    rebalance: z.boolean(),
    circuitBreaker: z.boolean(),
    priceMovement: z.boolean(),
    riskChange: z.boolean()
});

export const notificationSubscribeSchema = z.object({
    userId: z.string().min(1).optional(),
    emailEnabled: z.boolean(),
    webhookEnabled: z.boolean(),
    emailAddress: z.string().email('Invalid email address').optional(),
    webhookUrl: z.string().url('Invalid webhook URL format').optional(),
    events: notificationEventsSchema
}).superRefine((data, ctx) => {
    if (data.emailEnabled && !data.emailAddress) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'emailAddress is required when emailEnabled is true', path: ['emailAddress'] });
    }
    if (data.webhookEnabled && !data.webhookUrl) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'webhookUrl is required when webhookEnabled is true', path: ['webhookUrl'] });
    }
});

export const notificationQuerySchema = z.object({
    userId: z.string().min(1, 'userId query parameter is required').optional()
});

// ─── Admin asset schemas ──────────────────────────────────────────────────────
export const adminAddAssetSchema = z.object({
    symbol: z.string().min(1, 'symbol is required').max(20),
    name: z.string().min(1, 'name is required').max(100),
    contractAddress: z.string().optional(),
    issuerAccount: z.string().optional(),
    coingeckoId: z.string().optional()
}).strict();

export const adminPatchAssetSchema = z.object({
    enabled: z.boolean()
}).strict();

// ─── Export / query-param schemas ─────────────────────────────────────────────
export const portfolioExportQuerySchema = z.object({
    format: z.enum(['json', 'csv', 'pdf']).refine(
        (v) => ['json', 'csv', 'pdf'].includes(v),
        { message: 'Query parameter format must be one of: json, csv, pdf' }
    )
});

export const rebalanceHistoryQuerySchema = z.object({
    portfolioId: z.string().optional(),
    limit: z.preprocess(
        (v) => (v !== undefined && v !== '' ? Number(v) : undefined),
        z.number().int().min(1).max(500).optional()
    ),
    source: z.enum(['offchain', 'simulated', 'onchain']).optional(),
    startTimestamp: z.string().optional(),
    endTimestamp: z.string().optional(),
    syncOnChain: z.preprocess(
        (v) => (v === 'true' ? true : v === 'false' ? false : v),
        z.boolean().optional()
    )
});

// ─── Debug / admin control schemas ───────────────────────────────────────────
export const debugTestNotificationSchema = z.object({
    userId: z.string().min(1).optional(),
    eventType: z.enum(['rebalance', 'circuitBreaker', 'priceMovement', 'riskChange']).optional()
});
