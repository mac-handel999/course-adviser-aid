const express = require('express');
const router = express.Router();
const { GoogleGenerativeAI, SchemaType } = require('@google/generative-ai');
const requireAuth = require('../middleware/requireAuth');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const SCORE_SCHEMA = {
  type: SchemaType.ARRAY,
  description: 'List of student scores extracted from a results sheet table. Each object represents one student row. Include ALL students visible in the table.',
  items: {
    type: SchemaType.OBJECT,
    properties: {
      reg_no: {
        type: SchemaType.STRING,
        description: 'Registration number — digits only, 11 characters, no slashes or letters. e.g. 20211234567. If the raw value has slashes or extra characters, strip everything except digits and take the first 11.'
      },
      test: {
        type: SchemaType.NUMBER,
        description: 'Test score (0-30 typically). Default to 0 if blank, dashed, or not visible.'
      },
      lab: {
        type: SchemaType.NUMBER,
        description: 'Lab or Practical score (0-20 typically). Default to 0 if blank, dashed, or not visible.'
      },
      exam: {
        type: SchemaType.NUMBER,
        description: 'Exam score (0-70 typically). Default to 0 if blank, dashed, or not visible.'
      },
      remark: {
        type: SchemaType.STRING,
        description: 'Any remark column value (e.g. "Carry Over", "Pass"). Empty string if not present.'
      }
    },
    required: ['reg_no', 'test', 'lab', 'exam']
  }
};

const SCAN_PROMPT = `
You are an expert data extraction assistant. Extract ALL student academic records
from the table visible in this image. The table contains columns for Registration
Number, Test, Lab, and Exam scores (and optionally a Remark column).

Extract each student row as a JSON object with:
- reg_no: the registration number — strip ALL non-digit characters (slashes,
  letters, spaces) and keep only the first 11 digits. e.g. "2021/1234567" →
  "20211234567"
- test: the Test score as a number. If blank, dashed, or missing, use 0.
- lab: the Lab/Practical score as a number. If blank, dashed, or missing, use 0.
- exam: the Exam score as a number. If blank, dashed, or missing, use 0.
- remark: the Remark text, or empty string if not present.

If the table has only a single "Score" column (no Test/Lab/Exam breakdown),
put the score value in the exam field and set test=0, lab=0.

Return the data as a strict JSON array. Do not include any explanatory text
outside the JSON array. If no table is visible, return an empty array [].
`;

router.use(requireAuth);

router.post('/scan-result', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'Gemini API key not configured on server.' });
    }

    const { imageBase64, mimeType } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required.' });
    }

    const model = genAI.getGenerativeModel({
      model: 'gemini-2.5-flash',
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: SCORE_SCHEMA,
      },
    });

    const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    const mime = mimeType || 'image/jpeg';

    const imagePart = {
      inlineData: {
        data: base64,
        mimeType: mime,
      },
    };

    const result = await model.generateContent([SCAN_PROMPT, imagePart]);
    const text = result.response.text();

    let extracted;
    try {
      extracted = JSON.parse(text);
    } catch (parseErr) {
      console.error('Gemini JSON parse error:', parseErr.message, text.slice(0, 500));
      return res.status(502).json({ error: 'AI returned invalid JSON. Please try a clearer photo.' });
    }

    if (!Array.isArray(extracted)) {
      extracted = [];
    }

    const cleaned = extracted.map(row => ({
      reg_no: String(row.reg_no || '').trim(),
      test: Number(row.test) || 0,
      lab: Number(row.lab) || 0,
      exam: Number(row.exam) || 0,
      remark: String(row.remark || '').trim(),
    })).filter(row => row.reg_no && /^\d{11}$/.test(row.reg_no));

    res.json({ success: true, data: cleaned });
  } catch (err) {
    console.error('OCR scan-result error:', err.message);
    res.status(500).json({ error: 'Failed to process image. Please try a clearer photo.' });
  }
});

module.exports = router;
