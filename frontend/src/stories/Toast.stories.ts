import type { Meta, StoryObj } from '@storybook/react'
import { Toast } from '../components/ui/Toast'

const meta: Meta<typeof Toast> = {
  title: 'Components/Toast',
  component: Toast,
  tags: ['autodocs'],
}
export default meta
type Story = StoryObj<typeof Toast>

export const Info: Story = { args: { title: 'Info message', description: 'Something you should know.', tone: 'info' } }
export const Success: Story = { args: { title: 'Success', description: 'Operation completed.', tone: 'success' } }
export const Warning: Story = { args: { title: 'Warning', description: 'Please review before continuing.', tone: 'warning' } }
export const Error: Story = { args: { title: 'Error', description: 'Something failed.', tone: 'error' } }
