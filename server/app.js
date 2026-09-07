require('dotenv').config();
const express = require('express');
const cors = require('cors');
const resultsRouter = require('./routes/results');
const accountRouter = require('./routes/account');

const app = express();

app.use(cors());
app.use(express.json());

app.use('/api/results', resultsRouter);
app.use('/api/account', accountRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = app;
