const http = require('http');
const url = require('url');

const PORT = parseInt(process.env.PORT || '8080', 10);

// Symbol to CoinGecko ID mapping
const SYMBOL_TO_ID = {
  'XLM': 'stellar',
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'USDC': 'usd-coin'
};

const ID_TO_SYMBOL = {
  'stellar': 'XLM',
  'bitcoin': 'BTC',
  'ethereum': 'ETH',
  'usd-coin': 'USDC'
};

// Base price configuration
let prices = {
  XLM: parseFloat(process.env.MOCK_PRICE_XLM || '0.354'),
  BTC: parseFloat(process.env.MOCK_PRICE_BTC || '110000'),
  ETH: parseFloat(process.env.MOCK_PRICE_ETH || '4200'),
  USDC: parseFloat(process.env.MOCK_PRICE_USDC || '1.0')
};

let enableRandomization = (process.env.ENABLE_RANDOMIZATION || 'false').toLowerCase() === 'true';

function getPrice(symbol) {
  const sym = symbol.toUpperCase();
  const base = prices[sym] ?? 1.0;
  if (!enableRandomization) return base;
  const variation = (Math.random() - 0.5) * 0.02; // +/- 1%
  return Number((base * (1 + variation)).toFixed(6));
}

const server = http.createServer((req, res) => {
  const parsedUrl = url.parse(req.url, true);
  let pathname = parsedUrl.pathname || '/';

  // Normalize pathname by stripping leading /api/v3 if present
  if (pathname.startsWith('/api/v3')) {
    pathname = pathname.substring(7) || '/';
  }

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  // Health check endpoints
  if (pathname === '/health' || pathname === '/ready') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', service: 'mock-reflector', timestamp: Date.now() }));
    return;
  }

  // Price override endpoint (POST /prices, POST /override, or POST /config)
  if ((pathname === '/prices' || pathname === '/override' || pathname === '/config') && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => { body += chunk.toString(); });
    req.on('end', () => {
      try {
        const payload = JSON.parse(body);
        if (payload.prices && typeof payload.prices === 'object') {
          for (const [key, val] of Object.entries(payload.prices)) {
            const sym = ID_TO_SYMBOL[key.toLowerCase()] || key.toUpperCase();
            if (typeof val === 'number') prices[sym] = val;
          }
        } else {
          for (const [key, val] of Object.entries(payload)) {
            if (key === 'randomization' || key === 'enableRandomization') {
              enableRandomization = Boolean(val);
              continue;
            }
            const sym = ID_TO_SYMBOL[key.toLowerCase()] || key.toUpperCase();
            if (typeof val === 'number') prices[sym] = val;
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'success', currentPrices: prices, enableRandomization }));
      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Invalid JSON payload' }));
      }
    });
    return;
  }

  // GET /prices -> return raw price object
  if (pathname === '/prices' && req.method === 'GET') {
    const current = {};
    for (const sym of Object.keys(prices)) {
      current[sym] = getPrice(sym);
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ prices: current, randomization: enableRandomization }));
    return;
  }

  // CoinGecko Simple Price Endpoint: GET /simple/price
  if (pathname === '/simple/price' && req.method === 'GET') {
    const idsParam = parsedUrl.query.ids || 'stellar,bitcoin,ethereum,usd-coin';
    const requestedIds = String(idsParam).split(',').map(s => s.trim().toLowerCase());
    const responseData = {};
    const now = Math.floor(Date.now() / 1000);

    for (const id of requestedIds) {
      const sym = ID_TO_SYMBOL[id] || id.toUpperCase();
      const p = getPrice(sym);
      responseData[id] = {
        usd: p,
        usd_24h_change: enableRandomization ? Number(((Math.random() - 0.5) * 4).toFixed(2)) : 0.5,
        usd_24h_vol: Math.round(p * 100000),
        last_updated_at: now
      };
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responseData));
    return;
  }

  // CoinGecko Detailed Endpoint: GET /coins/:id
  if (pathname.startsWith('/coins/') && !pathname.includes('/market_chart') && req.method === 'GET') {
    const id = pathname.replace('/coins/', '').toLowerCase();
    const sym = ID_TO_SYMBOL[id] || id.toUpperCase();
    const p = getPrice(sym);
    const now = new Date().toISOString();

    const responseData = {
      id,
      symbol: sym.toLowerCase(),
      name: sym,
      market_data: {
        current_price: { usd: p },
        price_change_percentage_24h: 0.5,
        price_change_percentage_7d: 1.2,
        price_change_percentage_30d: 5.0,
        total_volume: { usd: Math.round(p * 1000000) },
        market_cap: { usd: Math.round(p * 100000000) },
        market_cap_rank: 1,
        high_24h: { usd: Number((p * 1.05).toFixed(6)) },
        low_24h: { usd: Number((p * 0.95).toFixed(6)) }
      },
      last_updated: now
    };

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(responseData));
    return;
  }

  // CoinGecko Price History Endpoint: GET /coins/:id/market_chart
  if (pathname.startsWith('/coins/') && pathname.includes('/market_chart') && req.method === 'GET') {
    const parts = pathname.split('/');
    const id = parts[2];
    const sym = ID_TO_SYMBOL[id] || id.toUpperCase();
    const p = getPrice(sym);
    const days = parseInt(String(parsedUrl.query.days || '7'), 10);
    const now = Date.now();
    const points = days * 24;
    const historyPrices = [];

    for (let i = points; i >= 0; i--) {
      const ts = now - i * 3600 * 1000;
      const varFactor = 1 + (Math.sin(i / 5) * 0.02);
      historyPrices.push([ts, Number((p * varFactor).toFixed(6))]);
    }

    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ prices: historyPrices }));
    return;
  }

  // Default Not Found
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Endpoint not found on mock Reflector service' }));
});

server.listen(PORT, () => {
  console.log(`Mock Reflector service listening on port ${PORT}`);
});
