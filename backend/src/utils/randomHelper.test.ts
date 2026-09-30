/**
 * Tests for randomHelper utility functions
 */

import { describe, it, expect } from 'vitest';
import {
  generateRandomString,
  randomInt,
  shuffleArray,
  randomPick,
  generateUUID,
  sleep,
  retryWithBackoff
} from './randomHelper.js';

describe('randomHelper', () => {
  describe('generateRandomString', () => {
    it('should generate string of default length 8', () => {
      const result = generateRandomString();
      expect(result).toHaveLength(8);
    });

    it('should generate string of specified length', () => {
      const result = generateRandomString(16);
      expect(result).toHaveLength(16);
    });

    it('should generate alphanumeric characters only', () => {
      const result = generateRandomString(100);
      expect(result).toMatch(/^[A-Za-z0-9]+$/);
    });
  });

  describe('randomInt', () => {
    it('should generate integer within range', () => {
      const result = randomInt(1, 10);
      expect(result).toBeGreaterThanOrEqual(1);
      expect(result).toBeLessThanOrEqual(10);
    });

    it('should handle same min and max', () => {
      const result = randomInt(5, 5);
      expect(result).toBe(5);
    });
  });

  describe('shuffleArray', () => {
    it('should return array of same length', () => {
      const input = [1, 2, 3, 4, 5];
      const result = shuffleArray(input);
      expect(result).toHaveLength(input.length);
    });

    it('should not mutate original array', () => {
      const input = [1, 2, 3, 4, 5];
      shuffleArray(input);
      expect(input).toEqual([1, 2, 3, 4, 5]);
    });

    it('should contain same elements', () => {
      const input = [1, 2, 3, 4, 5];
      const result = shuffleArray(input);
      expect(result.sort()).toEqual(input.sort());
    });
  });

  describe('randomPick', () => {
    it('should pick an element from array', () => {
      const input = [1, 2, 3, 4, 5];
      const result = randomPick(input);
      expect(input).toContain(result);
    });

    it('should pick from single element array', () => {
      const input = [42];
      const result = randomPick(input);
      expect(result).toBe(42);
    });
  });

  describe('generateUUID', () => {
    it('should generate UUID v4 format', () => {
      const result = generateUUID();
      expect(result).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i);
    });

    it('should generate different UUIDs', () => {
      const uuid1 = generateUUID();
      const uuid2 = generateUUID();
      expect(uuid1).not.toBe(uuid2);
    });
  });

  describe('sleep', () => {
    it('should resolve after specified time', async () => {
      const start = Date.now();
      await sleep(100);
      const elapsed = Date.now() - start;
      expect(elapsed).toBeGreaterThanOrEqual(100);
    });
  });

  describe('retryWithBackoff', () => {
    it('should succeed on first try', async () => {
      const fn = async () => 'success';
      const result = await retryWithBackoff(fn);
      expect(result).toBe('success');
    });

    it('should retry on failure', async () => {
      let attempts = 0;
      const fn = async () => {
        attempts++;
        if (attempts < 2) throw new Error('fail');
        return 'success';
      };
      const result = await retryWithBackoff(fn, 3, 10);
      expect(result).toBe('success');
      expect(attempts).toBe(2);
    });

    it('should throw after max retries', async () => {
      const fn = async () => {
        throw new Error('fail');
      };
      await expect(retryWithBackoff(fn, 2, 10)).rejects.toThrow('fail');
    });
  });
});
