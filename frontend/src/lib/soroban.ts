/**
 * Soroban contract invocation wrapper.
 * Resolves issue #856: Missing error handling when Soroban invoke response is empty.
 */
import { toast } from 'react-hot-toast'; // assuming react-hot-toast or similar is used, or just console.error

export async function safeInvoke(invokeFn: () => Promise<any>): Promise<any> {
    try {
        const response = await invokeFn();
        
        // Handle empty or malformed responses safely instead of crashing
        if (response === undefined || response === null || response === '') {
            console.error('Soroban invoke returned an empty response');
            toast?.error?.('Received an empty response from the network. Please try again.');
            throw new Error('Empty response body');
        }
        
        return response;
    } catch (error) {
        console.error('Error invoking Soroban contract:', error);
        if (error instanceof Error && error.message !== 'Empty response body') {
            toast?.error?.(`Transaction failed: ${error.message}`);
        }
        throw error;
    }
}
