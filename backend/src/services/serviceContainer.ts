import { RebalanceHistoryService } from './rebalanceHistory.js'
import { RiskManagementService } from './riskManagements.js'

const riskManagementService = new RiskManagementService()
const rebalanceHistoryService = new RebalanceHistoryService(riskManagementService)

export {
    riskManagementService,
    rebalanceHistoryService
}
