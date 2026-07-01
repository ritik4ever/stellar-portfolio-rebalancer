import type { Meta, StoryObj } from '@storybook/react'
import { Modal } from '../components/ui/Modal'
import { Button } from '../components/ui/Button'

const meta: Meta<typeof Modal> = {
  title: 'Components/Modal',
  component: Modal,
  tags: ['autodocs'],
}
export default meta
type Story = StoryObj<typeof Modal>

export const Default: Story = {
  args: {
    open: true,
    title: 'Delete your data?',
    description: 'This will reset the demo portfolio to its default state.',
    children: 'Proceeding will discard unsaved allocations.',
    footer: (
      <>
        <Button variant="secondary">Cancel</Button>
        <Button variant="danger">Confirm</Button>
      </>
    ),
  },
}
