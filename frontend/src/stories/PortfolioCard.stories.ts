import type { Meta, StoryObj } from '@storybook/react'
import { PortfolioCard } from '../components/ui/PortfolioCard'
import { Button } from '../components/ui/Button'

const meta: Meta<typeof PortfolioCard> = {
  title: 'Components/PortfolioCard',
  component: PortfolioCard,
  tags: ['autodocs'],
}
export default meta
type Story = StoryObj<typeof PortfolioCard>

export const Default: Story = {
  args: {
    title: 'Total Value',
    value: '$10,000.00',
    change: 3.4,
    subtitle: 'Last rebalanced 2 hours ago',
    actions: <Button variant="secondary">Export</Button>,
  },
}
