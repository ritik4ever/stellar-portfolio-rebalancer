import { useState, useEffect, useMemo, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion'; // AnimatePresence added to animate error messages in/out
// TanStack Query Mutations
import {
  buildRollbackMessage,
  useCreatePortfolioMutation,
} from '../hooks/mutations/usePortfolioMutations';
import {
  clearPortfolioSetupDraft,
  loadPortfolioSetupDraft,
  savePortfolioSetupDraft,
  type PortfolioSetupDraft,
} from '../hooks/usePortfolio';
import {
  clearPortfolioCloneDraft,
  loadPortfolioCloneDraft,
  type PortfolioCloneDraft,
} from '../utils/portfolioCloneDraft';
import { useAssets } from '../hooks/queries/useAssetsQuery';
import {
  Plus,
  Trash2,
  ArrowLeft,
  AlertCircle,
  CheckCircle,
  Save,
  User,
  RefreshCw,
  RotateCcw,
  X,
} from 'lucide-react';

import ThemeToggle from './ThemeToggle';
import AssetSelector from './AssetSelector'; // NEW: Enhanced asset selector with search
import PortfolioSuggestions from './PortfolioSuggestions';

// ─── Types ────────────────────────────────────────────────────────────────────

interface AssetOption {
  value: string;
  label: string;
}

interface PortfolioSetupProps {
  onNavigate: (view: string) => void;
  publicKey: string | null;
}

interface Allocation {
  asset: string;
  percentage: number;
}

const DEFAULT_ASSET_OPTIONS: AssetOption[] = [
  { value: 'XLM', label: 'XLM (Stellar Lumens)' },
  { value: 'USDC', label: 'USDC (USD Coin)' },
  { value: 'BTC', label: 'BTC (Bitcoin)' },
  { value: 'ETH', label: 'ETH (Ethereum)' },
];

interface SuggestionAsset {
  symbol: string;
  name?: string;
  issuer?: string;
  domain?: string;
  type?: 'native' | 'credit_alphanum4' | 'credit_alphanum12';
  displayName?: string;
  searchText?: string;
}

export type RiskLevel = 'low' | 'medium' | 'high';

export interface PortfolioTemplate {
  id: string;
  name: string;
  description: string;
  riskLevel: RiskLevel;
  allocations: Allocation[];
}

export const PORTFOLIO_TEMPLATES: PortfolioTemplate[] = [
  {
    id: 'conservative',
    name: 'Conservative',
    description:
      'Heavy on stablecoins and XLM. Lower volatility, capital preservation focus.',
    riskLevel: 'low',
    allocations: [
      { asset: 'USDC', percentage: 60 },
      { asset: 'XLM', percentage: 30 },
      { asset: 'BTC', percentage: 10 },
    ],
  },
  {
    id: 'balanced',
    name: 'Balanced',
    description:
      'Mix of stablecoins and crypto. Moderate risk with growth potential.',
    riskLevel: 'medium',
    allocations: [
      { asset: 'USDC', percentage: 40 },
      { asset: 'XLM', percentage: 30 },
      { asset: 'BTC', percentage: 20 },
      { asset: 'ETH', percentage: 10 },
    ],
  },
  {
    id: 'aggressive',
    name: 'Aggressive',
    description: 'Crypto-heavy for maximum growth. Higher volatility and risk.',
    riskLevel: 'high',
    allocations: [
      { asset: 'BTC', percentage: 50 },
      { asset: 'ETH', percentage: 30 },
      { asset: 'XLM', percentage: 20 },
    ],
  },
  {
    id: 'stablecoin-focus',
    name: 'Stablecoin Focus',
    description:
      'Mostly USDC with some XLM. Minimal exposure to crypto volatility.',
    riskLevel: 'low',
    allocations: [
      { asset: 'USDC', percentage: 80 },
      { asset: 'XLM', percentage: 20 },
    ],
  },
  {
    id: 'custom',
    name: 'Custom',
    description:
      'Define your own allocation. Start from scratch and add assets.',
    riskLevel: 'medium',
    allocations: [{ asset: 'XLM', percentage: 100 }],
  },
];

const SAVED_TEMPLATES_KEY = (userId: string) =>
  `portfolio-templates-${userId || 'anonymous'}`;

function loadSavedTemplates(userId: string): PortfolioTemplate[] {
  try {
    const raw = localStorage.getItem(SAVED_TEMPLATES_KEY(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as PortfolioTemplate[];
    return Array.isArray(parsed)
      ? parsed.filter(
          (template): template is PortfolioTemplate =>
            !!template &&
            typeof template.id === 'string' &&
            typeof template.name === 'string' &&
            typeof template.description === 'string' &&
            typeof template.riskLevel === 'string' &&
            Array.isArray(template.allocations) &&
            template.allocations.every(
              (allocation) =>
                allocation &&
                typeof allocation.asset === 'string' &&
                Number.isFinite(allocation.percentage),
            ),
        )
      : [];
  } catch {
    return [];
  }
}

function saveSavedTemplates(
  userId: string,
  templates: PortfolioTemplate[],
): void {
  try {
    localStorage.setItem(SAVED_TEMPLATES_KEY(userId), JSON.stringify(templates));
  } catch {
    // Saved templates are a convenience feature; ignore storage failures.
  }
}

// ─── Component ────────────────────────────────────────────────────────────────

const PortfolioSetup: React.FC<PortfolioSetupProps> = ({
  onNavigate,
  publicKey,
}) => {
  // ── State ──────────────────────────────────────────────────────────────────

  const [allocations, setAllocations] = useState<Allocation[]>(() => {
    const balanced = PORTFOLIO_TEMPLATES.find((t) => t.id === 'balanced');
    return balanced
      ? balanced.allocations.map((a) => ({ ...a }))
      : [{ asset: 'XLM', percentage: 40 }];
  });
  const [threshold, setThreshold] = useState(5);
  const [slippageTolerance, setSlippageTolerance] = useState(1);
  const [strategy, setStrategy] = useState<string>('threshold');
  const [strategyConfig, setStrategyConfig] = useState<Record<string, number>>(
    {},
  );
  const [autoRebalance, setAutoRebalance] = useState(true);
  const [error, setError] = useState<string | null>(null); // submit-level error message
  const [success, setSuccess] = useState(false); // shows success banner after creation
  const [isDemoMode] = useState(true); // demo mode: skips real wallet requirement
  const [selectedTemplateId, setSelectedTemplateId] =
    useState<string>('balanced');
  const [savedTemplates, setSavedTemplates] = useState<PortfolioTemplate[]>(
    () => loadSavedTemplates(publicKey || ''),
  );
  const [cloneDraft, setCloneDraft] = useState<PortfolioCloneDraft | null>(() =>
    loadPortfolioCloneDraft(),
  );
  const [pendingDraft, setPendingDraft] = useState<PortfolioSetupDraft | null>(
    null,
  );
  const [draftPromptResolved, setDraftPromptResolved] = useState(false);
  const [draftRestored, setDraftRestored] = useState(false);
  const [draftError, setDraftError] = useState<string | null>(null);
  const hasMountedDraftSaver = useRef(false);
  const { data: assets = [], isLoading: assetsLoading } = useAssets();

  useEffect(() => {
    setSavedTemplates(loadSavedTemplates(publicKey || ''));
  }, [publicKey]);

  const selectableAssets: SuggestionAsset[] = useMemo(() => {
    if (assets.length > 0) return assets;
    return DEFAULT_ASSET_OPTIONS.map((asset) => ({
      symbol: asset.value,
      displayName: asset.label,
      searchText: `${asset.value} ${asset.label}`.toLowerCase(),
    }));
  }, [assets]);

  useEffect(() => {
    const result = loadPortfolioSetupDraft(publicKey);
    if (result.status === 'loaded') {
      setPendingDraft(result.draft);
      setDraftError(null);
      setDraftPromptResolved(false);
      setDraftRestored(false);
      hasMountedDraftSaver.current = false;
      return;
    }

    setPendingDraft(null);
    setDraftPromptResolved(true);
    setDraftRestored(false);
    setDraftError(result.status === 'failed' ? result.error : null);
    hasMountedDraftSaver.current = false;
  }, [publicKey]);

  useEffect(() => {
    if (!draftPromptResolved) return;

    if (!hasMountedDraftSaver.current) {
      hasMountedDraftSaver.current = true;
      return;
    }

    const result = savePortfolioSetupDraft(publicKey, {
      allocations: allocations.map((allocation) => ({ ...allocation })),
      threshold,
      slippageTolerance,
      strategy,
      strategyConfig,
      autoRebalance,
      selectedTemplateId,
    });

    setDraftError(
      result.status === 'failed'
        ? 'We could not save your draft locally. Your current inputs remain on this page only.'
        : null,
    );
    setDraftRestored(false);
  }, [
    allocations,
    threshold,
    slippageTolerance,
    strategy,
    strategyConfig,
    autoRebalance,
    selectedTemplateId,
    publicKey,
    draftPromptResolved,
  ]);

  const restoreDraft = () => {
    if (!pendingDraft) return;
    setAllocations(
      pendingDraft.allocations.map((allocation) => ({ ...allocation })),
    );
    setThreshold(pendingDraft.threshold);
    setSlippageTolerance(pendingDraft.slippageTolerance);
    setStrategy(pendingDraft.strategy);
    setStrategyConfig({ ...pendingDraft.strategyConfig });
    setAutoRebalance(pendingDraft.autoRebalance);
    setSelectedTemplateId(pendingDraft.selectedTemplateId);
    setPendingDraft(null);
    setDraftError(null);
    setDraftRestored(true);
    setDraftPromptResolved(true);
    hasMountedDraftSaver.current = true;
  };

  const discardDraft = () => {
    const result = clearPortfolioSetupDraft(publicKey);
    setPendingDraft(null);
    setDraftRestored(false);
    setDraftPromptResolved(true);
    setDraftError(result.status === 'failed' ? result.error : null);
    hasMountedDraftSaver.current = false;
  };

  const formatDraftSavedAt = (savedAt: string): string => {
    const savedDate = new Date(savedAt);
    if (Number.isNaN(savedDate.getTime())) return 'a previous visit';
    return savedDate.toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    });
  };

  useEffect(() => {
    const draft = loadPortfolioCloneDraft();
    if (!draft) return;

    setCloneDraft(draft);
    setAllocations(draft.allocations.map((row) => ({ ...row })));
    setThreshold(draft.threshold);
    setSlippageTolerance(draft.slippageTolerance);
    setStrategy(draft.strategy || 'threshold');
    setStrategyConfig(draft.strategyConfig ?? {});
    setSelectedTemplateId('custom');
  }, []);

  const getRiskLevelLabel = (level: RiskLevel): string => {
    switch (level) {
      case 'low':
        return 'Low risk';
      case 'medium':
        return 'Medium risk';
      case 'high':
        return 'High risk';
      default:
        return 'Risk';
    }
  };

  const getRiskLevelClass = (level: RiskLevel): string => {
    switch (level) {
      case 'low':
        return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
      case 'medium':
        return 'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/40 dark:text-yellow-300';
      case 'high':
        return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
      default:
        return 'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300';
    }
  };
  // Mutation for portfolio creation
  const createPortfolioMutation = useCreatePortfolioMutation();

  // ── Validation ─────────────────────────────────────────────────────────────

  /**
   * Validates a single allocation percentage.
   * Returns an error string if the value is out of range, or null if acceptable.
   *
   * Rules:
   *   - Must not be negative (< 0)
   *   - Must not exceed 100 (> 100)
   */
  const getAllocationError = (percentage: number): string | null => {
    if (percentage < 0) return 'Cannot be negative';
    if (percentage > 100) return 'Cannot exceed 100%';
    return null;
  };

  const hasDuplicateAssets = useMemo(() => {
    const seen = new Set<string>();
    return allocations.some((allocation) => {
      const asset = allocation.asset.trim().toUpperCase();
      if (!asset) return false;
      if (seen.has(asset)) return true;
      seen.add(asset);
      return false;
    });
  }, [allocations]);

  /** Sum of all current allocation percentages */
  const totalPercentage = allocations.reduce(
    (sum, alloc) => sum + alloc.percentage,
    0,
  );

  /**
   * True when the total is within 0.01% of 100.
   * The small tolerance prevents false negatives from floating-point arithmetic
   * e.g. 33.3 + 33.3 + 33.4 = 100.00000000000001 without this guard.
   */
  const isValidTotal = Math.abs(totalPercentage - 100) < 0.01;

  /**
   * Signed deviation from 100%, rounded to 1 decimal place.
   * Positive = over-allocated (e.g. +5 means 105% total)
   * Negative = under-allocated (e.g. -10 means 90% total)
   */
  const deviation = parseFloat((totalPercentage - 100).toFixed(1));

  /**
   * Builds the real-time summary message shown below the allocation list.
   * Returns an object with the message text and a semantic type used to set the colour:
   *   'success' → green  (total is exactly 100%)
   *   'error'   → red    (total is over 100%)
   *   'warning' → yellow (total is under 100%)
   */
  const totalDeviationMessage = (): {
    text: string;
    type: 'error' | 'warning' | 'success';
  } | null => {
    if (isValidTotal)
      return { text: 'Allocations sum to 100% ✓', type: 'success' };
    if (deviation > 0)
      return {
        text: `${deviation}% over — reduce allocations by ${deviation}%`,
        type: 'error',
      };
    return {
      text: `${Math.abs(deviation)}% under — add ${Math.abs(deviation)}% more`,
      type: 'warning',
    };
  };

  /**
   * True if any individual allocation row has a validation error.
   * Used alongside isValidTotal to gate the submit button —
   * both must pass before the form can be submitted.
   */
  const hasAnyFieldError = allocations.some(
    (a) => getAllocationError(a.percentage) !== null,
  );

  /** Remaining percentage to reach 100% (positive = under, negative = over, 0 = exact) */
  const remainingAllocation = (rows: Allocation[]): number =>
    Number(
      (100 - rows.reduce((sum, row) => sum + row.percentage, 0)).toFixed(1),
    );

  const remaining = remainingAllocation(allocations);

  const clampNumber = (
    rawValue: string,
    fallback: number,
    min: number,
    max: number,
  ): number => {
    const parsed = Number(rawValue);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
  };

  // ── Handlers ───────────────────────────────────────────────────────────────

  /** Adds a new allocation row using the first asset not already in the list */
  const addAllocation = () => {
    const unusedAssets = selectableAssets.filter(
      (asset) => !allocations.some((alloc) => alloc.asset === asset.symbol),
    );
    if (unusedAssets.length > 0) {
      setAllocations([
        ...allocations,
        { asset: unusedAssets[0].symbol, percentage: 0 },
      ]);
    }
  };

  /** Removes the allocation row at the given index. Always keeps at least one row. */
  const removeAllocation = (index: number) => {
    if (allocations.length > 1) {
      setAllocations(allocations.filter((_, i) => i !== index));
    }
  };

  /** Updates either the asset or percentage field for a specific allocation row */
  const updateAllocation = (
    index: number,
    field: 'asset' | 'percentage',
    value: string | number,
  ) => {
    const updated = [...allocations];
    updated[index] = { ...updated[index], [field]: value };
    setAllocations(updated);
  };

  /** Replaces the current allocation list with a template. User can modify before creating. */
  const applyTemplate = (template: PortfolioTemplate) => {
    setSelectedTemplateId(template.id);
    setAllocations(template.allocations.map((a) => ({ ...a })));
  };

  const applySuggestion = (nextAllocations: Allocation[]) => {
    setSelectedTemplateId('custom');
    setAllocations(nextAllocations.map((allocation) => ({ ...allocation })));
  };

  const saveCurrentAsTemplate = () => {
    const name = window.prompt('Template name', 'My custom template');
    if (!name?.trim()) return;
    if (!isValidTotal || hasAnyFieldError) return;
    const custom: PortfolioTemplate = {
      id: `saved-${Date.now()}`,
      name: name.trim(),
      description: 'Saved by you. Modify and use as a starting point.',
      riskLevel: 'medium',
      allocations: allocations.map((a) => ({ ...a })),
    };
    const userId = publicKey || '';
    const next = [...savedTemplates, custom];
    setSavedTemplates(next);
    saveSavedTemplates(userId, next);
    setSelectedTemplateId(custom.id);
  };

  const removeSavedTemplate = (id: string) => {
    if (!window.confirm('Remove this saved template?')) return;
    const userId = publicKey || '';
    const next = savedTemplates.filter((t) => t.id !== id);
    setSavedTemplates(next);
    saveSavedTemplates(userId, next);
    if (selectedTemplateId === id) {
      setSelectedTemplateId('custom');
      setAllocations([{ asset: 'XLM', percentage: 100 }]);
    }
  };

  /**
   * Submits the portfolio to the API.
   *
   * Guards (in order):
   *   1. Total must equal 100% and no field can be out of range
   *   2. In non-demo mode, a connected wallet public key is required
   *
   * On success → shows banner, then navigates to the dashboard after 2 seconds.
   * On failure → shows the API error message or a generic network fallback.
   */
  const createPortfolio = async () => {
    // Block submission if any validation check has not passed
    if (createPortfolioMutation.isPending) {
      return;
    }

    if (!isValidTotal || hasAnyFieldError || hasDuplicateAssets) {
      setError('Please fix validation errors before submitting');
      return;
    }

    // Block submission if no wallet is connected (skipped in demo mode)
    if (!publicKey && !isDemoMode) {
      setError('Please connect your wallet first');
      return;
    }

    setError(null);

    try {
      const allocationsMap = allocations.reduce(
        (acc, alloc) => {
          const assetKey = alloc.asset.trim().toUpperCase();
          if (acc[assetKey] !== undefined) {
            throw new Error(`Duplicate asset selected: ${assetKey}`);
          }
          acc[assetKey] = alloc.percentage;
          return acc;
        },
        {} as Record<string, number>,
      );

      await createPortfolioMutation.mutateAsync({
        userAddress: publicKey || 'demo-user',
        allocations: allocationsMap,
        threshold,
        slippageTolerance,
        strategy: strategy || 'threshold',
        strategyConfig:
          Object.keys(strategyConfig).length > 0 ? strategyConfig : undefined,
      });

      clearPortfolioSetupDraft(publicKey);
      setPendingDraft(null);
      setDraftPromptResolved(true);
      setSuccess(true);
      setTimeout(() => onNavigate('dashboard'), 2000);
      clearPortfolioCloneDraft();
      setCloneDraft(null);
    } catch (err) {
      setError(buildRollbackMessage(err, 'portfolio creation'));
    }
  };

  // Compute once before render so the value is consistent across the JSX tree
  const totalStatus = totalDeviationMessage();
  // Alias so the mobile action bar can reference the same submit handler
  const handleSubmit = createPortfolio;
  const submitDisabled =
    !isValidTotal || hasAnyFieldError || hasDuplicateAssets || createPortfolioMutation.isPending;

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className='min-h-screen bg-gray-50 dark:bg-gray-900 py-6 sm:py-8'>
      <div className='max-w-4xl mx-auto px-4 sm:px-6'>
        {/* ── Page header with back navigation ── */}
        <div className='flex items-center justify-between mb-6 sm:mb-8'>
          <div className='flex items-center'>
            <button
              onClick={() => onNavigate('dashboard')}
              aria-label='Go back to dashboard'
              className='mr-3 sm:mr-4 p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors'
            >
              <ArrowLeft className='w-5 h-5' />
            </button>
            <div>
              <h1 className='text-2xl sm:text-3xl font-bold text-gray-900 dark:text-white'>
                Create Portfolio
              </h1>
              <p className='text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-1'>
                Set up your automated rebalancing strategy
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>

        {/* ── Wallet connection status ── */}
        <div className='bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm mb-6'>
          <h3 className='text-lg font-semibold text-gray-900 dark:text-white mb-4'>
            Wallet Status
          </h3>
          {publicKey ? (
            /* Connected: show a truncated public key for confirmation */
            <div className='flex items-center text-green-600'>
              <CheckCircle className='w-5 h-5 mr-2' />
              <span>
                Connected: {publicKey.slice(0, 8)}...{publicKey.slice(-8)}
              </span>
            </div>
          ) : (
            /* Not connected: indicate that demo mode is active instead */
            <div className='flex items-center text-yellow-600'>
              <AlertCircle className='w-5 h-5 mr-2' />
              <span>Demo Mode Active</span>
            </div>
          )}
        </div>

        {cloneDraft ? (
          <div className='bg-indigo-50 dark:bg-indigo-900/30 border border-indigo-200 dark:border-indigo-800 rounded-lg p-4 mb-6'>
            <div className='flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between'>
              <div>
                <h4 className='text-indigo-900 dark:text-indigo-200 font-medium'>
                  Cloning portfolio{' '}
                  {cloneDraft.sourceLabel ?? cloneDraft.sourcePortfolioId}
                </h4>
                <p className='text-indigo-800 dark:text-indigo-300 text-sm mt-1'>
                  Allocations and rebalance settings are pre-filled. Saving
                  creates a new portfolio and does not change the original.
                </p>
              </div>
              <button
                type='button'
                onClick={() => {
                  clearPortfolioCloneDraft();
                  setCloneDraft(null);
                }}
                className='self-start rounded-lg border border-indigo-300 dark:border-indigo-700 px-3 py-2 text-sm text-indigo-900 dark:text-indigo-100 hover:bg-indigo-100 dark:hover:bg-indigo-900/50'
              >
                Discard clone
              </button>
            </div>
          </div>
        ) : null}

        {/* ── Demo mode information banner ── */}
        {isDemoMode && (
          <div className='bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6'>
            <div className='flex items-center'>
              <div className='text-blue-600 mr-2'>ℹ️</div>
              <div>
                <h4 className='text-blue-800 dark:text-blue-300 font-medium'>
                  Demo Mode
                </h4>
                <p className='text-blue-700 dark:text-blue-400 text-sm'>
                  Using simulated $10,000 portfolio with real price data.
                  Perfect for testing and demonstrations.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Local draft restore prompt ── */}
        {pendingDraft && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className='bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg p-4 mb-6'
            role='region'
            aria-labelledby='portfolio-draft-title'
          >
            <div className='flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between'>
              <div className='flex items-start text-amber-900 dark:text-amber-100'>
                <Save className='w-5 h-5 mr-2 mt-0.5 flex-shrink-0' />
                <div>
                  <h2 id='portfolio-draft-title' className='font-semibold'>
                    Resume saved portfolio draft?
                  </h2>
                  <p className='text-sm text-amber-800 dark:text-amber-200 mt-1'>
                    We found unfinished setup inputs saved locally from{' '}
                    {formatDraftSavedAt(pendingDraft.savedAt)}. Restore them
                    only if you want to continue that draft on this device.
                  </p>
                </div>
              </div>
              <div className='flex flex-col sm:flex-row gap-2 sm:ml-4'>
                <button
                  type='button'
                  onClick={restoreDraft}
                  className='inline-flex items-center justify-center px-3 py-2 bg-amber-600 hover:bg-amber-700 text-white text-sm font-medium rounded-lg transition-colors'
                >
                  <RotateCcw className='w-4 h-4 mr-1' />
                  Restore draft
                </button>
                <button
                  type='button'
                  onClick={discardDraft}
                  className='inline-flex items-center justify-center px-3 py-2 border border-amber-300 dark:border-amber-600 text-amber-900 dark:text-amber-100 hover:bg-amber-100 dark:hover:bg-amber-900/50 text-sm font-medium rounded-lg transition-colors'
                >
                  <X className='w-4 h-4 mr-1' />
                  Start fresh
                </button>
              </div>
            </div>
          </motion.div>
        )}

        {draftRestored && (
          <div
            className='bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg p-4 mb-6'
            role='status'
          >
            <div className='flex items-center text-green-800 dark:text-green-200'>
              <CheckCircle className='w-5 h-5 mr-2' />
              <span>
                Draft restored. Changes will keep saving locally until you
                create the portfolio or start fresh.
              </span>
            </div>
          </div>
        )}

        {draftError && (
          <div
            className='bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg p-4 mb-6'
            role='alert'
          >
            <div className='flex items-center text-red-800 dark:text-red-200'>
              <AlertCircle className='w-5 h-5 mr-2' />
              <span>{draftError}</span>
            </div>
          </div>
        )}

        {/* ── Success banner — shown after portfolio is created ── */}
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            role='status'
            aria-live='polite'
            className='bg-green-50 border border-green-200 rounded-lg p-4 mb-6'
          >
            <div className='flex items-center text-green-800'>
              <CheckCircle className='w-5 h-5 mr-2' />
              <span>
                Portfolio created successfully! Redirecting to dashboard...
              </span>
            </div>
          </motion.div>
        )}

        {/* ── Submit-level error banner — shown when the API call fails or a guard blocks submit ── */}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            role='alert'
            aria-live='assertive'
            className='bg-red-50 border border-red-200 rounded-lg p-4 mb-6'
          >
            <div className='flex items-center text-red-800'>
              <AlertCircle className='w-5 h-5 mr-2' />
              <span>{error}</span>
            </div>
          </motion.div>
        )}

        {/* ── First-time user quick-start / empty state ── */}
        {savedTemplates.length === 0 && (
          <div className='bg-white dark:bg-gray-800 rounded-xl p-4 shadow-sm mb-6'>
            <div className='flex items-start'>
              <div className='flex-1'>
                <h4 className='text-md font-semibold text-gray-900 dark:text-white'>
                  Quick start
                </h4>
                <p className='text-sm text-gray-600 dark:text-gray-400 mt-1'>
                  New here? Try a template to populate allocations, or learn how
                  to set up a portfolio.
                </p>
                <div className='mt-3 flex flex-wrap gap-2'>
                  <button
                    type='button'
                    onClick={() =>
                      applyTemplate(
                        PORTFOLIO_TEMPLATES.find((t) => t.id === 'balanced')!,
                      )
                    }
                    className='px-3 py-1 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm'
                  >
                    Try Balanced Template
                  </button>
                  <button
                    type='button'
                    onClick={() =>
                      window.open('/docs/DEMO_WALKTHROUGH.md', '_blank')
                    }
                    className='px-3 py-1 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm rounded-lg'
                  >
                    Read setup guide
                  </button>
                  {!publicKey && (
                    <button
                      type='button'
                      onClick={() => onNavigate('landing')}
                      className='px-3 py-1 border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 text-sm rounded-lg'
                    >
                      Connect wallet
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}

        <div className='mb-6'>
          <PortfolioSuggestions
            allocations={allocations}
            assets={selectableAssets}
            publicKey={publicKey}
            onApply={applySuggestion}
          />
        </div>

        {/* ── Main two-column layout ── */}
        <div className='grid lg:grid-cols-2 gap-8'>
          {/* ════ Left column: configuration inputs ════ */}
          <div className='space-y-6'>
            {/* ── Template selector: presets with descriptions and risk levels ── */}
            <div className='bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm'>
              <h3 className='text-lg font-semibold text-gray-900 dark:text-white mb-2'>
                Choose a template
              </h3>
              <p className='text-sm text-gray-500 dark:text-gray-400 mb-4'>
                Start from a preset or custom. You can modify allocations below
                before creating.
              </p>
              <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
                {PORTFOLIO_TEMPLATES.map((template) => (
                  <button
                    key={template.id}
                    type='button'
                    onClick={() => applyTemplate(template)}
                    className={`p-4 text-left rounded-lg border-2 transition-colors ${
                      selectedTemplateId === template.id
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400'
                        : 'border-gray-200 dark:border-gray-600 bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600'
                    }`}
                  >
                    <div className='font-semibold text-gray-900 dark:text-white'>
                      {template.name}
                    </div>
                    <p className='text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-2'>
                      {template.description}
                    </p>
                    <span
                      className={`inline-block mt-2 px-2 py-0.5 rounded text-xs font-medium ${getRiskLevelClass(
                        template.riskLevel,
                      )}`}
                    >
                      {getRiskLevelLabel(template.riskLevel)}
                    </span>
                    <div className='text-xs text-gray-500 dark:text-gray-500 mt-1'>
                      {template.allocations.length} asset
                      {template.allocations.length !== 1 ? 's' : ''}
                    </div>
                  </button>
                ))}
              </div>
              {savedTemplates.length > 0 && (
                <>
                  <h4 className='text-sm font-medium text-gray-700 dark:text-gray-300 mt-4 mb-2 flex items-center'>
                    <User className='w-4 h-4 mr-1' />
                    My saved templates
                  </h4>
                  <div className='grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3'>
                    {savedTemplates.map((template) => (
                      <div
                        key={template.id}
                        className={`p-4 rounded-lg border-2 flex flex-col ${
                          selectedTemplateId === template.id
                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 dark:border-blue-400'
                            : 'border-gray-200 dark:border-gray-600 bg-gray-50 dark:bg-gray-700'
                        }`}
                      >
                        <div className='flex items-start justify-between'>
                          <button
                            type='button'
                            onClick={() => applyTemplate(template)}
                            className='text-left flex-1'
                          >
                            <div className='font-semibold text-gray-900 dark:text-white'>
                              {template.name}
                            </div>
                            <p className='text-xs text-gray-600 dark:text-gray-400 mt-1 line-clamp-1'>
                              {template.description}
                            </p>
                            <div className='text-xs text-gray-500 dark:text-gray-500 mt-1'>
                              {template.allocations.length} asset
                              {template.allocations.length !== 1 ? 's' : ''}
                            </div>
                          </button>
                          <button
                            type='button'
                            onClick={(e) => {
                              e.stopPropagation();
                              removeSavedTemplate(template.id);
                            }}
                            className='p-1 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded'
                            title='Remove template'
                          >
                            <Trash2 className='w-4 h-4' />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {isValidTotal && !hasAnyFieldError && (
                <div className='mt-4 pt-4 border-t border-gray-200 dark:border-gray-700'>
                  <button
                    type='button'
                    onClick={saveCurrentAsTemplate}
                    className='flex items-center px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200'
                  >
                    <Save className='w-4 h-4 mr-1' />
                    Save current allocation as my template
                  </button>
                </div>
              )}
            </div>

            {/* ── Asset allocation rows with inline validation ── */}
            <div className='bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm'>
              <div className='flex items-center justify-between mb-4'>
                <h3 className='text-lg font-semibold text-gray-900 dark:text-white'>
                  Asset Allocations
                </h3>
                {/* Disabled once all supported assets have been added */}
                <button
                  type='button'
                  onClick={addAllocation}
                  disabled={
                    assetsLoading ||
                    allocations.length >= selectableAssets.length
                  }
                  className='flex items-center px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white text-sm rounded-lg transition-colors'
                >
                  <Plus className='w-4 h-4 mr-1' />
                  Add Asset
                </button>
              </div>

              <div className='space-y-4'>
                {allocations.map((allocation, index) => {
                  // Evaluate per-row validation on every render so errors update instantly
                  const fieldError = getAllocationError(allocation.percentage);

                  return (
                    /*
                     * Outer div wraps the input row AND its error message together
                     * so the error sits directly beneath its own row without
                     * affecting the spacing or alignment of adjacent rows.
                     */
                    <div key={index}>
                      {/*
                       * items-start (not items-center) keeps the delete button pinned
                       * to the top of the row so it doesn't jump when an error
                       * message adds height below the inputs.
                       */}
                      <div className='flex flex-col sm:flex-row sm:items-start space-y-3 sm:space-y-0 sm:space-x-3'>
                        {/* Asset selector with enhanced search and issuer info */}
                        <div className='flex-1 min-w-0'>
                          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                            Asset
                          </label>
                          <AssetSelector
                            value={allocation.asset}
                            onChange={(asset) =>
                              updateAllocation(index, 'asset', asset)
                            }
                            placeholder='Select asset...'
                            className='w-full'
                          />
                        </div>

                        {/* Percentage input — border and background turn red when invalid */}
                        <div className='w-full sm:w-28'>
                          <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1'>
                            Percentage
                          </label>
                          <input
                            type='number'
                            min='0'
                            max='100'
                            step='0.1'
                            value={allocation.percentage}
                            onChange={(e) =>
                              updateAllocation(
                                index,
                                'percentage',
                                parseFloat(e.target.value) || 0,
                              )
                            }
                            // Marks the field as invalid for screen readers
                            aria-invalid={!!fieldError}
                            // Links this input to its error paragraph for screen readers
                            aria-describedby={
                              fieldError ? `alloc-error-${index}` : undefined
                            }
                            className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:border-transparent transition-colors bg-white dark:bg-gray-700 text-gray-900 dark:text-white ${
                              fieldError
                                ? 'border-red-500 focus:ring-red-400 bg-red-50 dark:bg-red-900/30' // invalid
                                : 'border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500' // default
                            }`}
                          />
                        </div>

                        {/* Delete button — hidden when only one row remains to prevent empty state */}
                        {allocations.length > 1 && (
                          <button
                            type='button'
                            aria-label={`Remove ${allocation.asset} allocation`}
                            onClick={() => removeAllocation(index)}
                            className='mt-6 sm:mt-6 p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors self-start'
                          >
                            <Trash2 className='w-4 h-4' />
                          </button>
                        )}
                      </div>

                      {/*
                       * Per-field inline error message.
                       *
                       * AnimatePresence animates the paragraph in (height 0 → auto, opacity 0 → 1)
                       * and back out (height auto → 0, opacity 1 → 0) so the layout adjusts
                       * smoothly rather than snapping open or closed.
                       *
                       * role="alert" ensures screen readers announce the message immediately
                       * when it appears, without waiting for focus to move to the element.
                       */}
                      <AnimatePresence>
                        {fieldError && (
                          <motion.p
                            id={`alloc-error-${index}`} // referenced by aria-describedby above
                            role='alert'
                            initial={{ opacity: 0, height: 0, marginTop: 0 }}
                            animate={{
                              opacity: 1,
                              height: 'auto',
                              marginTop: 4,
                            }}
                            exit={{ opacity: 0, height: 0, marginTop: 0 }}
                            transition={{ duration: 0.15 }}
                            className='flex items-center text-xs text-red-600 pl-1'
                          >
                            <AlertCircle className='w-3 h-3 mr-1 flex-shrink-0' />
                            {fieldError}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>

              {/* ── Real-time total allocation summary ── */}
              <div className='mt-4 pt-4 border-t border-gray-200 dark:border-gray-700'>
                {/* Numeric total with colour indicating validity */}
                <div className='flex items-center justify-between mb-1'>
                  <span className='text-sm font-medium text-gray-700 dark:text-gray-300'>
                    Total Allocation:
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${
                      isValidTotal
                        ? 'text-green-600' // exactly 100%
                        : deviation > 0
                          ? 'text-red-600' // over 100%
                          : 'text-yellow-600' // under 100%
                    }`}
                  >
                    {totalPercentage.toFixed(1)}%
                  </span>
                </div>

                {/* ── Remaining-allocation progress bar ── */}
                <div
                  className='w-full h-2 rounded-full bg-gray-200 dark:bg-gray-600 overflow-hidden mb-2'
                  role='progressbar'
                  aria-valuenow={Math.min(totalPercentage, 100)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-label={`${totalPercentage.toFixed(1)}% of 100% allocated`}
                >
                  <div
                    className={`h-full rounded-full transition-all duration-200 ${
                      isValidTotal
                        ? 'bg-green-500'
                        : deviation > 0
                          ? 'bg-red-500'
                          : 'bg-yellow-400'
                    }`}
                    style={{ width: `${Math.min(totalPercentage, 100)}%` }}
                  />
                </div>

                {/* Remaining label */}
                {!isValidTotal && (
                  <div className='flex justify-between text-xs text-gray-500 dark:text-gray-400 mb-1'>
                    <span>Remaining:</span>
                    <span
                      className={
                        remaining > 0 ? 'text-yellow-600' : 'text-red-600'
                      }
                    >
                      {remaining > 0
                        ? `+${remaining.toFixed(1)}%`
                        : `${remaining.toFixed(1)}%`}
                    </span>
                  </div>
                )}

                {/*
                 * Deviation guidance text — updates in real time as the user types.
                 *
                 * mode="wait" ensures the exiting message fully disappears before the
                 * entering message appears, preventing two messages overlapping mid-transition.
                 *
                 * key={totalStatus.type} forces a full exit+enter animation whenever the
                 * message type changes (e.g. warning → error), not just when the text changes.
                 *
                 * role="status" creates a polite live region so screen readers announce
                 * the updated message without interrupting what the user is currently hearing.
                 */}
                <AnimatePresence mode='wait'>
                  {totalStatus && (
                    <motion.p
                      key={totalStatus.type}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                      role='status'
                      className={`text-xs mt-1 flex items-center ${
                        totalStatus.type === 'success'
                          ? 'text-green-600'
                          : totalStatus.type === 'error'
                            ? 'text-red-600'
                            : 'text-yellow-600'
                      }`}
                    >
                      {/* Warning icon only shown for error and warning states, not success */}
                      {totalStatus.type !== 'success' && (
                        <AlertCircle className='w-3 h-3 mr-1 flex-shrink-0' />
                      )}
                      {totalStatus.text}
                    </motion.p>
                  )}
                </AnimatePresence>
                {hasDuplicateAssets && (
                  <p className='mt-1 text-xs text-red-600' role='alert'>
                    Duplicate assets are not allowed. Select each asset only once.
                  </p>
                )}
              </div>
            </div>

            {/* ── Rebalance threshold and auto-rebalance toggle ── */}
            <div className='bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm'>
              <h3 className='text-lg font-semibold text-gray-900 dark:text-white mb-4'>
                Rebalance Settings
              </h3>

              <div className='space-y-4'>
                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    Rebalancing Strategy
                  </label>
                  <select
                    value={strategy}
                    onChange={(e) => {
                      setStrategy(e.target.value);
                      setStrategyConfig({});
                    }}
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
                  >
                    <option value='threshold'>Threshold-based</option>
                    <option value='periodic'>Periodic (time-based)</option>
                    <option value='volatility'>Volatility-based</option>
                    <option value='custom'>Custom rules</option>
                  </select>
                  <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
                    {strategy === 'threshold' &&
                      'Rebalance when allocation drift exceeds the threshold.'}
                    {strategy === 'periodic' &&
                      'Rebalance on a fixed schedule (e.g. every 7 or 30 days).'}
                    {strategy === 'volatility' &&
                      'Rebalance when market volatility exceeds a percentage threshold.'}
                    {strategy === 'custom' &&
                      'Minimum days between rebalances plus threshold check.'}
                  </p>
                </div>

                {strategy === 'periodic' && (
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                      Interval (days)
                    </label>
                    <input
                      type='number'
                      min='1'
                      max='365'
                      value={strategyConfig.intervalDays ?? 7}
                      onChange={(e) =>
                        setStrategyConfig((c) => ({
                          ...c,
                          intervalDays: clampNumber(e.target.value, 7, 1, 365),
                        }))
                      }
                      className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
                    />
                  </div>
                )}

                {strategy === 'volatility' && (
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                      Volatility threshold (%)
                    </label>
                    <input
                      type='number'
                      min='1'
                      max='100'
                      value={strategyConfig.volatilityThresholdPct ?? 10}
                      onChange={(e) =>
                        setStrategyConfig((c) => ({
                          ...c,
                          volatilityThresholdPct: clampNumber(
                            e.target.value,
                            10,
                            1,
                            100,
                          ),
                        }))
                      }
                      className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
                    />
                  </div>
                )}

                {strategy === 'custom' && (
                  <div>
                    <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                      Min days between rebalances
                    </label>
                    <input
                      type='number'
                      min='0'
                      max='365'
                      value={strategyConfig.minDaysBetweenRebalance ?? 1}
                      onChange={(e) =>
                        setStrategyConfig((c) => ({
                          ...c,
                          minDaysBetweenRebalance: clampNumber(
                            e.target.value,
                            1,
                            0,
                            365,
                          ),
                        }))
                      }
                      className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
                    />
                  </div>
                )}

                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    Rebalance Threshold (%)
                  </label>
                  <input
                    type='number'
                    min='1'
                    max='50'
                    value={threshold}
                    onChange={(e) =>
                      setThreshold(clampNumber(e.target.value, 5, 1, 50))
                    }
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
                  />
                  <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
                    Trigger rebalance when any asset drifts by this percentage
                  </p>
                </div>

                <div>
                  <label className='block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2'>
                    Max Slippage (%)
                  </label>
                  <input
                    type='number'
                    min='0.1'
                    max='5'
                    step='0.1'
                    value={slippageTolerance}
                    onChange={(e) =>
                      setSlippageTolerance(clampNumber(e.target.value, 1, 0.1, 5))
                    }
                    className='w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white'
                  />
                  <p className='text-sm text-gray-500 dark:text-gray-400 mt-1'>
                    Trades will be rejected if price moves beyond this (0.1% -
                    5%)
                  </p>
                </div>
                <div className='flex items-center'>
                  <input
                    type='checkbox'
                    id='autoRebalance'
                    checked={autoRebalance}
                    onChange={(e) => setAutoRebalance(e.target.checked)}
                    className='h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded'
                  />
                  <label
                    htmlFor='autoRebalance'
                    className='ml-2 text-sm text-gray-700 dark:text-gray-300'
                  >
                    Enable automatic rebalancing
                  </label>
                </div>
                <p className='text-sm text-gray-500 dark:text-gray-400'>
                  Automatically execute rebalances when threshold is exceeded
                </p>
              </div>
            </div>
          </div>

          {/* ════ Right column: live preview + submit ════ */}
          <div className='bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm'>
            <h3 className='text-lg font-semibold text-gray-900 dark:text-white mb-4'>
              Portfolio Preview
            </h3>

            {/* Allocation breakdown with colour-coded dots per asset */}
            <div className='space-y-3 mb-6'>
              {allocations.map((allocation, index) => (
                <div key={index} className='flex items-center justify-between'>
                  <div className='flex items-center'>
                    <div
                      className='w-4 h-4 rounded-full mr-3'
                      style={{
                        backgroundColor:
                          ['#3B82F6', '#10B981', '#F59E0B', '#EF4444'][index] ||
                          '#6B7280',
                      }}
                    />
                    <span className='font-medium dark:text-gray-200'>
                      {allocation.asset}
                    </span>
                  </div>
                  <span className='text-gray-600 dark:text-gray-400'>
                    {allocation.percentage}%
                  </span>
                </div>
              ))}
            </div>

            {/* Settings summary card */}
            <div className='bg-gray-50 dark:bg-gray-700 rounded-lg p-4 space-y-2'>
              <div className='flex justify-between'>
                <span className='text-sm text-gray-600 dark:text-gray-400'>
                  Rebalance Threshold:
                </span>
                <span className='text-sm font-medium dark:text-gray-200'>
                  {threshold}%
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-sm text-gray-600 dark:text-gray-400'>
                  Auto-Rebalance:
                </span>
                <span className='text-sm font-medium dark:text-gray-200'>
                  {autoRebalance ? 'Enabled' : 'Disabled'}
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-sm text-gray-600 dark:text-gray-400'>
                  Max Slippage:
                </span>
                <span className='text-sm font-medium dark:text-gray-200'>
                  {slippageTolerance}%
                </span>
              </div>
              <div className='flex justify-between'>
                <span className='text-sm text-gray-600 dark:text-gray-400'>
                  Portfolio Value:
                </span>
                <span className='text-sm font-medium dark:text-gray-200'>
                  $10,000 (Demo)
                </span>
              </div>
            </div>

            {/*
             * Submit button.
             * Disabled when any of these conditions are true:
             *   - hasAnyFieldError: at least one percentage input is out of range
             *   - !isValidTotal: percentages don't add up to 100%
             *   - createPortfolioMutation.isPending: API call is already in progress
             * disabled:cursor-not-allowed gives a visual cue that the button is blocked.
             */}
          </div>
        </div>

        {/* NEW: Sticky Mobile Action Bar for Portfolio Setup */}
        <div className='mobile-action-bar fixed bottom-0 left-0 right-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 p-4 md:hidden z-40'>
          <div className='flex items-center justify-between max-w-sm mx-auto'>
            {/* Allocation Summary */}
            <div className='text-center'>
              <div className='text-xs text-gray-500 dark:text-gray-400'>
                Total Allocation
              </div>
              <div
                className={`text-lg font-bold ${
                  isValidTotal
                    ? 'text-green-600 dark:text-green-400'
                    : 'text-red-600 dark:text-red-400'
                }`}
              >
                {totalPercentage.toFixed(1)}%
              </div>
              <div className='text-xs text-gray-500 dark:text-gray-400'>
                {allocations.length} asset{allocations.length !== 1 ? 's' : ''}
              </div>
            </div>

            {/* Action Buttons */}
            <div className='flex items-center gap-2'>
              {/* Back Button */}
              <button
                onClick={() => onNavigate('dashboard')}
                aria-label='Go back to dashboard'
                className='border border-gray-200 dark:border-gray-600 bg-white dark:bg-gray-700 hover:bg-gray-50 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 px-3 py-2 rounded-lg text-sm transition-colors flex items-center gap-1'
              >
                <ArrowLeft className='w-4 h-4' />
                <span className='hidden sm:inline'>Back</span>
              </button>

              {/* Create Portfolio Button */}
              <button
                type='button'
                onClick={createPortfolio}
                disabled={submitDisabled}
                className='bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-1'
              >
                {createPortfolioMutation.isPending ? (
                  <>
                    <RefreshCw className='w-4 h-4 animate-spin' />
                    Creating...
                  </>
                ) : (
                  <>
                    <Save className='w-4 h-4' />
                    Create
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Add bottom padding to prevent overlap with mobile action bar */}
        <div className='h-20 md:hidden'></div>
      </div>
    </div>
  );
};

export default PortfolioSetup;
