import React, { useState, useCallback, useRef, useEffect, useMemo } from 'react'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import { Button } from './ui/Button'
import { Pencil, X, Check } from 'lucide-react'

export interface AllocationData {
  name: string
  value: number
  color: string
}

interface AllocationPieChartProps {
  data: AllocationData[]
  loading?: boolean
  onSave?: (data: AllocationData[]) => void
}

export function redistribute(
  current: AllocationData[],
  dragIndex: number,
  newValue: number
): AllocationData[] {
  const clamped = Math.max(0, Math.min(100, Math.round(newValue)))
  const diff = clamped - current[dragIndex].value
  if (diff === 0) return current

  const othersTotal = current.reduce((s, it, i) => (i !== dragIndex ? s + it.value : s), 0)

  const result = current.map((item, i) => {
    if (i === dragIndex) return { ...item, value: clamped }
    const proportion = othersTotal > 0 ? item.value / othersTotal : 1 / (current.length - 1)
    return { ...item, value: Math.max(0, Math.round(item.value - proportion * diff)) }
  })

  const sum = result.reduce((s, it) => s + it.value, 0)
  if (sum !== 100) {
    const remainder = 100 - sum
    const idx = result.findIndex((it, i) => i !== dragIndex && it.value > 0)
    if (idx !== -1) result[idx] = { ...result[idx], value: result[idx].value + remainder }
    else result[dragIndex] = { ...result[dragIndex], value: result[dragIndex].value + remainder }
  }

  return result
}

