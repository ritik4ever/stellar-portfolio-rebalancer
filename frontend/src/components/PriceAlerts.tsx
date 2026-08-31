import { useState, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Edit2, Bell, Mail, Link, AlertTriangle, CheckCircle2, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface PriceCondition {
  asset: string
  upperThreshold?: number
  lowerThreshold?: number
}

interface PriceAlert {
  id: string
  conditions: PriceCondition[]
  logic: 'AND' | 'OR'
  alertType: 'email' | 'webhook'
  webhookUrl?: string
  email?: string
  active: boolean
  createdAt: number
}

interface PriceAlertsProps {
  publicKey: string | null
}

const DEFAULT_ASSETS = ['XLM', 'USDC', 'BTC', 'ETH']

function formatConditionSummary(condition: PriceCondition, logic?: 'AND' | 'OR', isFirst?: boolean): string {
  const parts: string[] = []
  if (condition.upperThreshold !== undefined) {
    parts.push(`${condition.asset} < $${condition.upperThreshold.toLocaleString()}`)
  }
  if (condition.lowerThreshold !== undefined) {
    parts.push(`${condition.asset} > $${condition.lowerThreshold.toLocaleString()}`)
  }
  if (parts.length === 1 && logic && !isFirst) {
    return `${logic === 'AND' ? 'AND' : 'OR'} ${parts[0]}`
  }
  return parts.join(' AND ')
}

function formatAlertSummary(alert: PriceAlert): string {
  if (alert.conditions.length === 0) return 'No conditions'
  const parts = alert.conditions.map((c, i) => formatConditionSummary(c, alert.logic, i === 0))
  if (alert.conditions.length === 1) return parts[0]
  return parts.join(` ${alert.logic === 'AND' ? 'AND' : 'OR'} `)
}

const PriceAlerts: React.FC<PriceAlertsProps> = ({ publicKey }) => {
  const { t } = useTranslation()
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingAlert, setEditingAlert] = useState<PriceAlert | null>(null)
  const [formConditions, setFormConditions] = useState<PriceCondition[]>([
    { asset: 'XLM', upperThreshold: undefined, lowerThreshold: undefined }
  ])
  const [formLogic, setFormLogic] = useState<'AND' | 'OR'>('AND')
  const [formAlertType, setFormAlertType] = useState<'email' | 'webhook'>('email')
  const [formWebhookUrl, setFormWebhookUrl] = useState('')
  const [formEmail, setFormEmail] = useState('')
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({
    XLM: 0.354,
    USDC: 1.0,
    BTC: 110000,
    ETH: 4200
  })

  useEffect(() => {
    if (publicKey) {
      const saved = localStorage.getItem(`priceAlerts_${publicKey}`)
      if (saved) {
        try {
          const parsed = JSON.parse(saved)
          const migrated = parsed.map((a: any) => {
            if (a.conditions) return a as PriceAlert
            return {
              id: a.id,
              conditions: [{ asset: a.asset, upperThreshold: a.upperThreshold, lowerThreshold: a.lowerThreshold }],
              logic: 'AND' as const,
              alertType: a.alertType,
              webhookUrl: a.webhookUrl,
              email: a.email,
              active: a.active,
              createdAt: a.createdAt
            }
          })
          setAlerts(migrated)
        } catch { /* ignore corrupt data */ }
      }
    }
  }, [publicKey])

  useEffect(() => {
    if (publicKey) {
      localStorage.setItem(`priceAlerts_${publicKey}`, JSON.stringify(alerts))
    }
  }, [alerts, publicKey])

  const validateForm = () => {
    if (formConditions.length === 0) {
      return { valid: false, error: 'At least one condition is required' }
    }
    for (const cond of formConditions) {
      const upper = cond.upperThreshold
      const lower = cond.lowerThreshold
      if (upper !== undefined && (!Number.isFinite(upper) || upper <= 0)) {
        return { valid: false, error: 'Upper thresholds must be positive numbers' }
      }
      if (lower !== undefined && (!Number.isFinite(lower) || lower <= 0)) {
        return { valid: false, error: 'Lower thresholds must be positive numbers' }
      }
      if (upper !== undefined && lower !== undefined && upper <= lower) {
        return { valid: false, error: 'Upper threshold must be greater than lower threshold for each condition' }
      }
    }
    if (formAlertType === 'webhook' && !formWebhookUrl) {
      return { valid: false, error: t('priceAlerts.validation.validUrl') }
    }
    if (formAlertType === 'email' && !formEmail) {
      return { valid: false, error: 'Please enter an email address' }
    }
    return { valid: true, error: null }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const validation = validateForm()
    if (!validation.valid) {
      alert(validation.error)
      return
    }

    const alertData: PriceAlert = {
      id: editingAlert?.id || `alert_${Date.now()}`,
      conditions: formConditions.map(c => ({
        asset: c.asset,
        upperThreshold: c.upperThreshold,
        lowerThreshold: c.lowerThreshold,
      })),
      logic: formLogic,
      alertType: formAlertType,
      webhookUrl: formAlertType === 'webhook' ? formWebhookUrl : undefined,
      email: formAlertType === 'email' ? formEmail : undefined,
      active: true,
      createdAt: editingAlert?.createdAt || Date.now()
    }

    if (editingAlert) {
      setAlerts(prev => prev.map(a => a.id === editingAlert.id ? alertData : a))
    } else {
      setAlerts(prev => [...prev, alertData])
    }

    resetForm()
  }

  const addCondition = () => {
    setFormConditions(prev => [...prev, { asset: 'XLM', upperThreshold: undefined, lowerThreshold: undefined }])
  }

  const removeCondition = (index: number) => {
    setFormConditions(prev => prev.filter((_, i) => i !== index))
  }

  const updateCondition = (index: number, field: keyof PriceCondition, value: any) => {
    setFormConditions(prev => prev.map((c, i) => {
      if (i !== index) return c
      const updated = { ...c, [field]: value }
      return updated
    }))
  }

  const resetForm = () => {
    setFormConditions([{ asset: 'XLM', upperThreshold: undefined, lowerThreshold: undefined }])
    setFormLogic('AND')
    setFormAlertType('email')
    setFormWebhookUrl('')
    setFormEmail('')
    setShowForm(false)
    setEditingAlert(null)
  }

  const handleEdit = (alert: PriceAlert) => {
    setEditingAlert(alert)
    setFormConditions(alert.conditions.map(c => ({ ...c })))
    setFormLogic(alert.logic)
    setFormAlertType(alert.alertType)
    setFormWebhookUrl(alert.webhookUrl || '')
    setFormEmail(alert.email || '')
    setShowForm(true)
  }

  const handleDelete = (id: string) => {
    if (window.confirm('Are you sure you want to delete this alert?')) {
      setAlerts(prev => prev.filter(a => a.id !== id))
    }
  }

  const toggleAlert = (id: string) => {
    setAlerts(prev => prev.map(a => a.id === id ? { ...a, active: !a.active } : a))
  }

  const getNearestDistance = (alert: PriceAlert) => {
    let nearest: { type: string; distance: string } | null = null
    for (const cond of alert.conditions) {
      const currentPrice = currentPrices[cond.asset] || 0
      if (cond.upperThreshold) {
        const dist = ((cond.upperThreshold - currentPrice) / currentPrice) * 100
        if (!nearest || Math.abs(dist) < Math.abs(parseFloat(nearest.distance))) {
          nearest = { type: `${cond.asset} upper`, distance: dist.toFixed(2) }
        }
      }
      if (cond.lowerThreshold) {
        const dist = ((currentPrice - cond.lowerThreshold) / currentPrice) * 100
        if (!nearest || Math.abs(dist) < Math.abs(parseFloat(nearest.distance))) {
          nearest = { type: `${cond.asset} lower`, distance: dist.toFixed(2) }
        }
      }
    }
    return nearest
  }

  if (!publicKey) {
    return (
      <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <div className="text-center text-gray-600 dark:text-gray-400">
          <Bell className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>Connect wallet to manage price alerts</p>
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-semibold text-gray-900 dark:text-white flex items-center gap-2">
            <Bell className="w-5 h-5" />
            {t('priceAlerts.title')}
          </h2>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">{t('priceAlerts.subtitle')}</p>
        </div>
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          <Plus className="w-4 h-4" />
          {t('priceAlerts.createAlert')}
        </button>
      </div>

      {/* Alert Form */}
      <AnimatePresence>
        {showForm && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="mb-6 border border-gray-200 dark:border-gray-700 rounded-lg p-4"
          >
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Condition logic
                </label>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setFormLogic('AND')}
                    className={`flex-1 px-3 py-2 rounded-lg border transition-colors text-sm ${
                      formLogic === 'AND'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                        : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    AND (all conditions)
                  </button>
                  <button
                    type="button"
                    onClick={() => setFormLogic('OR')}
                    className={`flex-1 px-3 py-2 rounded-lg border transition-colors text-sm ${
                      formLogic === 'OR'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                        : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                    }`}
                  >
                    OR (any condition)
                  </button>
                </div>
              </div>

              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-medium text-gray-700 dark:text-gray-300">
                    Conditions
                  </label>
                  <button
                    type="button"
                    onClick={addCondition}
                    className="flex items-center gap-1 text-sm text-blue-600 dark:text-blue-400 hover:underline"
                  >
                    <Plus className="w-3 h-3" />
                    Add condition
                  </button>
                </div>
                {formConditions.map((cond, idx) => (
                  <div key={idx} className="flex items-start gap-2 p-3 bg-gray-50 dark:bg-gray-900/30 rounded-lg border border-gray-200 dark:border-gray-700">
                    <div className="flex-1 grid grid-cols-1 md:grid-cols-3 gap-2">
                      <select
                        value={cond.asset}
                        onChange={(e) => updateCondition(idx, 'asset', e.target.value)}
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      >
                        {DEFAULT_ASSETS.map(asset => (
                          <option key={asset} value={asset}>{asset}</option>
                        ))}
                      </select>
                      <input
                        type="number"
                        step="0.000001"
                        value={cond.upperThreshold ?? ''}
                        onChange={(e) => updateCondition(idx, 'upperThreshold', e.target.value ? parseFloat(e.target.value) : undefined)}
                        placeholder="Upper (optional)"
                        className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                      />
                      <div className="flex gap-2">
                        <input
                          type="number"
                          step="0.000001"
                          value={cond.lowerThreshold ?? ''}
                          onChange={(e) => updateCondition(idx, 'lowerThreshold', e.target.value ? parseFloat(e.target.value) : undefined)}
                          placeholder="Lower (optional)"
                          className="flex-1 px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white text-sm"
                        />
                        {formConditions.length > 1 && (
                          <button
                            type="button"
                            onClick={() => removeCondition(idx)}
                            className="p-2 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                            aria-label="Remove condition"
                          >
                            <X className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('priceAlerts.alertType')}
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormAlertType('email')}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                        formAlertType === 'email'
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                          : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      <Mail className="w-4 h-4" />
                      {t('priceAlerts.email')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormAlertType('webhook')}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                        formAlertType === 'webhook'
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                          : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      <Link className="w-4 h-4" />
                      {t('priceAlerts.webhook')}
                    </button>
                  </div>
                </div>
              </div>

              {formAlertType === 'email' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    Email Address
                  </label>
                  <input
                    type="email"
                    value={formEmail}
                    onChange={(e) => setFormEmail(e.target.value)}
                    placeholder="your@email.com"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              )}

              {formAlertType === 'webhook' && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('priceAlerts.webhookUrl')}
                  </label>
                  <input
                    type="url"
                    value={formWebhookUrl}
                    onChange={(e) => setFormWebhookUrl(e.target.value)}
                    placeholder="https://your-webhook-url.com"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>
              )}

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  {t('priceAlerts.cancel')}
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                >
                  {editingAlert ? t('priceAlerts.editAlert') : t('priceAlerts.save')}
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Active Alerts */}
      <div className="space-y-3">
        {alerts.length === 0 ? (
          <div className="text-center py-8 text-gray-600 dark:text-gray-400">
            <Bell className="w-12 h-12 mx-auto mb-4 opacity-50" />
            <p>{t('priceAlerts.noAlerts')}</p>
          </div>
        ) : (
          alerts.map((alert) => {
            const distance = getNearestDistance(alert)
            return (
              <motion.div
                key={alert.id}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={`border rounded-lg p-4 ${
                  alert.active
                    ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800'
                    : 'border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50 opacity-60'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-2">
                      {alert.active ? (
                        <CheckCircle2 className="w-4 h-4 text-green-500" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-gray-400" />
                      )}
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        alert.alertType === 'email' ? 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400' : 'bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-400'
                      }`}>
                        {alert.alertType === 'email' ? <Mail className="w-3 h-3 inline" /> : <Link className="w-3 h-3 inline" />}
                      </span>
                    </div>

                    <div className="space-y-1 text-sm">
                      <div className="text-gray-700 dark:text-gray-300 font-medium">
                        {formatAlertSummary(alert)}
                      </div>
                      {alert.conditions.length > 1 && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          Combined with <span className="font-semibold uppercase">{alert.logic}</span> logic
                        </div>
                      )}
                      {distance && (
                        <div className="text-xs text-gray-500 dark:text-gray-500">
                          {t('priceAlerts.distance')}: {distance.distance}% from {distance.type} threshold
                        </div>
                      )}
                      <div className="text-xs text-gray-500 dark:text-gray-500">
                        {t('priceAlerts.currentPrice')}: {alert.conditions.map(c => c.asset).filter((v, i, a) => a.indexOf(v) === i).map(asset =>
                          `${asset} $${currentPrices[asset]?.toLocaleString() || 'N/A'}`
                        ).join(', ')}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2 ml-4">
                    <button
                      onClick={() => toggleAlert(alert.id)}
                      className={`p-2 rounded-lg transition-colors ${
                        alert.active
                          ? 'text-green-600 hover:bg-green-50 dark:hover:bg-green-900/20'
                          : 'text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-700'
                      }`}
                      title={alert.active ? 'Deactivate' : 'Activate'}
                    >
                      {alert.active ? <CheckCircle2 className="w-5 h-5" /> : <AlertTriangle className="w-5 h-5" />}
                    </button>
                    <button
                      onClick={() => handleEdit(alert)}
                      className="p-2 text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
                      title={t('priceAlerts.editAlert')}
                    >
                      <Edit2 className="w-5 h-5" />
                    </button>
                    <button
                      onClick={() => handleDelete(alert.id)}
                      className="p-2 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
                      title={t('priceAlerts.deleteAlert')}
                    >
                      <Trash2 className="w-5 h-5" />
                    </button>
                  </div>
                </div>
              </motion.div>
            )
          })
        )}
      </div>
    </div>
  )
}

export default PriceAlerts
