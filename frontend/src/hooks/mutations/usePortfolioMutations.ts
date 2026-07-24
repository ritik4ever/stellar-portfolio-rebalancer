import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api, ENDPOINTS } from "../../config/api";
import { portfolioKeys } from "../queries/usePortfolioQuery";
import { historyKeys } from "../queries/useHistoryQuery";
import { analyticsKeys } from "../queries/useAnalyticsQuery";

export {
    buildPortfolioCloneDraft,
    savePortfolioCloneDraft,
    loadPortfolioCloneDraft,
    clearPortfolioCloneDraft,
} from '../../utils/portfolioCloneDraft'
export type { PortfolioCloneDraft } from '../../utils/portfolioCloneDraft'

export interface MutationFailureInfo {
  message: string;
  retryable: boolean;
  userMessage?: string;
}

const defaultFailureMessages: Record<string, MutationFailureInfo> = {
  NETWORK_ERROR: {
    message: "Network error. Please check your connection.",
    retryable: true,
    userMessage: "Unable to reach the server. Please try again.",
  },
  BLOCKCHAIN_ERROR: {
    message: "Blockchain transaction failed.",
    retryable: false,
    userMessage:
      "The transaction could not be completed. Please try again later.",
  },
  INSUFFICIENT_BALANCE: {
    message: "Insufficient balance for transaction.",
    retryable: false,
    userMessage: "Insufficient balance to complete this operation.",
  },
  COOLDOWN_ACTIVE: {
    message: "Rebalance cooldown period active.",
    retryable: true,
    userMessage: "Please wait before rebalancing again.",
  },
};

function parseFailureReason(error: unknown): MutationFailureInfo {
  const errorMessage = error instanceof Error ? error.message : String(error);
  const lowerMessage = errorMessage.toLowerCase();

  if (lowerMessage.includes("network") || lowerMessage.includes("fetch")) {
    return defaultFailureMessages.NETWORK_ERROR;
  }
  if (lowerMessage.includes("cooldown")) {
    return defaultFailureMessages.COOLDOWN_ACTIVE;
  }
  if (
    lowerMessage.includes("insufficient") ||
    lowerMessage.includes("balance")
  ) {
    return defaultFailureMessages.INSUFFICIENT_BALANCE;
  }
  if (
    lowerMessage.includes("blockchain") ||
    lowerMessage.includes("transaction")
  ) {
    return defaultFailureMessages.BLOCKCHAIN_ERROR;
  }

  return {
    message: errorMessage,
    retryable: true,
    userMessage: "An unexpected error occurred. Please try again.",
  };
}

export function extractFailureInfo(error: unknown): MutationFailureInfo {
  return parseFailureReason(error);
}
export function buildRollbackMessage(
  error: unknown,
  action = "portfolio update",
): string {
  const failureInfo = parseFailureReason(error);
  const nextStep = failureInfo.retryable
    ? "Please check your connection and try again."
    : "Please review your wallet, balance, and transaction status before trying again.";

  return `Your optimistic ${action} was rolled back because the server rejected it. ${failureInfo.userMessage ?? failureInfo.message} ${nextStep}`;
}

export const useCreatePortfolioMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: any) => api.post<any>(ENDPOINTS.PORTFOLIO, data),
    onSuccess: async (_data: any, variables: any) => {
      await queryClient.invalidateQueries({ queryKey: portfolioKeys.all });
      // Invalidate portfolio details to ensure pie chart updates immediately
      if (variables?.portfolioId) {
        await queryClient.invalidateQueries({ queryKey: portfolioKeys.detail(variables.portfolioId) });
      }
    },
    onError: async (_error: any, _variables: any, _context: any) => {
      await queryClient.invalidateQueries({ queryKey: portfolioKeys.all });
    },
  });
};

export const useImportPortfolioMutation = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: any) => api.post<any>(ENDPOINTS.PORTFOLIO_IMPORT, data),
    onSuccess: async (data: any) => {
      await queryClient.invalidateQueries({ queryKey: portfolioKeys.all });
      if (data?.portfolioId) {
        await queryClient.invalidateQueries({ queryKey: portfolioKeys.detail(data.portfolioId) });
      }
    },
    onError: async () => {
      await queryClient.invalidateQueries({ queryKey: portfolioKeys.all });
    },
  });
};

export const useExecuteRebalanceMutation = (portfolioId: string | null) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      api.post<any>(ENDPOINTS.PORTFOLIO_REBALANCE(portfolioId!)),
    onSuccess: () => {
      if (portfolioId) {
        queryClient.invalidateQueries({
          queryKey: portfolioKeys.detail(portfolioId),
        });
        queryClient.invalidateQueries({
          queryKey: [
            ...portfolioKeys.detail(portfolioId),
            "rebalance-estimate",
          ],
        });
        queryClient.invalidateQueries({
          queryKey: historyKeys.list(portfolioId),
        });
        queryClient.invalidateQueries({
          queryKey: analyticsKeys.portfolio(portfolioId),
        });
      }
    },
    onError: (error: any, _variables: any, _context: any) => {
      const failureInfo = parseFailureReason(error);
      const rollbackMessage = buildRollbackMessage(error, "rebalance");
    console.error("[Mutation:ExecuteRebalance] Failed", {
      portfolioId,
      failure: failureInfo,
      rollbackMessage,
      retryable: failureInfo.retryable,
    });
      queryClient.invalidateQueries({ queryKey: portfolioKeys.all });
    },
  });
};