const AllocationPieChart: React.FC<AllocationPieChartProps> = ({ data, loading, onSave }) => {
  const [editing, setEditing] = useState(false)
  const [pendingData, setPendingData] = useState<AllocationData[] | null>(null)
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
  const [dragStartAngle, setDragStartAngle] = useState(0)
  const [dragStartValue, setDragStartValue] = useState(0)
  const containerRef = useRef<HTMLDivElement>(null)

  const activeData = pendingData ?? data

  const pendingChanges = useMemo(() => {
    if (!pendingData) return null
    return data.map((original, i) => ({
      name: original.name,
      original: original.value,
      pending: pendingData[i].value,
      changed: original.value !== pendingData[i].value,
    }))
  }, [pendingData, data])

  const hasChanges = pendingChanges?.some((c) => c.changed)

  const getMouseAngle = useCallback((clientX: number, clientY: number): number => {
    const rect = containerRef.current?.getBoundingClientRect()
    if (!rect) return 0
    const cx = rect.width / 2
    const cy = rect.height / 2
    const mx = clientX - rect.left
    const my = clientY - rect.top
    let angle = Math.atan2(my - cy, mx - cx) * (180 / Math.PI)
    if (angle < 0) angle += 360
    return angle
  }, [])

  const handleEditToggle = useCallback(() => {
    if (editing) setPendingData(null)
    setEditing((prev) => !prev)
  }, [editing])

  const handleConfirm = useCallback(() => {
    if (pendingData && onSave) onSave(pendingData)
    setPendingData(null)
    setEditing(false)
  }, [pendingData, onSave])

  const handleCancel = useCallback(() => {
    setPendingData(null)
    setEditing(false)
  }, [])

  const handlePieMouseDown = useCallback(
    (_data: AllocationData, index: number, e: React.MouseEvent) => {
      if (!editing) return
      e.stopPropagation()
      setDraggingIndex(index)
      setDragStartAngle(getMouseAngle(e.clientX, e.clientY))
      setDragStartValue(activeData[index].value)
    },
    [editing, getMouseAngle, activeData]
  )

  const handleMouseMove = useCallback(
    (e: MouseEvent) => {
      if (draggingIndex === null || !editing) return

      const angle = getMouseAngle(e.clientX, e.clientY)
      let angleDiff = angle - dragStartAngle
      if (angleDiff > 180) angleDiff -= 360
      if (angleDiff < -180) angleDiff += 360

      const valueChange = (angleDiff / 360) * 100
      const newValue = Math.round(dragStartValue + valueChange)

      setPendingData((prev) => {
        const current = prev ?? data
        return redistribute(current, draggingIndex, newValue)
      })
    },
    [draggingIndex, editing, dragStartAngle, dragStartValue, getMouseAngle, data]
  )

  const handleMouseUp = useCallback(() => {
    setDraggingIndex(null)
  }, [])

  useEffect(() => {
    if (draggingIndex !== null) {
      window.addEventListener('mousemove', handleMouseMove)
      window.addEventListener('mouseup', handleMouseUp)
      return () => {
        window.removeEventListener('mousemove', handleMouseMove)
        window.removeEventListener('mouseup', handleMouseUp)
      }
    }
  }, [draggingIndex, handleMouseMove, handleMouseUp])

  if (loading) {
    return (
      <div data-testid="allocation-pie-chart-skeleton" aria-busy="true" className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
        <div className="w-32 h-6 bg-gray-300 dark:bg-gray-700 rounded mb-4 animate-pulse" />
        <div className="h-48 flex items-center justify-center mb-4">
          <div className="w-40 h-40 rounded-full bg-gray-200 dark:bg-gray-700 animate-pulse" />
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Allocation</h3>
        {!editing ? (
          <Button variant="ghost" size="sm" onClick={handleEditToggle} data-testid="edit-btn">
            <Pencil className="w-4 h-4" />
            Edit
          </Button>
        ) : (
          <Button variant="ghost" size="sm" onClick={handleEditToggle} data-testid="cancel-edit-btn">
            <X className="w-4 h-4" />
            Cancel
          </Button>
        )}
      </div>

      <div
        ref={containerRef}
        className={`h-64 flex items-center justify-center ${editing ? 'cursor-pointer' : ''}`}
        data-testid="pie-chart-container"
        data-editing={editing}
      >
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={activeData}
              cx="50%"
              cy="50%"
              innerRadius={60}
              outerRadius={80}
              paddingAngle={5}
              dataKey="value"
              isAnimationActive={false}
            >
              {activeData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.color}
                  onMouseDown={(e: React.MouseEvent) => handlePieMouseDown(entry, index, e)}
                  style={editing ? { cursor: 'grab', opacity: draggingIndex === index ? 0.8 : 1 } : undefined}
                  data-testid={`pie-cell-${index}`}
                />
              ))}
            </Pie>
            <Tooltip />
          </PieChart>
        </ResponsiveContainer>
      </div>

      {editing && hasChanges && (
        <div
          className="mt-4 p-3 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800 rounded-lg"
          data-testid="pending-changes"
        >
          <h4 className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">Pending changes</h4>
          <div className="space-y-1">
            {pendingChanges!.filter((c) => c.changed).map((change, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="text-blue-700 dark:text-blue-400">{change.name}</span>
                <span className="text-blue-700 dark:text-blue-400">
                  {change.original}% → {change.pending}%
                </span>
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="secondary" size="sm" onClick={handleCancel} data-testid="discard-btn">
              <X className="w-3 h-3" />
              Discard
            </Button>
            <Button variant="primary" size="sm" onClick={handleConfirm} data-testid="apply-btn">
              <Check className="w-3 h-3" />
              Apply
            </Button>
          </div>
        </div>
      )}

      <div className="mt-4 space-y-2">
        {activeData.map((asset, index) => (
          <div key={index} className="flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-3 h-3 rounded-full mr-2" style={{ backgroundColor: asset.color }} />
              <span className="text-sm text-gray-600 dark:text-gray-400">{asset.name}</span>
            </div>
            <span className="text-sm font-medium text-gray-900 dark:text-white">
              {asset.value}%
              {editing && pendingData && pendingData[index].value !== data[index].value && (
                <span className="ml-1 text-xs text-blue-500">({data[index].value}%)</span>
              )}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export default AllocationPieChart
