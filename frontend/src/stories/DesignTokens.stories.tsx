import type { Meta, StoryObj } from '@storybook/react'

const meta: Meta = {
  title: 'Design Tokens',
  tags: ['docs'],
  parameters: {
    docs: { description: { component: 'Core design tokens used across the frontend.' } },
  },
}
export default meta

type Story = StoryObj<{ tokens: Record<string, string> }>

export const Colors: Story = {
  args: {
    tokens: {
      background: 'bg-gray-50 dark:bg-gray-900',
      surface: 'bg-white dark:bg-gray-800',
      border: 'border-gray-200 dark:border-gray-700',
      mutedText: 'text-gray-500 dark:text-gray-400',
      primaryText: 'text-gray-900 dark:text-gray-100',
      primaryAction: 'bg-blue-600 hover:bg-blue-700 text-white',
      danger: 'bg-red-600 hover:bg-red-700 text-white',
    },
  },
  render: (args) => (
    <div className="grid grid-cols-2 gap-4">
      {Object.entries(args.tokens).map(([key, value]) => (
        <div key={key} className="flex items-center gap-3">
          <span className="rounded-md border border-gray-200 px-2 py-1 text-xs text-gray-600">{key}</span>
          <span className={`rounded-md px-2 py-1 text-xs ${value}`}>Aa</span>
        </div>
      ))}
    </div>
  ),
}
