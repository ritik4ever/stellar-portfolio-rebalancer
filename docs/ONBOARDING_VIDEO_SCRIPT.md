# Onboarding Video Script & Storyboard

## Overview
This document provides a complete script and storyboard for creating an onboarding video that walks users through the Stellar Portfolio Rebalancer setup, portfolio creation, and rebalancing process.

**Target Duration:** 3-4 minutes  
**Target Audience:** New users with basic crypto knowledge  
**Goal:** Enable users to successfully create and manage their first portfolio

---

## Scene 1: Introduction & Landing (0:00 - 0:30)

### Visual
- Show the landing page at `https://stellar-portfolio-rebalancer.onrender.com`
- Highlight the hero section with gradient background
- Pan across the three feature cards (Smart Rebalancing, Multi-Wallet Support, Real-Time Feeds)

### Script
> "Welcome to Stellar Portfolio Rebalancer - the intelligent DeFi platform that automatically maintains your crypto portfolio allocation. In just a few minutes, you'll learn how to set up your first portfolio and let our smart contracts handle the rebalancing for you."

### Key Points to Show
- Clean, professional interface
- Feature highlights: "Smart Rebalancing", "Multi-Wallet Support", "Real-Time Price Feeds"
- "Try Demo" and "Connect Wallet" buttons

---

## Scene 2: Demo Mode Exploration (0:30 - 1:00)

### Visual
- Click "Try Demo" button
- Show the Dashboard with the $10,000 demo portfolio
- Highlight the portfolio overview section
- Show the pie chart with XLM/USDC allocation
- Point out the "Demo Mode" banner

### Script
> "Let's start with Demo Mode to explore the interface. You get a $10,000 simulated portfolio with real market prices. Notice the portfolio overview showing your total value, daily change, and current allocations. The pie chart gives you a visual breakdown of your assets."

### Key Points to Show
- Demo portfolio: $10,000 total value
- Asset allocation: 40% XLM, 60% USDC
- Real-time price data
- Performance chart
- "Demo Mode" indicator

---

## Scene 3: Wallet Connection & Setup (1:00 - 1:30)

### Visual
- Click "Connect Wallet" button
- Show the WalletSelector modal
- Select Freighter wallet
- Show the consent screen (Terms, Privacy, Cookies)
- Accept all consents

### Script
> "Ready to create a real portfolio? Click Connect Wallet and choose your preferred Stellar wallet. We support Freighter, Rabet, xBull, and others. After connecting, you'll need to accept our terms and privacy policy to get started."

### Key Points to Show
- Multiple wallet options available
- Clean consent interface
- Clear explanation of what data is collected
- One-click acceptance process

---

## Scene 4: Portfolio Creation - Template Selection (1:30 - 2:15)

### Visual
- Navigate to Portfolio Setup
- Show the template selection screen
- Highlight each template with risk levels:
  - Conservative (Low risk): 60% USDC, 30% XLM, 10% BTC
  - Balanced (Medium risk): 40% USDC, 30% XLM, 20% BTC, 10% ETH
  - Aggressive (High risk): 50% BTC, 30% ETH, 20% XLM
- Select "Balanced" template

### Script
> "Now let's create your portfolio. Choose from our pre-built templates or create a custom allocation. The Conservative template focuses on stablecoins for lower risk. Balanced gives you moderate exposure to crypto growth. Aggressive maximizes your crypto allocation for higher potential returns. Let's go with Balanced."

### Key Points to Show
- Template cards with clear risk indicators
- Allocation percentages for each template
- Risk level explanations
- Easy template selection

---

## Scene 5: Portfolio Configuration (2:15 - 2:45)

### Visual
- Show the allocation inputs with real-time validation
- Demonstrate the live percentage calculator
- Adjust the rebalance threshold slider (5%)
- Set slippage tolerance (1%)
- Show the validation summary turning green when total = 100%

### Script
> "Fine-tune your allocations with real-time validation. The system ensures your percentages add up to exactly 100%. Set your rebalance threshold - this determines when automatic rebalancing triggers. A 5% threshold means if any asset drifts 5% from target, rebalancing activates. Slippage tolerance protects you from unfavorable price movements during trades."

### Key Points to Show
- Live validation with green/red indicators
- Percentage total calculator
- Threshold slider (1-50% range)
- Slippage tolerance setting
- Clear error messages for invalid inputs

---

## Scene 6: Portfolio Dashboard & Analytics (2:45 - 3:15)

### Visual
- Show the completed portfolio dashboard
- Highlight the portfolio value and daily change
- Show the performance chart over 7 days
- Display the rebalance history (empty for new portfolio)
- Point out the "Needs Rebalance" indicator

