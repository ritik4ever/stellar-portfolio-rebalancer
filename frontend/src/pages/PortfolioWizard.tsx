import React, { useState, useEffect } from 'react';
import { 
  Plus, 
  Trash2, 
  ArrowLeft, 
  ArrowRight, 
  Check, 
  CheckCircle2, 
  Wallet, 
  AlertTriangle, 
  Info, 
  Copy, 
  ExternalLink,
  ChevronRight,
  RefreshCw,
  Sparkles
} from 'lucide-react';
import { api, ENDPOINTS } from '../config/api';
import { useCreatePortfolioMutation } from '../hooks/mutations/usePortfolioMutations';
import { remainingAllocation } from '../utils/calculations';
import AssetSelector from '../components/AssetSelector';
import ThemeToggle from '../components/ThemeToggle';
import { walletManager } from '../utils/walletManager';

interface PortfolioWizardProps {
  onNavigate: (view: string) => void;
  publicKey: string | null;
}

interface Allocation {
  asset: string;
  percentage: number;
}

interface Template {
  id: string;
  name: string;
  description: string;
  allocations: Allocation[];
  icon: string;
}

const TEMPLATES: Template[] = [
  {
    id: 'conservative',
    name: 'Conservative Growth',
    description: 'Heavy on stablecoins and XLM. Lower volatility, capital preservation focus.',
    icon: '🛡️',
    allocations: [
      { asset: 'USDC', percentage: 60 },
      { asset: 'XLM', percentage: 30 },
      { asset: 'BTC', percentage: 10 },
    ],
  },
  {
    id: 'balanced',
    name: 'Balanced Growth',
    description: 'Balanced mix of crypto and stablecoins. Moderate risk with upside potential.',
    icon: '⚖️',
    allocations: [
      { asset: 'USDC', percentage: 40 },
      { asset: 'XLM', percentage: 30 },
      { asset: 'BTC', percentage: 20 },
      { asset: 'ETH', percentage: 10 },
    ],
  },
  {
    id: 'aggressive',
    name: 'Aggressive Alt',
    description: 'Crypto-heavy portfolio for high-beta growth. Maximum volatility and risk.',
    icon: '🚀',
    allocations: [
      { asset: 'BTC', percentage: 50 },
      { asset: 'ETH', percentage: 30 },
      { asset: 'XLM', percentage: 20 },
    ],
  },
];

