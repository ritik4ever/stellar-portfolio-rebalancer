import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { logger } from '../utils/logger.js';
import { fail } from '../utils/apiResponse.js';

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

            req.body = result.data;
            next();
        } catch (error) {
            logger.error('Unexpected validation error', { error });
            fail(res, 500, 'INTERNAL_ERROR', 'Internal validation exception');
        }
    };
};

export const validateQuery = (schema: ZodSchema) => {
    return (req: Request, res: Response, next: NextFunction) => {
        try {
            const result = schema.safeParse(req.query);

            if (!result.success) {
                const error = result.error as ZodError;
                const formattedErrors = error.issues.map(issue => ({
                    field: issue.path.join('.'),
                    message: issue.message
                }));

                logger.warn('Query Validation Error', {
                    path: req.originalUrl,
                    query: req.query,
                    errors: formattedErrors
                });

                return fail(res, 400, 'VALIDATION_ERROR', 'Invalid query parameters', formattedErrors);
            }

            req.query = result.data as typeof req.query;
            next();
        } catch (error) {
            logger.error('Unexpected query validation error', { error });
            fail(res, 500, 'INTERNAL_ERROR', 'Internal validation exception');
        }
    };
};
