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

                logger.warn('Validation failed', {
                    path: req.originalUrl,
                    errors: formattedErrors
                });

                return fail(res, 422, 'VALIDATION_ERROR', 'Invalid request payload', formattedErrors);
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

                logger.warn('Query validation failed', {
                    path: req.originalUrl,
                    errors: formattedErrors
                });

                return fail(res, 422, 'VALIDATION_ERROR', 'Invalid query parameters', formattedErrors);
            }

            // Express 5 exposes `req.query` as a getter-only accessor, so a plain
            // assignment throws in ESM strict mode. Redefine the property instead.
            Object.defineProperty(req, 'query', {
                value: result.data,
                writable: true,
                configurable: true,
                enumerable: true,
            });
            next();
        } catch (error) {
            logger.error('Unexpected query validation error', { error });
            fail(res, 500, 'INTERNAL_ERROR', 'Internal validation exception');
        }
    };
};
