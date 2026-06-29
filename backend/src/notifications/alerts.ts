import { logger } from '../utils/logger.js';
import { notificationService } from '../services/notificationService.js';
import { query } from '../db/client.js';
import { ReflectorService } from '../services/reflector.js';
import { analyticsService } from '../services/analyticsService.js';

export type AlertType = 
  | 'portfolio_value_above' 
  | 'portfolio_value_below' 
  | 'asset_price_above' 
  | 'asset_price_below';

export interface UserAlert {
    id: string;
    userAddress: string;
    portfolioId?: string;
    assetId?: string;
    alertType: AlertType;
    thresholdValue: number;
    isTriggered: boolean;
}

export async function evaluateUserAlerts(): Promise<void> {
    logger.info('[ALERTS] Starting evaluation of user price/portfolio alerts');
    
    try {
        const result = await query<UserAlert>(`
            SELECT 
                id, 
                user_address AS "userAddress", 
                portfolio_id AS "portfolioId", 
                asset_id AS "assetId", 
                alert_type AS "alertType", 
                threshold_value AS "thresholdValue", 
                is_triggered AS "isTriggered" 
            FROM user_alerts
        `);
        
        const alerts: UserAlert[] = result.rows;

        if (alerts.length === 0) {
            return;
        }

        const reflector = new ReflectorService();
        let currentPrices: Record<string, any> | null = null;
        
        const needsPrices = alerts.some(a => a.alertType.startsWith('asset'));
        if (needsPrices) {
            currentPrices = await reflector.getCurrentPrices();
        }

        for (const alert of alerts) {
            await processAlert(alert, currentPrices);
        }
        
        logger.info('[ALERTS] Successfully completed alert evaluation');
    } catch (error) {
        logger.error('[ALERTS] Failed to evaluate user alerts', {
            error: error instanceof Error ? error.message : String(error)
        });
        throw error;
    }
}

async function processAlert(alert: UserAlert, currentPrices: Record<string, any> | null): Promise<void> {
    try {
        let currentValue = 0;
        let targetName = '';

        if (alert.alertType.startsWith('portfolio')) {
            if (!alert.portfolioId) throw new Error('Missing portfolioId for portfolio alert');
            
            const snapshots = analyticsService.getAnalytics(alert.portfolioId, 1);
            if (snapshots && snapshots.length > 0) {
                currentValue = snapshots[snapshots.length - 1].totalValue;
            } else {
                logger.warn(`[ALERTS] No analytics snapshot found for portfolio ${alert.portfolioId}. Skipping...`);
                return;
            }
            targetName = `Portfolio ${alert.portfolioId.substring(0, 8)}...`;
        } else {
            if (!alert.assetId) throw new Error('Missing assetId for asset alert');
            if (!currentPrices) throw new Error('Current prices are not available');
            
            const priceData = currentPrices[alert.assetId];
            if (priceData == null) {
                logger.warn(`[ALERTS] Price missing from reflector for asset ${alert.assetId}. Skipping...`);
                return;
            }
            
            currentValue = typeof priceData === 'number' ? priceData : priceData?.price || 0;
            targetName = `Asset ${alert.assetId}`;
        }

        let currentlyMeetsCondition = false;
        
        switch (alert.alertType) {
            case 'portfolio_value_above':
            case 'asset_price_above':
                currentlyMeetsCondition = currentValue >= alert.thresholdValue;
                break;
            case 'portfolio_value_below':
            case 'asset_price_below':
                currentlyMeetsCondition = currentValue <= alert.thresholdValue;
                break;
        }

        if (currentlyMeetsCondition && !alert.isTriggered) {
            logger.info(`[ALERTS] Alert ${alert.id} triggered for user ${alert.userAddress}`);
            
            await notificationService.notify({
                userId: alert.userAddress,
                eventType: 'priceMovement',
                title: 'Market Alert Triggered',
                message: `${targetName} crossed your threshold. Current value is ${currentValue} (Threshold: ${alert.thresholdValue}).`,
                timestamp: new Date().toISOString()
            });

            await setAlertTriggerState(alert.id, true);

        } else if (!currentlyMeetsCondition && alert.isTriggered) {
            logger.info(`[ALERTS] Alert ${alert.id} reversed. Resetting trigger state.`);
            await setAlertTriggerState(alert.id, false);
        }

    } catch (error) {
        logger.error(`[ALERTS] Failed to process alert ${alert.id}`, {
            error: error instanceof Error ? error.message : String(error)
        });
    }
}

async function setAlertTriggerState(alertId: string, isTriggered: boolean): Promise<void> {
    await query(
        'UPDATE user_alerts SET is_triggered = $1, updated_at = NOW() WHERE id = $2',
        [isTriggered, alertId]
    );
}