import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock localStorage to avoid jsdom issues
const store: Record<string, string> = {};
vi.stubGlobal('localStorage', {
  getItem: vi.fn((key: string) => store[key] ?? null),
  setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
  removeItem: vi.fn((key: string) => { delete store[key]; }),
  clear: vi.fn(() => { Object.keys(store).forEach(k => delete store[k]); }),
  get length() { return Object.keys(store).length; },
  key: vi.fn((i: number) => Object.keys(store)[i] ?? null),
});

import { saveWizardDraft, loadWizardDraft, clearWizardDraft } from './wizardDraft';

describe('wizardDraft', () => {
  beforeEach(() => {
    Object.keys(store).forEach(k => delete store[k]);
  });

  it('saves and loads a draft', () => {
    const draft = {
      step: 2,
      selectedTemplateId: 'custom',
      allocations: [{ asset: 'XLM', percentage: 60 }],
      threshold: 5,
      cooldown: 24,
      autoRebalance: true,
      savedAt: new Date().toISOString(),
    };
    saveWizardDraft(draft);
    const loaded = loadWizardDraft();
    expect(loaded).not.toBeNull();
    expect(loaded?.step).toBe(2);
    expect(loaded?.allocations[0].percentage).toBe(60);
  });

  it('returns null when no draft exists', () => {
    clearWizardDraft();
    expect(loadWizardDraft()).toBeNull();
  });

  it('clears an existing draft', () => {
    saveWizardDraft({
      step: 1,
      selectedTemplateId: 'custom',
      allocations: [{ asset: 'XLM', percentage: 100 }],
      threshold: 5,
      cooldown: 24,
      autoRebalance: true,
      savedAt: new Date().toISOString(),
    });
    clearWizardDraft();
    expect(loadWizardDraft()).toBeNull();
  });

  it('returns null for invalid draft data', () => {
    store['portfolio-wizard-draft'] = 'invalid-json';
    expect(loadWizardDraft()).toBeNull();
  });
});
