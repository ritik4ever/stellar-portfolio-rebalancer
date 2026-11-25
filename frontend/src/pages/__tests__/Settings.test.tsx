import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor } from '@testing-library/react';
import Settings from '../Settings';

vi.mock('../../components/ThemeToggle', () => ({ default: () => null }));

function renderSettings() {
  const onNavigate = vi.fn();
  const onDirtyChange = vi.fn();
  const utils = render(<Settings onNavigate={onNavigate} onDirtyChange={onDirtyChange} />);
  return { ...utils, onNavigate, onDirtyChange };
}

function clearLocalStorage() {
  try {
    Object.keys(localStorage).forEach(key => localStorage.removeItem(key));
  } catch { /* ignore */ }
}

describe('Settings Page', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    clearLocalStorage();
  });

  afterEach(() => {
    cleanup();
  });

  it('renders all settings sections', () => {
    renderSettings();
    expect(screen.getByText('Settings')).toBeInTheDocument();
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByText('Privacy')).toBeInTheDocument();
    expect(screen.getByText('Rebalancing')).toBeInTheDocument();
    expect(screen.getByText('Import / Export Settings')).toBeInTheDocument();
  });

  it('renders import/export buttons', () => {
    renderSettings();
    expect(screen.getByText('Export')).toBeInTheDocument();
    expect(screen.getByText('Import')).toBeInTheDocument();
  });

  it.each([1, 50])('saves the inclusive %s%% boundary exactly', (threshold) => {
    renderSettings();
    const input = screen.getByRole('spinbutton', { name: /drift threshold/i });
    fireEvent.change(input, { target: { value: String(threshold) } });
    expect(screen.getByText('Saved threshold is 5%.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /save/i }));
    expect(localStorage.getItem('user-rebalance-threshold')).toBe(String(threshold));
    expect(screen.getByText(`Saved threshold is ${threshold}%.`)).toBeInTheDocument();
  });

  it.each(['', '0.99', '50.01'])('preserves the saved value while rejecting the edit %s', (draft) => {
    localStorage.setItem('user-rebalance-threshold', '20');
    renderSettings();
    const input = screen.getByRole('spinbutton', { name: /drift threshold/i });
    fireEvent.change(input, { target: { value: draft } });
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled();
    expect(localStorage.getItem('user-rebalance-threshold')).toBe('20');
    expect(screen.getByText('Saved threshold is 20%.')).toBeInTheDocument();
  });

  describe('import validation', () => {
    function createFile(data: unknown): File {
      const blob = new Blob([JSON.stringify(data)], { type: 'application/json' });
      return new File([blob], 'settings.json', { type: 'application/json' });
    }

    function uploadFile(file: File) {
      const input = screen.getByTestId('import-file-input');
      fireEvent.change(input, { target: { files: [file] } });
    }

    it('rejects malformed input (not an object)', async () => {
      renderSettings();
      fireEvent.click(screen.getByText('Import'));
      uploadFile(createFile('not-an-object'));

      await waitFor(() => {
        expect(screen.getByText(/File must contain a JSON object/i)).toBeInTheDocument();
      });
    });

    it('rejects missing analyticsOptOut field', async () => {
      renderSettings();
      fireEvent.click(screen.getByText('Import'));
      uploadFile(createFile({ rebalanceThreshold: 10 }));

      await waitFor(() => {
        expect(screen.getByText(/analyticsOptOut/i)).toBeInTheDocument();
      });
    });

    it('rejects invalid rebalanceThreshold type', async () => {
      renderSettings();
      fireEvent.click(screen.getByText('Import'));
      uploadFile(createFile({ analyticsOptOut: false, rebalanceThreshold: 'abc' }));

      await waitFor(() => {
        expect(screen.getByText(/rebalanceThreshold/i)).toBeInTheDocument();
      });
    });

    it('shows preview for well-formed file', async () => {
      renderSettings();
      fireEvent.click(screen.getByText('Import'));
      uploadFile(createFile({ analyticsOptOut: true, rebalanceThreshold: 15 }));

      await waitFor(() => {
        expect(screen.getByTestId('import-preview-modal')).toBeInTheDocument();
      });
      expect(screen.getByText('Opted out')).toBeInTheDocument();
      expect(screen.getByText('15%')).toBeInTheDocument();
    });

    it('applies imported values to form on confirm', async () => {
      renderSettings();
      fireEvent.click(screen.getByText('Import'));
      uploadFile(createFile({ analyticsOptOut: false, rebalanceThreshold: 20 }));

      await waitFor(() => {
        expect(screen.getByTestId('import-preview-modal')).toBeInTheDocument();
      });

      fireEvent.click(screen.getByText('Apply to Form'));

      await waitFor(() => {
        expect(screen.getByText(/Settings imported successfully/i)).toBeInTheDocument();
      });

      const thresholdInput = screen.getByDisplayValue('20');
      expect(thresholdInput).toBeInTheDocument();
    });
  });
});
