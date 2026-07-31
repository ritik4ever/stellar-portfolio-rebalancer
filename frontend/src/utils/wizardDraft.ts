export interface WizardDraftAllocation {
  asset: string;
  percentage: number;
}

export interface WizardDraft {
  step: number;
  selectedTemplateId: string;
  allocations: WizardDraftAllocation[];
  threshold: number;
  cooldown: number;
  autoRebalance: boolean;
  savedAt: string;
}

const WIZARD_DRAFT_KEY = 'portfolio-wizard-draft';

export function saveWizardDraft(draft: WizardDraft): void {
  try {
    localStorage.setItem(WIZARD_DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* ignore */
  }
}

export function loadWizardDraft(): WizardDraft | null {
  try {
    const raw = localStorage.getItem(WIZARD_DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as WizardDraft;
    if (!parsed || typeof parsed.step !== 'number') return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearWizardDraft(): void {
  try {
    localStorage.removeItem(WIZARD_DRAFT_KEY);
  } catch {
    /* ignore */
  }
}
