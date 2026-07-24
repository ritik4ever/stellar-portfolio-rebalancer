import { Archive, ArrowLeft, Save, Trash2 } from "lucide-react";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { Toast } from "../components/ui/Toast";

interface AllocationSettings {
  minAllocation: number;
  maxAllocation: number;
}

interface RebalancingSettings {
  threshold: number;
  cooldown: number;
  autoRebalance: boolean;
}

interface NotificationSettings {
  emailEnabled: boolean;
  webhookEnabled: boolean;
  rebalanceAlerts: boolean;
  riskAlerts: boolean;
}

interface RiskSettings {
  circuitBreakerEnabled: boolean;
  circuitBreakerThreshold: number;
  stopLossEnabled: boolean;
  stopLossPercentage: number;
}

interface PortfolioSettingsProps {
  onNavigate: (view: string) => void;
  portfolioId?: string;
}

const PortfolioSettings: React.FC<PortfolioSettingsProps> = ({
  onNavigate,
  portfolioId,
}) => {
  // Allocation settings
  const [allocationSettings, setAllocationSettings] =
    useState<AllocationSettings>({
      minAllocation: 1,
      maxAllocation: 100,
    });
  const [savedAllocationSettings, setSavedAllocationSettings] =
    useState<AllocationSettings>({
      minAllocation: 1,
      maxAllocation: 100,
    });

  // Rebalancing settings
  const [rebalancingSettings, setRebalancingSettings] =
    useState<RebalancingSettings>({
      threshold: 5,
      cooldown: 24,
      autoRebalance: false,
    });
  const [savedRebalancingSettings, setSavedRebalancingSettings] =
    useState<RebalancingSettings>({
      threshold: 5,
      cooldown: 24,
      autoRebalance: false,
    });

  // Notification settings
  const [notificationSettings, setNotificationSettings] =
    useState<NotificationSettings>({
      emailEnabled: false,
      webhookEnabled: false,
      rebalanceAlerts: true,
      riskAlerts: true,
    });
  const [savedNotificationSettings, setSavedNotificationSettings] =
    useState<NotificationSettings>({
      emailEnabled: false,
      webhookEnabled: false,
      rebalanceAlerts: true,
      riskAlerts: true,
    });

  // Risk settings
  const [riskSettings, setRiskSettings] = useState<RiskSettings>({
    circuitBreakerEnabled: false,
    circuitBreakerThreshold: 20,
    stopLossEnabled: false,
    stopLossPercentage: 15,
  });
  const [savedRiskSettings, setSavedRiskSettings] = useState<RiskSettings>({
    circuitBreakerEnabled: false,
    circuitBreakerThreshold: 20,
    stopLossEnabled: false,
    stopLossPercentage: 15,
  });

  // Toast state
  const [toast, setToast] = useState<{
    title: string;
    description: string;
    tone: "success" | "error";
  } | null>(null);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Check if any section has unsaved changes
  const hasUnsavedChanges =
    JSON.stringify(allocationSettings) !==
      JSON.stringify(savedAllocationSettings) ||
    JSON.stringify(rebalancingSettings) !==
      JSON.stringify(savedRebalancingSettings) ||
    JSON.stringify(notificationSettings) !==
      JSON.stringify(savedNotificationSettings) ||
    JSON.stringify(riskSettings) !== JSON.stringify(savedRiskSettings);

  // Warn before browser-level navigation
  useEffect(() => {
    if (!hasUnsavedChanges) return undefined;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasUnsavedChanges]);

  // Wrap in-app navigation with a confirmation guard
  const guardedNavigate = useCallback(
    (view: string) => {
      if (
        hasUnsavedChanges &&
        !window.confirm("You have unsaved changes. Leave without saving?")
      )
        return;
      onNavigate(view);
    },
    [hasUnsavedChanges, onNavigate],
  );

  // Show toast notification
  const showToast = useCallback(
    (title: string, description: string, tone: "success" | "error") => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
      setToast({ title, description, tone });
      toastTimer.current = setTimeout(() => setToast(null), 3000);
    },
    [],
  );

  // Save individual sections
  const saveAllocationSettings = async () => {
    try {
      // Simulate API call
      await new Promise((resolve) => setTimeout(resolve, 500));
      setSavedAllocationSettings(allocationSettings);
      showToast(
        "Settings saved",
        "Allocation settings have been updated",
        "success",
      );
    } catch (error) {
      showToast("Save failed", "Could not save allocation settings", "error");
    }
  };

  const saveRebalancingSettings = async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      setSavedRebalancingSettings(rebalancingSettings);
      showToast(
        "Settings saved",
        "Rebalancing settings have been updated",
        "success",
      );
    } catch (error) {
      showToast("Save failed", "Could not save rebalancing settings", "error");
    }
  };

  const saveNotificationSettings = async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      setSavedNotificationSettings(notificationSettings);
      showToast(
        "Settings saved",
        "Notification settings have been updated",
        "success",
      );
    } catch (error) {
      showToast("Save failed", "Could not save notification settings", "error");
    }
  };

  const saveRiskSettings = async () => {
    try {
      await new Promise((resolve) => setTimeout(resolve, 500));
      setSavedRiskSettings(riskSettings);
      showToast(
        "Settings saved",
        "Risk management settings have been updated",
        "success",
      );
    } catch (error) {
      showToast("Save failed", "Could not save risk settings", "error");
    }
  };

  // Dangerous actions
  const handleArchivePortfolio = () => {
    if (
      window.confirm(
        "Are you sure you want to archive this portfolio? This action can be undone.",
      )
    ) {
      showToast(
        "Portfolio archived",
        "Your portfolio has been archived",
        "success",
      );
      // Navigate back after archive
      setTimeout(() => onNavigate("dashboard"), 1000);
    }
  };

  const handleDeletePortfolio = () => {
    if (
      window.confirm(
        "Are you sure you want to delete this portfolio? This action cannot be undone.",
      )
    ) {
      if (
        window.confirm(
          'This will permanently delete your portfolio and all associated data. Type "DELETE" to confirm.',
        )
      ) {
        showToast(
          "Portfolio deleted",
          "Your portfolio has been permanently deleted",
          "success",
        );
        setTimeout(() => onNavigate("dashboard"), 1000);
      }
    }
  };

  // Cleanup toast timer
  useEffect(
    () => () => {
      if (toastTimer.current) clearTimeout(toastTimer.current);
    },
    [],
  );

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="mx-auto max-w-3xl px-4 py-8">
        {/* Header */}
        <div className="mb-8 flex items-center gap-4">
          <button
            type="button"
            onClick={() => guardedNavigate("dashboard")}
            className="rounded-lg p-2 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors"
            aria-label="Back to dashboard"
          >
            <ArrowLeft className="h-5 w-5 text-gray-700 dark:text-gray-300" />
          </button>
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
              Portfolio Settings
            </h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {portfolioId
                ? `Configure portfolio #${portfolioId}`
                : "Configure your portfolio"}
            </p>
          </div>
          {hasUnsavedChanges && (
            <span className="ml-auto rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/40 dark:text-amber-200">
              Unsaved changes
            </span>
          )}
        </div>

        <div className="space-y-6">
          {/* Allocations Section */}
          <section className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Allocations
              </h2>
              <button
                type="button"
                onClick={saveAllocationSettings}
                disabled={
                  JSON.stringify(allocationSettings) ===
                  JSON.stringify(savedAllocationSettings)
                }
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                <Save className="h-4 w-4" aria-hidden />
                Save
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <label
                    htmlFor="min-allocation"
                    className="text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Minimum allocation (%)
                  </label>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Minimum percentage for any single asset
                  </p>
                </div>
                <input
                  id="min-allocation"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={allocationSettings.minAllocation}
                  onChange={(e) =>
                    setAllocationSettings((s) => ({
                      ...s,
                      minAllocation: Math.min(
                        100,
                        Math.max(0, Number(e.target.value)),
                      ),
                    }))
                  }
                  className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div className="flex items-center justify-between gap-6">
                <div>
                  <label
                    htmlFor="max-allocation"
                    className="text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Maximum allocation (%)
                  </label>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Maximum percentage for any single asset
                  </p>
                </div>
                <input
                  id="max-allocation"
                  type="number"
                  min={0}
                  max={100}
                  step={0.1}
                  value={allocationSettings.maxAllocation}
                  onChange={(e) =>
                    setAllocationSettings((s) => ({
                      ...s,
                      maxAllocation: Math.min(
                        100,
                        Math.max(0, Number(e.target.value)),
                      ),
                    }))
                  }
                  className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>
            </div>
          </section>

          {/* Rebalancing Section */}
          <section className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Rebalancing
              </h2>
              <button
                type="button"
                onClick={saveRebalancingSettings}
                disabled={
                  JSON.stringify(rebalancingSettings) ===
                  JSON.stringify(savedRebalancingSettings)
                }
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                <Save className="h-4 w-4" aria-hidden />
                Save
              </button>
            </div>
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-6">
                <div>
                  <label
                    htmlFor="rebalance-threshold"
                    className="text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Drift threshold (%)
                  </label>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Trigger rebalance when allocation drifts beyond this
                  </p>
                </div>
                <input
                  id="rebalance-threshold"
                  type="number"
                  min={0}
                  max={100}
                  step={0.5}
                  value={rebalancingSettings.threshold}
                  onChange={(e) =>
                    setRebalancingSettings((s) => ({
                      ...s,
                      threshold: Math.min(
                        100,
                        Math.max(0, Number(e.target.value)),
                      ),
                    }))
                  }
                  className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <div className="flex items-center justify-between gap-6">
                <div>
                  <label
                    htmlFor="rebalance-cooldown"
                    className="text-sm font-medium text-gray-700 dark:text-gray-300"
                  >
                    Cooldown period (hours)
                  </label>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Minimum time between automatic rebalances
                  </p>
                </div>
                <input
                  id="rebalance-cooldown"
                  type="number"
                  min={0}
                  max={720}
                  step={1}
                  value={rebalancingSettings.cooldown}
                  onChange={(e) =>
                    setRebalancingSettings((s) => ({
                      ...s,
                      cooldown: Math.min(
                        720,
                        Math.max(0, Number(e.target.value)),
                      ),
                    }))
                  }
                  className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                />
              </div>
              <label className="flex cursor-pointer items-start gap-4">
                <div className="flex h-5 items-center pt-0.5">
                  <input
                    type="checkbox"
                    checked={rebalancingSettings.autoRebalance}
                    onChange={(e) =>
                      setRebalancingSettings((s) => ({
                        ...s,
                        autoRebalance: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Auto-rebalance
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Automatically rebalance when threshold is exceeded
                  </p>
                </div>
              </label>
            </div>
          </section>

          {/* Notifications Section */}
          <section className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Notifications
              </h2>
              <button
                type="button"
                onClick={saveNotificationSettings}
                disabled={
                  JSON.stringify(notificationSettings) ===
                  JSON.stringify(savedNotificationSettings)
                }
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                <Save className="h-4 w-4" aria-hidden />
                Save
              </button>
            </div>
            <div className="space-y-4">
              <label className="flex cursor-pointer items-start gap-4">
                <div className="flex h-5 items-center pt-0.5">
                  <input
                    type="checkbox"
                    checked={notificationSettings.emailEnabled}
                    onChange={(e) =>
                      setNotificationSettings((s) => ({
                        ...s,
                        emailEnabled: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Email notifications
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Receive alerts via email
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-4">
                <div className="flex h-5 items-center pt-0.5">
                  <input
                    type="checkbox"
                    checked={notificationSettings.webhookEnabled}
                    onChange={(e) =>
                      setNotificationSettings((s) => ({
                        ...s,
                        webhookEnabled: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Webhook notifications
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Send alerts to webhook endpoint
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-4">
                <div className="flex h-5 items-center pt-0.5">
                  <input
                    type="checkbox"
                    checked={notificationSettings.rebalanceAlerts}
                    onChange={(e) =>
                      setNotificationSettings((s) => ({
                        ...s,
                        rebalanceAlerts: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Rebalance alerts
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Notify when rebalancing is needed
                  </p>
                </div>
              </label>
              <label className="flex cursor-pointer items-start gap-4">
                <div className="flex h-5 items-center pt-0.5">
                  <input
                    type="checkbox"
                    checked={notificationSettings.riskAlerts}
                    onChange={(e) =>
                      setNotificationSettings((s) => ({
                        ...s,
                        riskAlerts: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Risk alerts
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Notify on risk threshold breaches
                  </p>
                </div>
              </label>
            </div>
          </section>

          {/* Risk Management Section */}
          <section className="rounded-xl bg-white p-6 shadow-sm dark:bg-gray-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-semibold text-gray-900 dark:text-white">
                Risk Management
              </h2>
              <button
                type="button"
                onClick={saveRiskSettings}
                disabled={
                  JSON.stringify(riskSettings) ===
                  JSON.stringify(savedRiskSettings)
                }
                className="flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50 transition-colors"
              >
                <Save className="h-4 w-4" aria-hidden />
                Save
              </button>
            </div>
            <div className="space-y-4">
              <label className="flex cursor-pointer items-start gap-4">
                <div className="flex h-5 items-center pt-0.5">
                  <input
                    type="checkbox"
                    checked={riskSettings.circuitBreakerEnabled}
                    onChange={(e) =>
                      setRiskSettings((s) => ({
                        ...s,
                        circuitBreakerEnabled: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Circuit breaker
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Pause trading when volatility exceeds threshold
                  </p>
                </div>
              </label>
              {riskSettings.circuitBreakerEnabled && (
                <div className="ml-9 flex items-center justify-between gap-6">
                  <div>
                    <label
                      htmlFor="circuit-breaker-threshold"
                      className="text-sm font-medium text-gray-700 dark:text-gray-300"
                    >
                      Circuit breaker threshold (%)
                    </label>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      Volatility threshold to trigger circuit breaker
                    </p>
                  </div>
                  <input
                    id="circuit-breaker-threshold"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={riskSettings.circuitBreakerThreshold}
                    onChange={(e) =>
                      setRiskSettings((s) => ({
                        ...s,
                        circuitBreakerThreshold: Math.min(
                          100,
                          Math.max(0, Number(e.target.value)),
                        ),
                      }))
                    }
                    className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              )}
              <label className="flex cursor-pointer items-start gap-4">
                <div className="flex h-5 items-center pt-0.5">
                  <input
                    type="checkbox"
                    checked={riskSettings.stopLossEnabled}
                    onChange={(e) =>
                      setRiskSettings((s) => ({
                        ...s,
                        stopLossEnabled: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 dark:border-gray-600"
                  />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Stop-loss
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    Automatically sell assets when they drop below threshold
                  </p>
                </div>
              </label>
              {riskSettings.stopLossEnabled && (
                <div className="ml-9 flex items-center justify-between gap-6">
                  <div>
                    <label
                      htmlFor="stop-loss-percentage"
                      className="text-sm font-medium text-gray-700 dark:text-gray-300"
                    >
                      Stop-loss percentage (%)
                    </label>
                    <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                      Percentage drop to trigger stop-loss
                    </p>
                  </div>
                  <input
                    id="stop-loss-percentage"
                    type="number"
                    min={0}
                    max={100}
                    step={1}
                    value={riskSettings.stopLossPercentage}
                    onChange={(e) =>
                      setRiskSettings((s) => ({
                        ...s,
                        stopLossPercentage: Math.min(
                          100,
                          Math.max(0, Number(e.target.value)),
                        ),
                      }))
                    }
                    className="w-24 rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500 dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                  />
                </div>
              )}
            </div>
          </section>

          {/* Danger Zone Section */}
          <section className="rounded-xl border-2 border-red-200 bg-red-50 p-6 shadow-sm dark:border-red-900 dark:bg-red-950/20">
            <h2 className="mb-4 text-base font-semibold text-red-900 dark:text-red-200">
              Danger Zone
            </h2>
            <div className="space-y-3">
              <button
                type="button"
                onClick={handleArchivePortfolio}
                className="flex w-full items-center justify-between rounded-lg border border-red-300 bg-white px-4 py-3 text-left hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:hover:bg-red-900/40 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-red-900 dark:text-red-200">
                    Archive portfolio
                  </p>
                  <p className="text-xs text-red-700 dark:text-red-300">
                    Hide this portfolio from your dashboard
                  </p>
                </div>
                <Archive className="h-5 w-5 text-red-600 dark:text-red-400" />
              </button>
              <button
                type="button"
                onClick={handleDeletePortfolio}
                className="flex w-full items-center justify-between rounded-lg border border-red-300 bg-white px-4 py-3 text-left hover:bg-red-100 dark:border-red-800 dark:bg-red-950/40 dark:hover:bg-red-900/40 transition-colors"
              >
                <div>
                  <p className="text-sm font-medium text-red-900 dark:text-red-200">
                    Delete portfolio
                  </p>
                  <p className="text-xs text-red-700 dark:text-red-300">
                    Permanently delete this portfolio and all data
                  </p>
                </div>
                <Trash2 className="h-5 w-5 text-red-600 dark:text-red-400" />
              </button>
            </div>
          </section>
        </div>

        {/* Toast notification */}
        {toast && (
          <div className="fixed bottom-4 right-4 z-50">
            <Toast
              title={toast.title}
              description={toast.description}
              tone={toast.tone}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default PortfolioSettings;
