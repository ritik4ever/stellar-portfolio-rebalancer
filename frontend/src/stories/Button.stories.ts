import type { Meta, StoryObj } from '@storybook/react'
import { Button } from '../components/ui/Button'

const meta: Meta<typeof Button> = {
  title: 'Components/Button',
  component: Button,
  tags: ['autodocs'],
  argTypes: {
    variant: {
      control: 'select',
      options: ['primary', 'secondary', 'danger', 'ghost'],
    },
    size: {
      control: 'select',
      options: ['sm', 'md', 'lg'],
    },
    disabled: { control: 'boolean' },
  },
}
export default meta
type Story = StoryObj<typeof Button>

export const Primary: Story = {
  args: { children: 'Primary action', variant: 'primary' },
}

export const Secondary: Story = {
  args: { children: 'Secondary action', variant: 'secondary' },
}

export const Danger: Story = {
  args: { children: 'Delete', variant: 'danger' },
}

export const Loading: Story = {
  args: { children: 'Saving...', loading: true, disabled: true },
}

export const Disabled: Story = {
  args: { children: 'Disabled', disabled: true },
}
