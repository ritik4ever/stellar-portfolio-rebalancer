/**
 * PortfolioSetup.tsx
 *
 * Allows users to configure and create a new portfolio rebalancing strategy.
 * Updated to include real-time inline validation for allocation inputs:
 *   - Per-field error if value is < 0 or > 100
 *   - Live summary showing how far the total deviates from 100%
 *   - Red border highlight on invalid inputs
 *   - Submit blocked until all fields and total are valid
 */

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion"; // AnimatePresence added to animate error messages in/out
import {
  Plus,
  Trash2,
  ArrowLeft,
  AlertCircle,
  CheckCircle,
  Zap,
} from "lucide-react";
import { api, ENDPOINTS } from "../config/api";
import ThemeToggle from "./ThemeToggle";

// TanStack Query Mutations
import { useCreatePortfolioMutation } from "../hooks/mutations/usePortfolioMutations";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PortfolioSetupProps {
  onNavigate: (view: string) => void;
  publicKey: string | null;
}

interface Allocation {
  asset: string;
  percentage: number;
}

// ─── Component ────────────────────────────────────────────────────────────────

const PortfolioSetup: React.FC<PortfolioSetupProps> = ({
  onNavigate,
  publicKey,
}) => {
  // ── State ──────────────────────────────────────────────────────────────────

  const [allocations, setAllocations] = useState<Allocation[]>([
    { asset: "XLM", percentage: 40 },
  ]);
  const [threshold, setThreshold] = useState(5);
  const [slippageTolerance, setSlippageTolerance] = useState(1);
  const [strategy, setStrategy] = useState<string>("threshold");
  const [strategyConfig, setStrategyConfig] = useState<Record<string, number>>({});
  const [autoRebalance, setAutoRebalance] = useState(true);
  const [error, setError] = useState<string | null>(null); // submit-level error message
  const [success, setSuccess] = useState(false); // shows success banner after creation
  const [isDemoMode] = useState(true); // demo mode: skips real wallet requirement

  // Mutation for portfolio creation
  const createPortfolioMutation = useCreatePortfolioMutation();

  // ── Static data ────────────────────────────────────────────────────────────

  /** All supported assets the user can allocate to */
  const assetOptions = [
    { value: "XLM", label: "XLM (Stellar Lumens)" },
    { value: "USDC", label: "USDC (USD Coin)" },
    { value: "BTC", label: "BTC (Bitcoin)" },
    { value: "ETH", label: "ETH (Ethereum)" },
  ];

  /** Pre-built allocation sets for quick setup */
  const presetPortfolios = [
    {
      name: "Conservative",
      allocations: [
        { asset: "XLM", percentage: 50 },
        { asset: "USDC", percentage: 40 },
        { asset: "BTC", percentage: 10 },
      ],
    },
    {
      name: "Balanced",
      allocations: [
        { asset: "XLM", percentage: 40 },
        { asset: "USDC", percentage: 35 },
        { asset: "BTC", percentage: 25 },
      ],
    },
    {
      name: "Aggressive",
      allocations: [
        { asset: "BTC", percentage: 50 },
        { asset: "ETH", percentage: 30 },
        { asset: "XLM", percentage: 20 },
      ],
    },
  ];

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
    if (percentage < 0) return "Cannot be negative";
    if (percentage > 100) return "Cannot exceed 100%";
    return null;
  };

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
    type: "error" | "warning" | "success";
  } | null => {
    if (isValidTotal)
      return { text: "Allocations sum to 100% ✓", type: "success" };
    if (deviation > 0)
      return {
        text: `${deviation}% over — reduce allocations by ${deviation}%`,
        type: "error",
      };
    return {
      text: `${Math.abs(deviation)}% under — add ${Math.abs(deviation)}% more`,
      type: "warning",
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

  // ── Handlers ───────────────────────────────────────────────────────────────

  /** Adds a new allocation row using the first asset not already in the list */
  const addAllocation = () => {
    const unusedAssets = assetOptions.filter(
      (option) => !allocations.some((alloc) => alloc.asset === option.value),
    );
    if (unusedAssets.length > 0) {
      setAllocations([
        ...allocations,
        { asset: unusedAssets[0].value, percentage: 0 },
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
    field: "asset" | "percentage",
    value: string | number,
  ) => {
    const updated = [...allocations];
    updated[index] = { ...updated[index], [field]: value };
    setAllocations(updated);
  };

  /** Replaces the current allocation list with a preset configuration */
  const applyPreset = (preset: (typeof presetPortfolios)[0]) => {
    setAllocations(preset.allocations);
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
    if (!isValidTotal || hasAnyFieldError) {
      setError("Please fix validation errors before submitting");
      return;
    }

    // Block submission if no wallet is connected (skipped in demo mode)
    if (!publicKey && !isDemoMode) {
      setError("Please connect your wallet first");
      return;
    }

    setError(null);


  // Compute once before render so the value is consistent across the JSX tree
  const totalStatus = totalDeviationMessage();

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 py-8">
      <div className="max-w-4xl mx-auto px-6">
        {/* ── Page header with back navigation ── */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center">
            <button
              onClick={() => onNavigate("dashboard")}
              className="mr-4 p-2 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200 transition-colors"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
                Create Portfolio
              </h1>
              <p className="text-gray-600 dark:text-gray-400 mt-1">
                Set up your automated rebalancing strategy
              </p>
            </div>
          </div>
          <ThemeToggle />
        </div>

        {/* ── Wallet connection status ── */}
        <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm mb-6">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Wallet Status
          </h3>
          {publicKey ? (
            /* Connected: show a truncated public key for confirmation */
            <div className="flex items-center text-green-600">
              <CheckCircle className="w-5 h-5 mr-2" />
              <span>
                Connected: {publicKey.slice(0, 8)}...{publicKey.slice(-8)}
              </span>
            </div>
          ) : (
            /* Not connected: indicate that demo mode is active instead */
            <div className="flex items-center text-yellow-600">
              <AlertCircle className="w-5 h-5 mr-2" />
              <span>Demo Mode Active</span>
            </div>
          )}
        </div>

        {/* ── Demo mode information banner ── */}
        {isDemoMode && (
          <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg p-4 mb-6">
            <div className="flex items-center">
              <div className="text-blue-600 mr-2">ℹ️</div>
              <div>
                <h4 className="text-blue-800 dark:text-blue-300 font-medium">Demo Mode</h4>
                <p className="text-blue-700 dark:text-blue-400 text-sm">
                  Using simulated $10,000 portfolio with real price data.
                  Perfect for testing and demonstrations.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ── Success banner — shown after portfolio is created ── */}
        {success && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="bg-green-50 border border-green-200 rounded-lg p-4 mb-6"
          >
            <div className="flex items-center text-green-800">
              <CheckCircle className="w-5 h-5 mr-2" />
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
            className="bg-red-50 border border-red-200 rounded-lg p-4 mb-6"
          >
            <div className="flex items-center text-red-800">
              <AlertCircle className="w-5 h-5 mr-2" />
              <span>{error}</span>
            </div>
          </motion.div>
        )}

        {/* ── Main two-column layout ── */}
        <div className="grid lg:grid-cols-2 gap-8">
          {/* ════ Left column: configuration inputs ════ */}
          <div className="space-y-6">
            {/* ── Preset portfolio quick-start buttons ── */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Quick Start
              </h3>
              <div className="grid grid-cols-3 gap-3">
                {presetPortfolios.map((preset, index) => (
                  <button
                    key={index}
                    onClick={() => applyPreset(preset)}
                    className="p-3 text-sm bg-gray-50 hover:bg-gray-100 dark:bg-gray-700 dark:hover:bg-gray-600 dark:text-gray-200 rounded-lg transition-colors text-center"
                  >
                    <div className="font-medium">{preset.name}</div>
                    <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                      {preset.allocations.length} assets
                    </div>
                  </button>
                ))}
              </div>
            </div>

            {/* ── Asset allocation rows with inline validation ── */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                  Asset Allocations
                </h3>
                {/* Disabled once all 4 supported assets have been added */}
                <button
                  onClick={addAllocation}
                  disabled={allocations.length >= assetOptions.length}
                  className="flex items-center px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white text-sm rounded-lg transition-colors"
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Add Asset
                </button>
              </div>

              <div className="space-y-4">
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
                      <div className="flex items-start space-x-3">
                        {/* Asset dropdown */}
                        <div className="flex-1">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Asset
                          </label>
                          <select
                            value={allocation.asset}
                            onChange={(e) =>
                              updateAllocation(index, "asset", e.target.value)
                            }
                            className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                          >
                            {assetOptions.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </div>

                        {/* Percentage input — border and background turn red when invalid */}
                        <div className="w-28">
                          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                            Percentage
                          </label>
                          <input
                            type="number"
                            min="0"
                            max="100"
                            step="0.1"
                            value={allocation.percentage}
                            onChange={(e) =>
                              updateAllocation(
                                index,
                                "percentage",
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
                                ? "border-red-500 focus:ring-red-400 bg-red-50 dark:bg-red-900/30" // invalid
                                : "border-gray-300 dark:border-gray-600 focus:ring-blue-500 focus:border-blue-500" // default
                            }`}
                          />
                        </div>

                        {/* Delete button — hidden when only one row remains to prevent empty state */}
                        {allocations.length > 1 && (
                          <button
                            onClick={() => removeAllocation(index)}
                            className="mt-6 p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors"
                          >
                            <Trash2 className="w-4 h-4" />
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
                            role="alert"
                            initial={{ opacity: 0, height: 0, marginTop: 0 }}
                            animate={{
                              opacity: 1,
                              height: "auto",
                              marginTop: 4,
                            }}
                            exit={{ opacity: 0, height: 0, marginTop: 0 }}
                            transition={{ duration: 0.15 }}
                            className="flex items-center text-xs text-red-600 pl-1"
                          >
                            <AlertCircle className="w-3 h-3 mr-1 flex-shrink-0" />
                            {fieldError}
                          </motion.p>
                        )}
                      </AnimatePresence>
                    </div>
                  );
                })}
              </div>

              {/* ── Real-time total allocation summary ── */}
              <div className="mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
                {/* Numeric total with colour indicating validity */}
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Total Allocation:
                  </span>
                  <span
                    className={`font-semibold tabular-nums ${
                      isValidTotal
                        ? "text-green-600" // exactly 100%
                        : deviation > 0
                          ? "text-red-600" // over 100%
                          : "text-yellow-600" // under 100%
                    }`}
                  >
                    {totalPercentage.toFixed(1)}%
                  </span>
                </div>

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
                <AnimatePresence mode="wait">
                  {totalStatus && (
                    <motion.p
                      key={totalStatus.type}
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      transition={{ duration: 0.15 }}
                      role="status"
                      className={`text-xs mt-1 flex items-center ${
                        totalStatus.type === "success"
                          ? "text-green-600"
                          : totalStatus.type === "error"
                            ? "text-red-600"
                            : "text-yellow-600"
                      }`}
                    >
                      {/* Warning icon only shown for error and warning states, not success */}
                      {totalStatus.type !== "success" && (
                        <AlertCircle className="w-3 h-3 mr-1 flex-shrink-0" />
                      )}
                      {totalStatus.text}
                    </motion.p>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* ── Rebalance threshold and auto-rebalance toggle ── */}
            <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Rebalance Settings
              </h3>

              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Rebalancing Strategy
                  </label>
                  <select
                    value={strategy}
                    onChange={(e) => {
                      setStrategy(e.target.value);
                      setStrategyConfig({});
                    }}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    <option value="threshold">Threshold-based</option>
                    <option value="periodic">Periodic (time-based)</option>
                    <option value="volatility">Volatility-based</option>
                    <option value="custom">Custom rules</option>
                  </select>
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    {strategy === "threshold" && "Rebalance when allocation drift exceeds the threshold."}
                    {strategy === "periodic" && "Rebalance on a fixed schedule (e.g. every 7 or 30 days)."}
                    {strategy === "volatility" && "Rebalance when market volatility exceeds a percentage threshold."}
                    {strategy === "custom" && "Minimum days between rebalances plus threshold check."}
                  </p>
                </div>

                {strategy === "periodic" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Interval (days)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="365"
                      value={strategyConfig.intervalDays ?? 7}
                      onChange={(e) =>
                        setStrategyConfig((c) => ({ ...c, intervalDays: parseInt(e.target.value) || 7 }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                )}

                {strategy === "volatility" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Volatility threshold (%)
                    </label>
                    <input
                      type="number"
                      min="1"
                      max="100"
                      value={strategyConfig.volatilityThresholdPct ?? 10}
                      onChange={(e) =>
                        setStrategyConfig((c) => ({ ...c, volatilityThresholdPct: parseInt(e.target.value) || 10 }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                )}

                {strategy === "custom" && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Min days between rebalances
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="365"
                      value={strategyConfig.minDaysBetweenRebalance ?? 1}
                      onChange={(e) =>
                        setStrategyConfig((c) => ({ ...c, minDaysBetweenRebalance: parseInt(e.target.value) || 1 }))
                      }
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                )}

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Rebalance Threshold (%)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="50"
                    value={threshold}
                    onChange={(e) =>
                      setThreshold(parseInt(e.target.value) || 5)
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Trigger rebalance when any asset drifts by this percentage
                  </p>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                    Max Slippage (%)
                  </label>
                  <input
                    type="number"
                    min="0.1"
                    max="5"
                    step="0.1"
                    value={slippageTolerance}
                    onChange={(e) =>
                      setSlippageTolerance(parseFloat(e.target.value) || 1)
                    }
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                  <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                    Trades will be rejected if price moves beyond this (0.1% - 5%)
                  </p>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="autoRebalance"
                    checked={autoRebalance}
                    onChange={(e) => setAutoRebalance(e.target.checked)}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                  />
                  <label
                    htmlFor="autoRebalance"
                    className="ml-2 text-sm text-gray-700 dark:text-gray-300"
                  >
                    Enable automatic rebalancing
                  </label>
                </div>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Automatically execute rebalances when threshold is exceeded
                </p>
              </div>
            </div>
          </div>

          {/* ════ Right column: live preview + submit ════ */}
          <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
              Portfolio Preview
            </h3>

            {/* Allocation breakdown with colour-coded dots per asset */}
            <div className="space-y-3 mb-6">
              {allocations.map((allocation, index) => (
                <div key={index} className="flex items-center justify-between">
                  <div className="flex items-center">
                    <div
                      className="w-4 h-4 rounded-full mr-3"
                      style={{
                        backgroundColor:
                          ["#3B82F6", "#10B981", "#F59E0B", "#EF4444"][index] ||
                          "#6B7280",
                      }}
                    />
                    <span className="font-medium dark:text-gray-200">{allocation.asset}</span>
                  </div>
                  <span className="text-gray-600 dark:text-gray-400">
                    {allocation.percentage}%
                  </span>
                </div>
              ))}
            </div>

            {/* Settings summary card */}
            <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 space-y-2">
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">
                  Rebalance Threshold:
                </span>
                <span className="text-sm font-medium dark:text-gray-200">{threshold}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">Auto-Rebalance:</span>
                <span className="text-sm font-medium dark:text-gray-200">
                  {autoRebalance ? "Enabled" : "Disabled"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">Max Slippage:</span>
                <span className="text-sm font-medium dark:text-gray-200">{slippageTolerance}%</span>
              </div>
              <div className="flex justify-between">
                <span className="text-sm text-gray-600 dark:text-gray-400">Portfolio Value:</span>
                <span className="text-sm font-medium dark:text-gray-200">$10,000 (Demo)</span>
              </div>
            </div>

            {/*
             * Submit button.
             * Disabled when any of these conditions are true:
             *   - hasAnyFieldError: at least one percentage input is out of range
             *   - !isValidTotal: percentages don't add up to 100%
             *   - isCreating: API call is already in progress
             * disabled:cursor-not-allowed gives a visual cue that the button is blocked.
             */}
             <button
               onClick={createPortfolio}
               disabled={!isValidTotal || hasAnyFieldError || createPortfolioMutation.isPending}
               className="w-full mt-6 bg-blue-600 hover:bg-blue-700 disabled:bg-gray-300 dark:disabled:bg-gray-600 disabled:cursor-not-allowed text-white py-3 px-4 rounded-lg font-medium transition-colors flex items-center justify-center"
             >
               {createPortfolioMutation.isPending ? (
                 <>
                   <Zap className="w-4 h-4 mr-2 animate-spin" />
                   Creating...
                 </>
               ) : (
                 "Create Portfolio"
               )}
             </button>
 
             {/*
              * Helper hint shown beneath the disabled button.
              * Explains why the button is inactive so users aren't left guessing.
              * Hidden once the API call starts (createPortfolioMutation.isPending) to avoid mixed messaging.
              */}
             {(hasAnyFieldError || !isValidTotal) && !createPortfolioMutation.isPending && (
              <p className="text-xs text-gray-400 text-center mt-2">
                Fix validation errors above to continue
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default PortfolioSetup;
