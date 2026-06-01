import { Router } from 'express';
import { requireJwt } from '../middleware/requireJwt.js';
import { getContractDiagnostics } from '../services/contractDiagnostics.js';
import { ok, fail } from '../utils/apiResponse.js';
import { logger } from '../utils/logger.js';

const router = Router();

router.get('/diagnostics', requireJwt, async (req, res) => {
  try {
    const summary = await getContractDiagnostics();
    logger.info({ event: 'ops_diagnostics_requested', user: (req as any).user?.address }, 'Diagnostics endpoint called');
    return ok(res, summary);
  } catch (error) {
    logger.error({ event: 'ops_diagnostics_error', error }, 'Failed to fetch contract diagnostics');
    return fail(res, 500, 'INTERNAL_ERROR', 'Failed to fetch diagnostics');
  }
});

export default router;
