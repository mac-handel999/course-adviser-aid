require('dotenv').config();
const express = require('express');
const cors = require('cors');
const resultsRouter = require('./routes/results');
const accountRouter = require('./routes/account');
const settingsRouter = require('./routes/settings');
const creditLoadRouter = require('./routes/creditLoad');
const academicSessionsRouter = require('./routes/academicSessions');
const publicPortalRouter = require('./routes/publicPortal');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/results', resultsRouter);
app.use('/api/account', accountRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/credit-load', creditLoadRouter);
app.use('/api/academic-sessions', academicSessionsRouter);
app.use('/api/public', publicPortalRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = app;
