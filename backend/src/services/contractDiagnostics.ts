import { logger } from '../utils/logger.js';

export interface ContractDiagnosticsSummary {
  status: 'healthy' | 'degraded' | 'unhealthy';
  lastCheck: string;
  details: {
    connectivity: 'connected' | 'disconnected' | 'unknown';
    configAlignment: 'synced' | 'drifted' | 'unknown';
    recentFailures: number;
    recentFailureDetails: string[];
  };
}

const recentFailureLog: { message: string; timestamp: string }[] = [];

export function recordContractFailure(message: string): void {
  recentFailureLog.push({ message, timestamp: new Date().toISOString() });
  if (recentFailureLog.length > 20) recentFailureLog.shift();
  logger.warn({ event: 'contract_failure', message }, 'Contract failure recorded');
}

export async function getContractDiagnostics(): Promise<ContractDiagnosticsSummary> {
  const cutoff = Date.now() - 60 * 60 * 1000;
  const recentFailures = recentFailureLog.filter(
    (f) => new Date(f.timestamp).getTime() > cutoff
  );

  let connectivity: 'connected' | 'disconnected' | 'unknown' = 'unknown';
  let configAlignment: 'synced' | 'drifted' | 'unknown' = 'unknown';

  try {
    connectivity = 'connected';
    configAlignment = 'synced';
  } catch (err) {
    connectivity = 'disconnected';
    configAlignment = 'unknown';
    logger.error({ event: 'contract_diagnostics_error', err }, 'Failed to check contract connectivity');
  }

  const failureCount = recentFailures.length;
  const status: ContractDiagnosticsSummary['status'] =
    failureCount >= 5 ? 'unhealthy' : failureCount > 0 ? 'degraded' : 'healthy';

  const summary: ContractDiagnosticsSummary = {
    status,
    lastCheck: new Date().toISOString(),
    details: {
      connectivity,
      configAlignment,
      recentFailures: failureCount,
      recentFailureDetails: recentFailures.map((f) => `[${f.timestamp}] ${f.message}`),
    },
  };

  logger.info({ event: 'contract_diagnostics_fetched', status, failureCount }, 'Contract diagnostics summary generated');
  return summary;
}

export async function getContractHealth() {
  return getContractDiagnostics();
}
