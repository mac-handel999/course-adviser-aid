const express = require('express');
const router = express.Router();
const { GoogleGenAI, Type } = require('@google/genai');
const requireAuth = require('../middleware/requireAuth');

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

const resultSchema = {
  type: Type.ARRAY,
  description: 'List of student scores extracted from result sheet table',
  items: {
    type: Type.OBJECT,
    properties: {
      reg_no: { type: Type.STRING, description: 'Registration number, e.g., 20241444752. Strip all non-digit characters and keep the first 11 digits.' },
      test: { type: Type.NUMBER, description: 'Test score or 0 if empty/nan/dashed' },
      lab: { type: Type.NUMBER, description: 'Lab/Practical score or 0 if empty/nan/dashed' },
      exam: { type: Type.NUMBER, description: 'Exam score or 0 if empty/nan/dashed' }
    },
    required: ['reg_no']
  }
};

const SCAN_PROMPT = `
Extract all valid student records from this result sheet table image.
Locate the columns for Registration Number, Test, Lab, and Exam scores.
Ignore row headers, empty rows, or NaN values that lack a valid Reg No.
Clean registration numbers: strip all non-digit characters (slashes,
letters, spaces) and keep the first 11 digits only.
If a score column is missing, blank, dashed, or NaN, default it to 0.
If only a single total score column exists (no Test/Lab/Exam breakdown),
place the score value in the exam field with test=0 and lab=0.
Return a strict JSON array. Do not include any explanatory text.
If no student table is visible, return an empty array [].
`;

router.use(requireAuth);

router.post('/scan-result', async (req, res) => {
  const GEMINI_TIMEOUT_MS = 90000;

  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({
        error: 'Gemini API key not configured on server.',
        details: 'Set GEMINI_API_KEY environment variable.'
      });
    }

    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'No image payload provided.' });
    }

    // Clean up base64 string and extract MIME type
    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '').trim();

    // AbortController for timeout — the new SDK supports abortSignal via config
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), GEMINI_TIMEOUT_MS);

    let response;
    try {
      response = await ai.models.generateContent({
        model: 'gemini-3.8-flash',
        config: {
          responseMimeType: 'application/json',
          responseSchema: resultSchema,
          abortSignal: controller.signal,
        },
        contents: [{
          role: 'user',
          parts: [
            { text: SCAN_PROMPT },
            { inlineData: { data: cleanBase64, mimeType: mimeType } }
          ]
        }]
      });
    } catch (genErr) {
      if (genErr.name === 'AbortError') {
        return res.status(504).json({
          error: 'Gemini API timed out.',
          details: 'The image is too large or the network is slow. Try a smaller image or fewer students.'
        });
      }
      throw genErr;
    } finally {
      clearTimeout(timeoutId);
    }

    const text = response.text;

    let extracted;
    try {
      extracted = JSON.parse(text || '[]');
    } catch (parseErr) {
      console.error('Gemini JSON parse error:', parseErr.message, (text || '').slice(0, 500));
      return res.status(502).json({
        error: 'AI returned invalid JSON.',
        details: 'The AI model returned a response that could not be parsed as JSON. Try a clearer photo with less overlap between text rows.'
      });
    }

    if (!Array.isArray(extracted)) {
      extracted = [];
    }

    // Clean and validate each row
    const cleaned = extracted
      .map(row => {
        const reg = String(row.reg_no || '').trim().replace(/\D/g, '').slice(0, 11);
        return {
          reg_no: reg,
          test: Number(row.test) || 0,
          lab: Number(row.lab) || 0,
          exam: Number(row.exam) || 0,
          remark: String(row.remark || '').trim()
        };
      })
      .filter(row => row.reg_no && /^\d{11}$/.test(row.reg_no));

    res.json({ success: true, data: cleaned });
  } catch (err) {
    console.error('OCR scan-result error:', err.message);
    let details = err.message || 'Unknown error';

    if (err.message && err.message.includes('fetch failed')) {
      details = 'Network error contacting Gemini API. Verify GEMINI_API_KEY is set and the server can reach generativelanguage.googleapis.com.';
    }

    res.status(500).json({
      error: 'Failed to process image.',
      details
    });
  }
});

module.exports = router;