### Script
> "Your portfolio is now live! The dashboard shows your total value, daily performance, and allocation status. The performance chart tracks your portfolio over time. When your assets drift beyond your threshold, you'll see a 'Needs Rebalance' indicator. The system calculates optimal trades to restore your target allocation."

### Key Points to Show
- Real portfolio value
- Performance visualization
- Rebalance status indicator
- Clean, informative layout

---

## Scene 7: Executing a Rebalance (3:15 - 3:45)

### Visual
- Click "Execute Rebalance" button
- Show the rebalance plan modal with:
  - Current vs target allocations
  - Required trades
  - Gas estimate
  - Slippage warnings
- Confirm the rebalance
- Show success message with transaction details

### Script
> "When rebalancing is needed, click Execute Rebalance to see the detailed plan. Review the required trades, gas costs, and potential slippage. The system shows exactly what will happen before you confirm. Once executed, your portfolio returns to optimal allocation automatically."

### Key Points to Show
- Detailed rebalance plan
- Gas cost estimation
- Trade preview
- Confirmation flow
- Success feedback

---

## Scene 8: Closing & Next Steps (3:45 - 4:00)

### Visual
- Show the updated portfolio with new allocation
- Highlight the notification preferences
- Show the export options (CSV, JSON, PDF)
- End on the main dashboard

### Script
> "Congratulations! Your portfolio is now automatically managed. Set up notifications to stay informed about rebalances. Export your data anytime for record-keeping. Your portfolio will maintain optimal allocation as markets move, maximizing your DeFi strategy on Stellar."

### Key Points to Show
- Updated portfolio state
- Notification settings
- Export functionality
- Professional, trustworthy interface

---

## Production Notes

### Technical Requirements
- **Screen Resolution:** 1920x1080 minimum for crisp recording
- **Browser:** Chrome or Firefox with Freighter extension installed
- **Network:** Stellar Testnet for demo transactions
- **Wallet:** Pre-funded testnet account for smooth demo

### Recording Setup
- Use demo mode for initial walkthrough (no real transactions)
- Switch to testnet wallet for rebalance demonstration
- Ensure stable internet for real-time price feeds
- Have backup demo data ready if API is slow

### Visual Guidelines
- **Cursor:** Use smooth, deliberate movements
- **Highlighting:** Add subtle arrows or circles in post-production
- **Transitions:** 0.5-second fade between major sections
- **Text Overlays:** Add key terms and percentages as needed

### Audio Guidelines
- **Pace:** Conversational, not rushed (150-160 words per minute)
- **Tone:** Professional but approachable
- **Background:** Subtle, non-distracting music
- **Quality:** Clear audio with noise reduction

---

## Maintenance & Updates

### When to Update Video
- Major UI changes to Dashboard or Portfolio Setup
- New wallet integrations
- Significant feature additions (new templates, strategies)
- Branding or terminology changes

### Version Control
- Tag video versions with app release numbers
- Maintain script in version control alongside code
- Update cross-references when file paths change

### Localization Considerations
- Script written for easy translation
- UI text should be translatable
- Consider cultural differences in financial terminology

---

## Cross-References

### Documentation Links
- [Frontend State Flow](./FRONTEND_STATE_FLOW.md) - Understanding data management
- [API Documentation](../API.md) - Backend integration details
- [Contributing Guide](../CONTRIBUTING.md) - Development setup
- [README](../README.md) - Project overview and quick start

### Component Files
- `frontend/src/components/Landing.tsx` - Landing page implementation
- `frontend/src/components/Dashboard.tsx` - Main dashboard interface
- `frontend/src/components/PortfolioSetup.tsx` - Portfolio creation flow
- `frontend/src/components/WalletSelector.tsx` - Wallet connection modal

### Key Features Demonstrated
- Multi-wallet support (Freighter, Rabet, xBull)
- Template-based portfolio creation
- Real-time validation and feedback
- Automated rebalancing with gas estimation
- Performance tracking and analytics
- GDPR-compliant data export

---

## Success Metrics

### User Completion Goals
- 90% of viewers complete portfolio setup after watching
- 80% successfully execute their first rebalance
- 70% enable notifications and explore analytics

### Video Performance Targets
- Average watch time: >75% (3+ minutes)
- Engagement rate: >60% (likes, shares, comments)
- Conversion rate: >15% (demo to real portfolio)

This script ensures new users can confidently navigate the entire platform workflow while highlighting the key value propositions of automated portfolio management on Stellar.