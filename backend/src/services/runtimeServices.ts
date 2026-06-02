import { AutoRebalancerService } from './autoRebalancer.js'

let _autoRebalancerInstance: AutoRebalancerService | null = null

function getAutoRebalancerInstance(): AutoRebalancerService {
	if (!_autoRebalancerInstance) _autoRebalancerInstance = new AutoRebalancerService()
	return _autoRebalancerInstance
}

export const autoRebalancer = {
	start: async () => getAutoRebalancerInstance().start(),
	stop: () => getAutoRebalancerInstance().stop(),
	forceCheck: () => getAutoRebalancerInstance().forceCheck(),
	getStatus: () => getAutoRebalancerInstance().getStatus(),
	getStatistics: () => getAutoRebalancerInstance().getStatistics(),
}
