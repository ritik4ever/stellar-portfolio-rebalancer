export const API_CONFIG = {
    BASE_URL: window.location.hostname === 'localhost'
        ? 'http://localhost:3001'  // Local backend
        : 'https://stellar-portfolio-rebalancer.onrender.com'  // Deployed backend
}