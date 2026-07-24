import type { BulkImportValidationError } from '../services/portfolioImportService.js'

export function failValidation(res: any, err: BulkImportValidationError) {
  return res.status(400).json({
    error: 'VALIDATION_ERROR',
    message: err.message,
    code: err.code,
    errors: err.errors,
    meta: {
      totalRows: err.totalRows,
      validRows: err.validRows,
    },
  })
}

