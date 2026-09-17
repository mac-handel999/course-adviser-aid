require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const resultsRouter = require('./routes/results');
const accountRouter = require('./routes/account');
const settingsRouter = require('./routes/settings');
const academicSessionsRouter = require('./routes/academicSessions');
const coursesRouter = require('./routes/courses');
const studentsRouter = require('./routes/students');
const publicPortalRouter = require('./routes/publicPortal');
const dashboardRouter = require('./routes/dashboard');
const ocrRouter = require('./routes/ocr');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ limit: '10mb', extended: true }));
app.use(express.static(path.join(__dirname, '..')));

app.use('/api/results', resultsRouter);
app.use('/api/account', accountRouter);
app.use('/api/settings', settingsRouter);
app.use('/api/academic-sessions', academicSessionsRouter);
app.use('/api/courses', coursesRouter);
app.use('/api/students', studentsRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/ocr', ocrRouter);
app.use('/api/public', publicPortalRouter);

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok' });
});

module.exports = app;
