import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { fail } from '../utils/apiResponse.js';

/**
 * Express middleware to validate request body entirely against a Zod schema.
 * Returns 400 Bad Request securely if validation fails.
 */
export const validateRequest = (schema: ZodSchema) => {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = schema.safeParse(req.body);

            if (!result.success) {
                const error = result.error as ZodError;
                const formattedErrors = error.issues.map(issue => ({
                    field: issue.path.join('.'),
                    message: issue.message
                }));

                logger.warn('Strict Validation Error', {
                    path: req.originalUrl,
                    body: req.body,
                    errors: formattedErrors
                });

                return fail(res, 400, 'VALIDATION_ERROR', 'Invalid request payload', formattedErrors);
            }

            // Optional: Re-assign exactly the strict parsed payload (dropping unknown keys)
            req.body = result.data;
            next();
        } catch (error) {
            logger.error('Unexpected validation error', { error });
            fail(res, 500, 'INTERNAL_ERROR', 'Internal validation exception');
        }
    };
};
