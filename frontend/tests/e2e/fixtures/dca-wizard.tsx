import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import PortfolioWizard from '../../../src/pages/PortfolioWizard';

document.body.innerHTML = '<div id="test-root"></div>';
createRoot(document.getElementById('test-root')!).render(
  <QueryClientProvider client={new QueryClient()}>
    <PortfolioWizard onNavigate={() => {}} publicKey="GA2C5RFPE6GCKIG3EQRUUYYTQ27WXYVHTP73HZY4MDF4M7Q2W4M2OWH7" />
  </QueryClientProvider>,
);
