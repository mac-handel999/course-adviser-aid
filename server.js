require('dotenv').config();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const app = require('./server/app');

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`API server running at http://localhost:${PORT}`);
});
