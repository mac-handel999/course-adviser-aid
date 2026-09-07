const isLocalhost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
const currentPort = window.location.port;
const API_BASE = (isLocalhost && currentPort && currentPort !== '3001') ? 'http://localhost:3001' : '';
