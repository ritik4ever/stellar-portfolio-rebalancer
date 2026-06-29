import React, { useId } from 'react'

export interface AllocationSliderProps {
  label: string
  value: number
  onChange: (value: number) => void
  min?: number
  max?: number
  step?: number
  disabled?: boolean
  formatValue?: (value: number) => string
  className?: string
}

const defaultFormat = (value: number) => `${value}%`

export const AllocationSlider: React.FC<AllocationSliderProps> = ({
  label,
  value,
  onChange,
  min = 0,
  max = 100,
  step = 1,
  disabled = false,
  formatValue = defaultFormat,
  className = '',
}) => {
  const id = useId()
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onChange(Number(e.target.value))
  }

  return (
    <div className={`w-full ${className}`}>
      <div className="flex items-center justify-between">
        <label htmlFor={id} className="text-sm font-medium text-gray-700 dark:text-gray-200">
          {label}
        </label>
        <output
          id={`${id}-output`}
          className="text-sm font-mono tabular-nums text-gray-900 dark:text-gray-100"
        >
          {formatValue(value)}
        </output>
      </div>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={handleChange}
        aria-describedby={`${id}-output`}
        className="mt-2 h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-blue-600 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-700"
      />
    </div>
  )
}

</parameter>
</write_to_file>