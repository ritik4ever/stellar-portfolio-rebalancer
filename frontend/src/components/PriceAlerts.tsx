import { useState, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Edit2, Bell, Mail, Link, AlertTriangle, CheckCircle2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'

interface PriceAlert {
  id: string
  asset: string
  upperThreshold?: number
  lowerThreshold?: number
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

const PriceAlerts: React.FC<PriceAlertsProps> = ({ publicKey }) => {
  const { t } = useTranslation()
  const [alerts, setAlerts] = useState<PriceAlert[]>([])
  const [showForm, setShowForm] = useState(false)
  const [editingAlert, setEditingAlert] = useState<PriceAlert | null>(null)
  const [formData, setFormData] = useState({
    asset: 'XLM',
    upperThreshold: '',
    lowerThreshold: '',
    alertType: 'email' as 'email' | 'webhook',
    webhookUrl: '',
    email: ''
  })
  const [currentPrices, setCurrentPrices] = useState<Record<string, number>>({
    XLM: 0.354,
    USDC: 1.0,
    BTC: 110000,
    ETH: 4200
  })

  // Load alerts from localStorage on mount
  useEffect(() => {
    if (publicKey) {
      const saved = localStorage.getItem(`priceAlerts_${publicKey}`)
      if (saved) {
        setAlerts(JSON.parse(saved))
      }
    }
  }, [publicKey])

  // Save alerts to localStorage whenever they change
  useEffect(() => {
    if (publicKey) {
      localStorage.setItem(`priceAlerts_${publicKey}`, JSON.stringify(alerts))
    }
  }, [alerts, publicKey])

  const validateForm = () => {
    const upper = parseFloat(formData.upperThreshold)
    const lower = parseFloat(formData.lowerThreshold)

    if (formData.upperThreshold && (isNaN(upper) || upper <= 0)) {
      return { valid: false, error: t('priceAlerts.validation.positivePrice') }
    }
    if (formData.lowerThreshold && (isNaN(lower) || lower <= 0)) {
      return { valid: false, error: t('priceAlerts.validation.positivePrice') }
    }
    if (upper && lower && upper <= lower) {
      return { valid: false, error: 'Upper threshold must be greater than lower threshold' }
    }
    if (formData.alertType === 'webhook' && !formData.webhookUrl) {
      return { valid: false, error: t('priceAlerts.validation.validUrl') }
    }
    if (formData.alertType === 'email' && !formData.email) {
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
      asset: formData.asset,
      upperThreshold: formData.upperThreshold ? parseFloat(formData.upperThreshold) : undefined,
      lowerThreshold: formData.lowerThreshold ? parseFloat(formData.lowerThreshold) : undefined,
      alertType: formData.alertType,
      webhookUrl: formData.alertType === 'webhook' ? formData.webhookUrl : undefined,
      email: formData.alertType === 'email' ? formData.email : undefined,
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

  const resetForm = () => {
    setFormData({
      asset: 'XLM',
      upperThreshold: '',
      lowerThreshold: '',
      alertType: 'email',
      webhookUrl: '',
      email: ''
    })
    setShowForm(false)
    setEditingAlert(null)
  }

  const handleEdit = (alert: PriceAlert) => {
    setEditingAlert(alert)
    setFormData({
      asset: alert.asset,
      upperThreshold: alert.upperThreshold?.toString() || '',
      lowerThreshold: alert.lowerThreshold?.toString() || '',
      alertType: alert.alertType,
      webhookUrl: alert.webhookUrl || '',
      email: alert.email || ''
    })
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

  const getDistanceFromThreshold = (alert: PriceAlert) => {
    const currentPrice = currentPrices[alert.asset] || 0
    if (alert.upperThreshold) {
      const distance = ((alert.upperThreshold - currentPrice) / currentPrice) * 100
      return { type: 'upper', distance: distance.toFixed(2) }
    }
    if (alert.lowerThreshold) {
      const distance = ((currentPrice - alert.lowerThreshold) / currentPrice) * 100
      return { type: 'lower', distance: distance.toFixed(2) }
    }
    return null
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
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('priceAlerts.asset')}
                  </label>
                  <select
                    value={formData.asset}
                    onChange={(e) => setFormData({ ...formData, asset: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  >
                    {DEFAULT_ASSETS.map(asset => (
                      <option key={asset} value={asset}>{asset}</option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('priceAlerts.alertType')}
                  </label>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, alertType: 'email' })}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                        formData.alertType === 'email'
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                          : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      <Mail className="w-4 h-4" />
                      {t('priceAlerts.email')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setFormData({ ...formData, alertType: 'webhook' })}
                      className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg border transition-colors ${
                        formData.alertType === 'webhook'
                          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400'
                          : 'border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300'
                      }`}
                    >
                      <Link className="w-4 h-4" />
                      {t('priceAlerts.webhook')}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('priceAlerts.upperThreshold')}
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    value={formData.upperThreshold}
                    onChange={(e) => setFormData({ ...formData, upperThreshold: e.target.value })}
                    placeholder="Optional"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                <div>
                  <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                    {t('priceAlerts.lowerThreshold')}
                  </label>
                  <input
                    type="number"
                    step="0.000001"
                    value={formData.lowerThreshold}
                    onChange={(e) => setFormData({ ...formData, lowerThreshold: e.target.value })}
                    placeholder="Optional"
                    className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                  />
                </div>

                {formData.alertType === 'email' && (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      placeholder="your@email.com"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                )}

                {formData.alertType === 'webhook' && (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                      {t('priceAlerts.webhookUrl')}
                    </label>
                    <input
                      type="url"
                      value={formData.webhookUrl}
                      onChange={(e) => setFormData({ ...formData, webhookUrl: e.target.value })}
                      placeholder="https://your-webhook-url.com"
                      className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-lg bg-white dark:bg-gray-700 text-gray-900 dark:text-white"
                    />
                  </div>
                )}
              </div>

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
            const distance = getDistanceFromThreshold(alert)
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
                      <span className="font-semibold text-gray-900 dark:text-white">{alert.asset}</span>
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
                      {alert.upperThreshold && (
                        <div className="text-gray-600 dark:text-gray-400">
                          Upper: ${alert.upperThreshold.toLocaleString()}
                        </div>
                      )}
                      {alert.lowerThreshold && (
                        <div className="text-gray-600 dark:text-gray-400">
                          Lower: ${alert.lowerThreshold.toLocaleString()}
                        </div>
                      )}
                      {distance && (
                        <div className="text-xs text-gray-500 dark:text-gray-500">
                          {t('priceAlerts.distance')}: {distance.distance}% from {distance.type} threshold
                        </div>
                      )}
                      <div className="text-xs text-gray-500 dark:text-gray-500">
                        {t('priceAlerts.currentPrice')}: ${currentPrices[alert.asset]?.toLocaleString() || 'N/A'}
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