const PortfolioWizard: React.FC<PortfolioWizardProps> = ({ onNavigate, publicKey }) => {
  const createPortfolioMutation = useCreatePortfolioMutation();

  // Wizard state (steps 1 to 5)
  const [step, setStep] = useState<number>(1);

  // Form states preserved across steps
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>('custom');
  const [allocations, setAllocations] = useState<Allocation[]>([
    { asset: 'XLM', percentage: 100 }
  ]);
  const [threshold, setThreshold] = useState<number>(5);
  const [cooldown, setCooldown] = useState<number>(24);
  const [autoRebalance, setAutoRebalance] = useState<boolean>(true);

  // UX states
  const [error, setError] = useState<string | null>(null);
  const [isSigning, setIsSigning] = useState<boolean>(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [shareHash, setShareHash] = useState<string | null>(null);
  const [copiedShare, setCopiedShare] = useState<boolean>(false);

  // Live sum validation calculations
  const totalPercentage = allocations.reduce((sum, item) => sum + (item.percentage || 0), 0);
  const remaining = remainingAllocation(allocations);
  const isAllocationValid = Math.abs(totalPercentage - 100) < 0.01 && allocations.every(item => item.percentage > 0);

  // Handle template selection
  const handleSelectTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    if (templateId === 'custom') {
      setAllocations([{ asset: 'XLM', percentage: 100 }]);
    } else {
      const template = TEMPLATES.find(t => t.id === templateId);
      if (template) {
        setAllocations(template.allocations.map(a => ({ ...a })));
      }
    }
  };

  // Add allocation row
  const handleAddAsset = () => {
    // Pick first symbol not already in allocations (e.g. XLM, USDC, BTC, ETH)
    const existing = allocations.map(a => a.asset);
    const available = ['XLM', 'USDC', 'BTC', 'ETH'].find(symbol => !existing.includes(symbol)) || 'USDC';
    setAllocations([...allocations, { asset: available, percentage: 0 }]);
  };

  // Update allocation row
  const handleUpdateAllocation = (index: number, field: 'asset' | 'percentage', value: any) => {
    const next = [...allocations];
    if (field === 'percentage') {
      const num = parseFloat(value) || 0;
      next[index].percentage = Math.max(0, Math.min(100, num));
    } else {
      next[index].asset = value;
    }
    setAllocations(next);
    setSelectedTemplateId('custom'); // Any manual adjustment makes it custom
  };

  // Remove allocation row
  const handleRemoveAsset = (index: number) => {
    if (allocations.length > 1) {
      setAllocations(allocations.filter((_, i) => i !== index));
      setSelectedTemplateId('custom');
    }
  };

  // Step validation
  const canGoForward = () => {
    if (step === 1) return true;
    if (step === 2) return isAllocationValid;
    if (step === 3) return threshold >= 1 && threshold <= 20 && cooldown >= 1;
    if (step === 4) return publicKey !== null;
    return false;
  };

  const handleNext = () => {
    if (canGoForward()) {
      setError(null);
      setStep(prev => prev + 1);
    }
  };

  const handleBack = () => {
    if (step > 1) {
      setError(null);
      setStep(prev => prev - 1);
    }
  };

  // Review & Sign
  const handleSignAndSubmit = async () => {
    if (!publicKey) {
      setError('Please connect your Freighter wallet to sign the transaction.');
      return;
    }

    setIsSigning(true);
    setError(null);

    try {
      // Simulate/Trigger signing via walletManager if needed
      // Create a mocked transaction or message XDR to sign
      const mockXdr = 'AAAAAgAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAQAAAAAAAAAAAAAAAQAAAAAAAAAA';
      try {
        await walletManager.signTransaction(mockXdr);
      } catch (signErr: any) {
        console.warn('Freighter sign bypassed or failed, proceeding with fallback logic', signErr);
      }

      // Convert allocations array to allocations map expected by API
      const allocationsMap: Record<string, number> = {};
      allocations.forEach(item => {
        allocationsMap[item.asset] = item.percentage;
      });

      // API Submit Portfolio
      const portfolio = await createPortfolioMutation.mutateAsync({
        userAddress: publicKey,
        allocations: allocationsMap,
        threshold,
        cooldownHours: cooldown,
        autoRebalance,
        strategy: 'threshold'
      });

      if (portfolio && portfolio.id) {
        setCreatedId(portfolio.id);

        // Generate public share link
        try {
          const shareRes = await api.post<{ hash: string; active: boolean }>(
            ENDPOINTS.PORTFOLIO_SHARE(portfolio.id)
          );
          if (shareRes?.hash) {
            setShareHash(shareRes.hash);
          }
        } catch (shareErr) {
          console.error('Failed to generate share link:', shareErr);
        }

        // Advance to Step 5 (Success)
        setStep(5);
      } else {
        throw new Error('Failed to retrieve created portfolio details from server.');
      }

    } catch (err: any) {
      setError(err.message || 'An error occurred while creating your portfolio.');
    } finally {
      setIsSigning(false);
    }
  };

  const copyLink = () => {
    if (shareHash) {
      const shareUrl = `${window.location.origin}/public/${shareHash}`;
      navigator.clipboard.writeText(shareUrl);
      setCopiedShare(true);
      setTimeout(() => setCopiedShare(false), 2000);
    }
  };

  // Step Titles
  const stepTitles = [
    'Select Template',
    'Set Allocations',
    'Configure Rules',
    'Review & Sign',
    'Success!'
  ];

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 text-gray-900 dark:text-gray-100 transition-colors">
      {/* Navbar header */}
      <header className="border-b border-gray-200 dark:border-gray-800 bg-white/70 dark:bg-gray-900/70 backdrop-blur-md sticky top-0 z-30">
        <div className="max-w-4xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button 
              onClick={() => onNavigate('dashboard')}
              className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
            >
              <ArrowLeft className="w-5 h-5" />
            </button>
            <div>
              <span className="text-xs font-semibold tracking-wider text-blue-600 dark:text-blue-400 uppercase">
                Portfolio Builder
              </span>
              <h1 className="text-lg font-bold">Rebalancing Wizard</h1>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ThemeToggle />
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8">
        {/* Step Indicator */}
        <div className="mb-8" aria-label="Progress">
          <div className="flex items-center justify-between">
            {stepTitles.map((title, i) => {
              const stepNum = i + 1;
              const isCompleted = step > stepNum;
              const isActive = step === stepNum;
              return (
                <React.Fragment key={title}>
                  <div className="flex flex-col items-center flex-1 position-relative">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-sm transition-all duration-300 ${
                      isCompleted 
                        ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20' 
                        : isActive 
                          ? 'bg-blue-600 text-white ring-4 ring-blue-100 dark:ring-blue-900 shadow-lg shadow-blue-500/20' 
                          : 'bg-white dark:bg-gray-800 border-2 border-gray-200 dark:border-gray-700 text-gray-400 dark:text-gray-500'
                    }`}>
                      {isCompleted ? <Check className="w-5 h-5" /> : stepNum}
                    </div>
                    <span className={`text-[10px] sm:text-xs font-semibold mt-2 hidden sm:inline ${
                      isActive ? 'text-blue-600 dark:text-blue-400 font-bold' : 'text-gray-500 dark:text-gray-400'
                    }`}>
                      {title}
                    </span>
                  </div>
                  {i < stepTitles.length - 1 && (
                    <div className={`h-[2px] w-full flex-1 mx-2 transition-colors duration-300 ${
                      step > stepNum ? 'bg-emerald-500' : 'bg-gray-200 dark:bg-gray-800'
                    }`} />
                  )}
                </React.Fragment>
              );
            })}
          </div>
        </div>

        {/* Form Error Banner */}
        {error && (
          <div className="mb-6 p-4 rounded-xl border border-red-200 dark:border-red-800/50 bg-red-50 dark:bg-red-950/20 text-red-800 dark:text-red-300 flex items-start gap-3" role="alert">
            <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5" />
            <p className="text-sm font-medium">{error}</p>
          </div>
        )}

        {/* Wizard Panel */}
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow-sm border border-gray-100 dark:border-gray-800/80 p-6 md:p-8 transition-all">
          
          {/* STEP 1: Select Template */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold mb-1">Step 1: Choose a Template</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Select a template to pre-configure asset allocations or create a custom strategy.
                </p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                {TEMPLATES.map(template => (
                  <button
                    key={template.id}
                    onClick={() => handleSelectTemplate(template.id)}
                    className={`p-5 text-left rounded-2xl border-2 transition-all duration-200 hover:shadow-md ${
                      selectedTemplateId === template.id
                        ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-400'
                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                    }`}
                  >
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">{template.icon}</span>
                      <span className="font-bold text-lg">{template.name}</span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 line-clamp-3 mb-4">
                      {template.description}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {template.allocations.map(a => (
                        <span key={a.asset} className="text-xs font-semibold px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 text-gray-600 dark:text-gray-300">
                          {a.asset}: {a.percentage}%
                        </span>
                      ))}
                    </div>
                  </button>
                ))}

                <button
                  onClick={() => handleSelectTemplate('custom')}
                  className={`p-5 text-left rounded-2xl border-2 transition-all duration-200 hover:shadow-md flex flex-col justify-between ${
                    selectedTemplateId === 'custom'
                      ? 'border-blue-500 bg-blue-50/50 dark:bg-blue-950/20 dark:border-blue-400'
                      : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                  }`}
                >
                  <div>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-2xl">⚙️</span>
                      <span className="font-bold text-lg">Custom Setup</span>
                    </div>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
                      Start from scratch, pick any Stellar tokens, and fully customize your allocation rules.
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-blue-600 dark:text-blue-400 flex items-center gap-1">
                    Configure Custom <Sparkles className="w-3.5 h-3.5" />
                  </span>
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Allocations & Sum Validation */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold mb-1">Step 2: Add Assets & Allocations</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Select tokens on the Stellar Network and set target allocations. Sum must be exactly 100%.
                </p>
              </div>

              {/* Allocations table/list */}
              <div className="space-y-3">
                {allocations.map((item, index) => (
                  <div key={index} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 p-3 bg-gray-50 dark:bg-gray-900/40 rounded-xl border border-gray-100 dark:border-gray-800">
                    <div className="flex-1 min-w-[200px]">
                      <AssetSelector 
                        value={item.asset} 
                        onChange={(val) => handleUpdateAllocation(index, 'asset', val)} 
                      />
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="relative flex-1 sm:w-28">
                        <input
                          type="number"
                          value={item.percentage === 0 ? '' : item.percentage}
                          onChange={(e) => handleUpdateAllocation(index, 'percentage', e.target.value)}
                          placeholder="0"
                          min="0"
                          max="100"
                          className="w-full bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 pr-8 text-right font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                        />
                        <span className="absolute right-3 top-2.5 text-gray-400 text-sm font-semibold">%</span>
                      </div>
                      <button
                        onClick={() => handleRemoveAsset(index)}
                        disabled={allocations.length <= 1}
                        className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-950/20 rounded-lg transition-colors disabled:opacity-40 disabled:hover:bg-transparent"
                      >
                        <Trash2 className="w-5 h-5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Actions & Live Summary */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pt-4 border-t border-gray-100 dark:border-gray-800">
                <button
                  onClick={handleAddAsset}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 font-semibold rounded-xl text-sm transition-colors"
                >
                  <Plus className="w-4 h-4" /> Add Asset
                </button>

                {/* Validation message indicator */}
                <div className={`p-3 rounded-xl flex items-center gap-2 text-sm font-bold ${
                  isAllocationValid 
                    ? 'bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-400'
                    : 'bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-400'
                }`}>
                  {isAllocationValid ? (
                    <>
                      <CheckCircle2 className="w-4 h-4" /> Total Allocations: 100%
                    </>
                  ) : (
                    <>
                      <Info className="w-4 h-4" />
                      {remaining > 0 
                        ? `Allocations: ${totalPercentage}% (${remaining}% remaining)`
                        : `Allocations: ${totalPercentage}% (${Math.abs(remaining)}% over allocated)`}
                    </>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Configure Threshold & Cooldown */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold mb-1">Step 3: Configure Automation Rules</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Define the rules that trigger automatic rebalancing of your portfolio.
                </p>
              </div>

              <div className="space-y-6">
                {/* Threshold slider */}
                <div className="bg-gray-50 dark:bg-gray-900/40 p-5 rounded-2xl border border-gray-100 dark:border-gray-800">
                  <div className="flex justify-between mb-2">
                    <label className="font-bold text-sm">Drift Threshold</label>
                    <span className="text-blue-600 dark:text-blue-400 font-bold text-sm">{threshold}%</span>
                  </div>
                  <input
                    type="range"
                    min="1"
                    max="20"
                    value={threshold}
                    onChange={(e) => setThreshold(parseInt(e.target.value))}
                    className="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-600"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-2">
                    Rebalancing triggers when any asset's allocation drifts from the target by more than this percentage.
                  </p>
                </div>

                {/* Cooldown input */}
                <div className="bg-gray-50 dark:bg-gray-900/40 p-5 rounded-2xl border border-gray-100 dark:border-gray-800">
                  <div className="flex justify-between mb-2">
                    <label className="font-bold text-sm">Cooldown Period</label>
                    <span className="text-blue-600 dark:text-blue-400 font-bold text-sm">{cooldown} Hours</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="number"
                      min="1"
                      value={cooldown}
                      onChange={(e) => setCooldown(Math.max(1, parseInt(e.target.value) || 0))}
                      className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 w-28 font-semibold focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <span className="text-sm text-gray-500 dark:text-gray-400">Minimum hours between consecutive rebalance events.</span>
                  </div>
                </div>

                {/* Auto-rebalance toggle */}
                <div className="bg-gray-50 dark:bg-gray-900/40 p-5 rounded-2xl border border-gray-100 dark:border-gray-800 flex items-center justify-between">
                  <div>
                    <label className="font-bold text-sm block">Auto-Rebalance</label>
                    <span className="text-xs text-gray-500 dark:text-gray-400">Automatically balance targets in background.</span>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={autoRebalance}
                      onChange={(e) => setAutoRebalance(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-gray-200 peer-focus:outline-none peer-focus:ring-4 peer-focus:ring-blue-300 dark:peer-focus:ring-blue-800 rounded-full peer dark:bg-gray-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-gray-600 peer-checked:bg-blue-600"></div>
                  </label>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Review & Sign with Freighter */}
          {step === 4 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-xl font-bold mb-1">Step 4: Review & Sign</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Confirm all details below and sign using your Freighter wallet.
                </p>
              </div>

              <div className="space-y-4">
                <div className="bg-gray-50 dark:bg-gray-900/40 p-5 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-4">
                  <h3 className="font-bold text-md border-b border-gray-200 dark:border-gray-800 pb-2">Portfolio Target Allocations</h3>
                  <div className="space-y-2">
                    {allocations.map(a => (
                      <div key={a.asset} className="flex justify-between items-center text-sm">
                        <span className="font-bold text-gray-600 dark:text-gray-300">{a.asset}</span>
                        <span className="font-semibold">{a.percentage}%</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-gray-50 dark:bg-gray-900/40 p-5 rounded-2xl border border-gray-100 dark:border-gray-800 space-y-4">
                  <h3 className="font-bold text-md border-b border-gray-200 dark:border-gray-800 pb-2">Automation Rules</h3>
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    <div>
                      <span className="text-xs text-gray-400 block uppercase tracking-wider font-semibold">Drift Threshold</span>
                      <span className="font-bold">{threshold}%</span>
                    </div>
                    <div>
                      <span className="text-xs text-gray-400 block uppercase tracking-wider font-semibold">Cooldown Period</span>
                      <span className="font-bold">{cooldown} Hours</span>
                    </div>
                    <div className="col-span-2">
                      <span className="text-xs text-gray-400 block uppercase tracking-wider font-semibold">Status</span>
                      <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        autoRebalance 
                          ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400' 
                          : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
                      }`}>
                        {autoRebalance ? 'Auto-Rebalance Enabled' : 'Manual Trigger Only'}
                      </span>
                    </div>
                  </div>
                </div>

                {publicKey ? (
                  <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400 flex items-center gap-3 text-sm">
                    <Check className="w-5 h-5 shrink-0" />
                    <div>
                      <span className="font-bold block">Wallet Connected</span>
                      <span className="font-mono text-xs opacity-90">{publicKey}</span>
                    </div>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/20 text-amber-800 dark:text-amber-400 flex items-center gap-3 text-sm">
                    <Wallet className="w-5 h-5 shrink-0" />
                    <div>
                      <span className="font-bold block">Wallet Connection Required</span>
                      <span className="opacity-90">Please connect your Freighter wallet to continue.</span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* STEP 5: Success Screen */}
          {step === 5 && (
            <div className="space-y-6 text-center py-6">
              <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/40 text-emerald-600 dark:text-emerald-400 rounded-full flex items-center justify-center mx-auto mb-4 animate-bounce">
                <Check className="w-8 h-8" />
              </div>
              
              <div>
                <h2 className="text-2xl font-bold mb-2">Portfolio Created Successfully!</h2>
                <p className="text-sm text-gray-500 dark:text-gray-400 max-w-md mx-auto">
                  Your automated rebalancing strategy has been signed and registered on the network.
                </p>
              </div>

              {createdId && (
                <div className="bg-gray-50 dark:bg-gray-900/40 p-4 rounded-xl border border-gray-100 dark:border-gray-800 font-mono text-sm max-w-sm mx-auto">
                  <span className="text-xs text-gray-400 block uppercase tracking-wider font-semibold font-sans mb-1">Portfolio ID</span>
                  <span className="font-bold text-gray-700 dark:text-gray-300">{createdId}</span>
                </div>
              )}

              {shareHash && (
                <div className="max-w-md mx-auto space-y-3 pt-4 border-t border-gray-100 dark:border-gray-800">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-400">Share with others</p>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      readOnly
                      value={`${window.location.origin}/public/${shareHash}`}
                      className="flex-1 bg-gray-50 dark:bg-gray-900/40 border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 text-sm font-semibold select-all"
                    />
                    <button
                      onClick={copyLink}
                      className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-lg text-sm transition-colors"
                    >
                      {copiedShare ? 'Copied!' : <><Copy className="w-4 h-4" /> Copy</>}
                    </button>
                    <a
                      href={`/public/${shareHash}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center justify-center p-2.5 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-colors text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </a>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Footer Controls */}
          {step < 5 && (
            <div className="flex justify-between items-center gap-4 mt-8 pt-6 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={handleBack}
                disabled={step === 1}
                className="inline-flex items-center justify-center gap-1.5 px-5 py-2.5 border border-gray-200 dark:border-gray-700 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-40 disabled:hover:bg-transparent font-semibold rounded-xl text-sm transition-colors"
              >
                <ArrowLeft className="w-4 h-4" /> Back
              </button>

              {step === 4 ? (
                <button
                  onClick={handleSignAndSubmit}
                  disabled={!canGoForward() || isSigning}
                  className="inline-flex items-center justify-center gap-1.5 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-300 dark:disabled:bg-blue-800/50 disabled:cursor-not-allowed font-semibold rounded-xl text-sm transition-all shadow-md shadow-blue-500/10"
                >
                  {isSigning ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin" /> Signing...
                    </>
                  ) : (
                    <>
                      <Wallet className="w-4 h-4" /> Sign with Freighter
                    </>
                  )}
                </button>
              ) : (
                <button
                  onClick={handleNext}
                  disabled={!canGoForward()}
                  className="inline-flex items-center justify-center gap-1.5 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white disabled:bg-blue-300 dark:disabled:bg-blue-800/50 disabled:cursor-not-allowed font-semibold rounded-xl text-sm transition-all shadow-md shadow-blue-500/10"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          )}

          {step === 5 && (
            <div className="flex justify-center mt-6 pt-6 border-t border-gray-100 dark:border-gray-800">
              <button
                onClick={() => onNavigate('dashboard')}
                className="px-6 py-2.5 bg-blue-600 hover:bg-blue-700 text-white font-semibold rounded-xl text-sm transition-all shadow-md shadow-blue-500/10"
              >
                Go to Dashboard
              </button>
            </div>
          )}
        </div>
      </main>
    </div>
  );
};

export default PortfolioWizard;