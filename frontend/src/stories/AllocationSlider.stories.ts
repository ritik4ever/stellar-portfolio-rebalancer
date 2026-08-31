import type { Meta, StoryObj } from '@storybook/react'
import { AllocationSlider } from '../components/ui/AllocationSlider'

const meta: Meta<typeof AllocationSlider> = {
  title: 'Components/AllocationSlider',
  component: AllocationSlider,
  tags: ['autodocs'],
  argTypes: {
    onChange: { action: 'changed' },
  },
}
export default meta
type Story = StoryObj<typeof AllocationSlider>

export const Default: Story = {
  args: { label: 'XLM allocation', value: 40 },
}

export const Disabled: Story = {
  args: { label: 'BTC allocation', value: 30, disabled: true },
}
