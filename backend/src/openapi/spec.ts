/**
 * OpenAPI 3.0 specification for Stellar Portfolio Rebalancer API.
 * Served at /api-docs via Swagger UI.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const spec: Record<string, any> = {
    openapi: '3.0.3',
    info: {
        title: 'Stellar Portfolio Rebalancer API',
        description: 'Intelligent portfolio rebalancing service for the Stellar ecosystem using Reflector oracles. Create portfolios, fetch prices, execute rebalances, and manage risk.',
        version: '1.0.0',
        contact: {
            name: 'API Support',
            url: 'https://github.com/your-username/stellar-portfolio-rebalancer',
        },
        license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
    },
    servers: [
        { url: 'http://localhost:3000', description: 'Development' },
        { url: '/', description: 'Current host' },
    ],
    tags: [
        { name: 'Health', description: 'Health and root' },
        { name: 'Portfolio', description: 'Portfolio CRUD and rebalancing' },
        { name: 'Rebalance history', description: 'Rebalance event history' },
        { name: 'Risk', description: 'Risk metrics and checks' },
        { name: 'Prices & market', description: 'Price feeds and market data' },
        { name: 'Auto-rebalancer', description: 'Automatic rebalancing service' },
        { name: 'System', description: 'System status' },
        { name: 'Notifications', description: 'Notification preferences' },
        { name: 'Queue', description: 'BullMQ queue health' },
        { name: 'Debug', description: 'Debug endpoints (when enabled)' },
    ],
    paths: {
        '/': {
            get: {
                tags: ['Health'],
                summary: 'Root',
                description: 'API info and feature flags.',
                responses: {
                    '200': {
                        description: 'API info',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        message: { type: 'string', example: 'Stellar Portfolio Rebalancer API' },
                                        status: { type: 'string', example: 'running' },
                                        version: { type: 'string', example: '1.0.0' },
                                        timestamp: { type: 'string', format: 'date-time' },
                                        features: { type: 'object' },
                                        endpoints: { type: 'object' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/health': {
            get: {
                tags: ['Health'],
                summary: 'Health check',
                description: 'Returns service health and auto-rebalancer status.',
                responses: {
                    '200': {
                        description: 'Healthy',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        status: { type: 'string', example: 'healthy' },
                                        timestamp: { type: 'string', format: 'date-time' },
                                        environment: { type: 'string' },
                                        autoRebalancer: { type: 'object' },
                                    },
                                },
                            },
                        },
                    },
                },
            },
        },
        '/api/rebalance/history': {
            get: {
                tags: ['Rebalance history'],
                summary: 'Get rebalance history',
                description: 'List rebalance events, optionally filtered by portfolio and source.',
                parameters: [
                    { name: 'portfolioId', in: 'query', schema: { type: 'string' }, description: 'Filter by portfolio ID' },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 }, description: 'Max items' },
                    { name: 'source', in: 'query', schema: { type: 'string', enum: ['offchain', 'simulated', 'onchain'] } },
                    { name: 'startTimestamp', in: 'query', schema: { type: 'string', format: 'date-time' } },
                    { name: 'endTimestamp', in: 'query', schema: { type: 'string', format: 'date-time' } },
                    { name: 'syncOnChain', in: 'query', schema: { type: 'boolean' }, description: 'Sync on-chain indexer once before query' },
                ],
                responses: {
                    '200': {
                        description: 'History list',
                        content: {
                            'application/json': {
                                schema: { $ref: '#/components/schemas/ApiEnvelope' },
                                example: {
                                    success: true,
                                    data: { history: [], portfolioId: null, filters: {} },
                                    error: null,
                                    timestamp: '2025-01-01T00:00:00.000Z',
                                    meta: { count: 0 },
                                },
                            },
                        },
                    },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
            post: {
                tags: ['Rebalance history'],
                summary: 'Record rebalance event',
                description: 'Record a new rebalance event (idempotent).',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['portfolioId', 'trigger', 'trades', 'gasUsed', 'status'],
                                properties: {
                                    portfolioId: { type: 'string' },
                                    trigger: { type: 'string' },
                                    trades: { type: 'integer', minimum: 0 },
                                    gasUsed: { type: 'string' },
                                    status: { type: 'string', enum: ['completed', 'failed', 'pending'] },
                                    isAutomatic: { type: 'boolean' },
                                    eventSource: { type: 'string', enum: ['offchain', 'simulated', 'onchain'] },
                                },
                            },
                            example: {
                                portfolioId: 'pf-123',
                                trigger: 'manual',
                                trades: 2,
                                gasUsed: '0.05 XLM',
                                status: 'completed',
                                isAutomatic: false,
                            },
                        },
                    },
                },
                responses: {
                    '200': { description: 'Event recorded', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiEnvelope' } } },
                    '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/rebalance/history/sync-onchain': {
            post: {
                tags: ['Rebalance history'],
                summary: 'Sync on-chain history',
                description: 'Trigger a one-time sync of on-chain rebalance events. Admin only.',
                security: [{ adminAuth: [] }],
                responses: {
                    '200': { description: 'Sync result', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiEnvelope' } } },
                    '401': { description: 'Unauthorized' },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/portfolio': {
            post: {
                tags: ['Portfolio'],
                summary: 'Create portfolio',
                description: 'Create a new portfolio with target allocations and threshold. Allocations must sum to 100%.',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['userAddress', 'allocations', 'threshold'],
                                properties: {
                                    userAddress: { type: 'string', description: 'Stellar account address' },
                                    allocations: {
                                        type: 'object',
                                        additionalProperties: { type: 'number' },
                                        description: 'Target weights per asset (e.g. { "XLM": 40, "BTC": 30, "USDC": 30 }), must sum to 100',
                                    },
                                    threshold: { type: 'number', minimum: 1, maximum: 50, description: 'Rebalance threshold %' },
                                    slippageTolerance: { type: 'number', minimum: 0.1, maximum: 5, default: 1, description: 'Slippage tolerance %' },
                                },
                            },
                            example: {
                                userAddress: 'GABC...',
                                allocations: { XLM: 40, BTC: 30, USDC: 30 },
                                threshold: 5,
                                slippageTolerance: 1,
                            },
                        },
                    },
                },
                responses: {
                    '201': {
                        description: 'Portfolio created',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean', example: true },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                portfolioId: { type: 'string' },
                                                status: { type: 'string', example: 'created' },
                                                mode: { type: 'string', enum: ['demo', 'onchain'] },
                                            },
                                        },
                                        error: { type: 'object', nullable: true },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/portfolio/{id}': {
            get: {
                tags: ['Portfolio'],
                summary: 'Get portfolio',
                description: 'Fetch a portfolio by ID.',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    '200': {
                        description: 'Portfolio',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                portfolio: { $ref: '#/components/schemas/Portfolio' },
                                            },
                                        },
                                        error: { type: 'object', nullable: true },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    '404': { description: 'Portfolio not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/user/{address}/portfolios': {
            get: {
                tags: ['Portfolio'],
                summary: 'List user portfolios',
                description: 'Get all portfolios for a Stellar address.',
                parameters: [{ name: 'address', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    '200': {
                        description: 'List of portfolios',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: { portfolios: { type: 'array', items: { $ref: '#/components/schemas/Portfolio' } } },
                                        },
                                        error: { type: 'object', nullable: true },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/portfolio/{id}/rebalance-plan': {
            get: {
                tags: ['Portfolio'],
                summary: 'Get rebalance plan',
                description: 'Get total value, slippage, and current prices for planning.',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    '200': {
                        description: 'Plan data',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                portfolioId: { type: 'string' },
                                                totalValue: { type: 'number' },
                                                maxSlippagePercent: { type: 'number' },
                                                estimatedSlippageBps: { type: 'integer' },
                                                prices: { type: 'object', additionalProperties: { $ref: '#/components/schemas/PriceData' } },
                                            },
                                        },
                                        error: { type: 'object', nullable: true },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    '404': { description: 'Portfolio not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/portfolio/{id}/rebalance': {
            post: {
                tags: ['Portfolio'],
                summary: 'Execute rebalance',
                description: 'Run rebalance for a portfolio. May return 409 if rebalance already in progress.',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                requestBody: {
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                properties: {
                                    options: {
                                        type: 'object',
                                        properties: {
                                            simulateOnly: { type: 'boolean' },
                                            ignoreSafetyChecks: { type: 'boolean' },
                                            slippageOverrides: { type: 'object', additionalProperties: { type: 'number' } },
                                        },
                                    },
                                },
                            },
                        },
                    },
                },
                responses: {
                    '200': {
                        description: 'Rebalance result',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                result: { $ref: '#/components/schemas/RebalanceResult' },
                                            },
                                        },
                                        error: { type: 'object', nullable: true },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    '400': { description: 'Bad request (e.g. risk blocked)', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '409': { description: 'Rebalance already in progress', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '404': { description: 'Portfolio not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/portfolio/{id}/analytics': {
            get: {
                tags: ['Portfolio'],
                summary: 'Get portfolio analytics',
                description: 'Time-series analytics for the portfolio.',
                parameters: [
                    { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
                    { name: 'days', in: 'query', schema: { type: 'integer', default: 30 } },
                ],
                responses: {
                    '200': { description: 'Analytics data', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiEnvelope' } } },
                    '404': { description: 'Portfolio not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/portfolio/{id}/performance-summary': {
            get: {
                tags: ['Portfolio'],
                summary: 'Get performance summary',
                description: 'Aggregate performance metrics for the portfolio.',
                parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    '200': { description: 'Performance summary', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiEnvelope' } } },
                    '404': { description: 'Portfolio not found', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/risk/metrics/{portfolioId}': {
            get: {
                tags: ['Risk'],
                summary: 'Get risk metrics',
                description: 'Risk analysis and recommendations for a portfolio.',
                parameters: [{ name: 'portfolioId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    '200': {
                        description: 'Risk metrics and recommendations',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                portfolioId: { type: 'string' },
                                                riskMetrics: { $ref: '#/components/schemas/RiskMetrics' },
                                                recommendations: { type: 'array', items: { type: 'object' } },
                                                circuitBreakers: { type: 'object' },
                                            },
                                        },
                                        error: { type: 'object', nullable: true },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/risk/check/{portfolioId}': {
            get: {
                tags: ['Risk'],
                summary: 'Check risk (rebalance allowed?)',
                description: 'Whether rebalancing is allowed based on risk conditions.',
                parameters: [{ name: 'portfolioId', in: 'path', required: true, schema: { type: 'string' } }],
                responses: {
                    '200': {
                        description: 'Risk check result',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                portfolioId: { type: 'string' },
                                                allowed: { type: 'boolean' },
                                                reason: { type: 'string', nullable: true },
                                                alerts: { type: 'array' },
                                            },
                                        },
                                        error: { type: 'object', nullable: true },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/prices': {
            get: {
                tags: ['Prices & market'],
                summary: 'Get current prices',
                description: 'Current asset prices (XLM, BTC, ETH, USDC, etc.) from Reflector/CoinGecko.',
                responses: {
                    '200': {
                        description: 'Map of asset to price data',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            additionalProperties: { $ref: '#/components/schemas/PriceData' },
                                        },
                                        error: { type: 'object', nullable: true },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    '503': { description: 'Price feeds unavailable', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/prices/enhanced': {
            get: {
                tags: ['Prices & market'],
                summary: 'Get enhanced prices',
                description: 'Prices with risk analysis and volatility level.',
                responses: {
                    '200': {
                        description: 'Enhanced price data',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                prices: { type: 'object', additionalProperties: { type: 'object' } },
                                                riskAlerts: { type: 'array' },
                                            },
                                        },
                                        error: { type: 'object', nullable: true },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/market/{asset}/details': {
            get: {
                tags: ['Prices & market'],
                summary: 'Get market details for asset',
                description: 'Detailed market data for a single asset.',
                parameters: [{ name: 'asset', in: 'path', required: true, schema: { type: 'string', example: 'XLM' } }],
                responses: {
                    '200': { description: 'Market details', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiEnvelope' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/market/{asset}/chart': {
            get: {
                tags: ['Prices & market'],
                summary: 'Get price chart',
                description: 'Historical price data for charting.',
                parameters: [
                    { name: 'asset', in: 'path', required: true, schema: { type: 'string', example: 'XLM' } },
                    { name: 'days', in: 'query', schema: { type: 'integer', default: 7 } },
                ],
                responses: {
                    '200': {
                        description: 'Chart data',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                asset: { type: 'string' },
                                                data: { type: 'array', items: { type: 'object', properties: { timestamp: { type: 'number' }, price: { type: 'number' } } } },
                                                timeframe: { type: 'string' },
                                                dataPoints: { type: 'integer' },
                                            },
                                        },
                                        error: { type: 'object', nullable: true },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/auto-rebalancer/status': {
            get: {
                tags: ['Auto-rebalancer'],
                summary: 'Get auto-rebalancer status',
                description: 'Current status and statistics of the automatic rebalancing service.',
                responses: {
                    '200': {
                        description: 'Status and statistics',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                status: { type: 'object', properties: { isRunning: { type: 'boolean' } } },
                                                statistics: { type: 'object' },
                                            },
                                        },
                                        error: { type: 'object', nullable: true },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/auto-rebalancer/start': {
            post: {
                tags: ['Auto-rebalancer'],
                summary: 'Start auto-rebalancer',
                description: 'Start the automatic rebalancing service. Admin only.',
                security: [{ adminAuth: [] }],
                responses: {
                    '200': { description: 'Started', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiEnvelope' } } },
                    '401': { description: 'Unauthorized' },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/auto-rebalancer/stop': {
            post: {
                tags: ['Auto-rebalancer'],
                summary: 'Stop auto-rebalancer',
                description: 'Stop the automatic rebalancing service. Admin only.',
                security: [{ adminAuth: [] }],
                responses: {
                    '200': { description: 'Stopped', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiEnvelope' } } },
                    '401': { description: 'Unauthorized' },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/auto-rebalancer/force-check': {
            post: {
                tags: ['Auto-rebalancer'],
                summary: 'Force check',
                description: 'Trigger an immediate check of all portfolios. Admin only.',
                security: [{ adminAuth: [] }],
                responses: {
                    '200': { description: 'Check completed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiEnvelope' } } },
                    '401': { description: 'Unauthorized' },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/auto-rebalancer/history': {
            get: {
                tags: ['Auto-rebalancer'],
                summary: 'Get auto-rebalance history',
                description: 'Recent automatic rebalance events. Admin only.',
                parameters: [
                    { name: 'portfolioId', in: 'query', schema: { type: 'string' } },
                    { name: 'limit', in: 'query', schema: { type: 'integer', default: 50 } },
                ],
                security: [{ adminAuth: [] }],
                responses: {
                    '200': { description: 'History list', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiEnvelope' } } },
                    '401': { description: 'Unauthorized' },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/system/status': {
            get: {
                tags: ['System'],
                summary: 'System status',
                description: 'Comprehensive system status: portfolios, rebalance history, risk, auto-rebalancer, indexer, feature flags.',
                responses: {
                    '200': {
                        description: 'System status',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                system: { type: 'object' },
                                                portfolios: { type: 'object' },
                                                rebalanceHistory: { type: 'object' },
                                                riskManagement: { type: 'object' },
                                                autoRebalancer: { type: 'object' },
                                                onChainIndexer: { type: 'object' },
                                                services: { type: 'object' },
                                                featureFlags: { type: 'object' },
                                            },
                                        },
                                        error: { type: 'object', nullable: true },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/notifications/subscribe': {
            post: {
                tags: ['Notifications'],
                summary: 'Subscribe to notifications',
                description: 'Save notification preferences (email, webhook, events).',
                requestBody: {
                    required: true,
                    content: {
                        'application/json': {
                            schema: {
                                type: 'object',
                                required: ['userId', 'emailEnabled', 'webhookEnabled', 'events'],
                                properties: {
                                    userId: { type: 'string' },
                                    emailEnabled: { type: 'boolean' },
                                    emailAddress: { type: 'string', format: 'email' },
                                    webhookEnabled: { type: 'boolean' },
                                    webhookUrl: { type: 'string', format: 'uri' },
                                    events: {
                                        type: 'object',
                                        required: ['rebalance', 'circuitBreaker', 'priceMovement', 'riskChange'],
                                        properties: {
                                            rebalance: { type: 'boolean' },
                                            circuitBreaker: { type: 'boolean' },
                                            priceMovement: { type: 'boolean' },
                                            riskChange: { type: 'boolean' },
                                        },
                                    },
                                },
                            },
                            example: {
                                userId: 'user-123',
                                emailEnabled: true,
                                emailAddress: 'user@example.com',
                                webhookEnabled: false,
                                webhookUrl: null,
                                events: { rebalance: true, circuitBreaker: true, priceMovement: false, riskChange: true },
                            },
                        },
                    },
                },
                responses: {
                    '200': { description: 'Preferences saved', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiEnvelope' } } },
                    '400': { description: 'Validation error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/notifications/preferences': {
            get: {
                tags: ['Notifications'],
                summary: 'Get notification preferences',
                description: 'Get saved preferences for a user.',
                parameters: [{ name: 'userId', in: 'query', required: true, schema: { type: 'string' } }],
                responses: {
                    '200': { description: 'Preferences or null', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiEnvelope' } } },
                    '400': { description: 'userId required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/notifications/unsubscribe': {
            delete: {
                tags: ['Notifications'],
                summary: 'Unsubscribe',
                description: 'Remove all notification preferences for a user.',
                parameters: [{ name: 'userId', in: 'query', required: true, schema: { type: 'string' } }],
                responses: {
                    '200': { description: 'Unsubscribed', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiEnvelope' } } },
                    '400': { description: 'userId required', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
        '/api/queue/health': {
            get: {
                tags: ['Queue'],
                summary: 'Queue health',
                description: 'BullMQ queue depths and Redis connectivity.',
                responses: {
                    '200': {
                        description: 'Queue metrics (when Redis connected)',
                        content: {
                            'application/json': {
                                schema: {
                                    type: 'object',
                                    properties: {
                                        success: { type: 'boolean' },
                                        data: {
                                            type: 'object',
                                            properties: {
                                                redisConnected: { type: 'boolean' },
                                                portfolioCheck: { type: 'object' },
                                                rebalance: { type: 'object' },
                                                analyticsSnapshot: { type: 'object' },
                                            },
                                        },
                                        error: { type: 'object', nullable: true },
                                        timestamp: { type: 'string', format: 'date-time' },
                                    },
                                },
                            },
                        },
                    },
                    '503': { description: 'Redis unavailable', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                    '500': { description: 'Internal error', content: { 'application/json': { schema: { $ref: '#/components/schemas/ApiError' } } },
                },
            },
        },
    },
    components: {
        securitySchemes: {
            adminAuth: {
                type: 'apiKey',
                in: 'header',
                name: 'Authorization',
                description: 'Admin API key or bearer token',
            },
        },
        schemas: {
            ApiEnvelope: { type: 'object' },
            ApiError: { type: 'object' },
            Portfolio: { type: 'object' },
            PriceData: { type: 'object' },
            RiskMetrics: { type: 'object' },
            RebalanceResult: { type: 'object' },
        },
    },
};

export default spec;
