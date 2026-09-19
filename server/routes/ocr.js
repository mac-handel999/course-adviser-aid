const express = require('express');
const router = express.Router();
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');
const { GoogleGenAI, Type } = require('@google/genai');
const Groq = require('groq-sdk');
const requireAuth = require('../middleware/requireAuth');

const resultSchema = {
  type: Type.ARRAY,
  description: 'List of student scores extracted from result sheet table',
  items: {
    type: Type.OBJECT,
    properties: {
      reg_no: { type: Type.STRING, description: 'Registration number, e.g., 20241444752 — strip all non-digit characters and keep the first 11 digits only' },
      test: { type: Type.NUMBER, description: 'Test score or 0 if empty/nan' },
      lab: { type: Type.NUMBER, description: 'Lab/Practical score or 0 if empty/nan' },
      exam: { type: Type.NUMBER, description: 'Exam score or 0 if empty/nan' }
    },
    required: ['reg_no']
  }
};

const rosterSchema = {
  type: Type.ARRAY,
  description: 'List of students with registration number and full name extracted from a class roster list or sheet',
  items: {
    type: Type.OBJECT,
    properties: {
      reg_no: { type: Type.STRING, description: 'Registration number, e.g., 20241444752 — strip all non-digit characters and keep the first 11 digits only' },
      full_name: { type: Type.STRING, description: 'Student full name as it appears on the roster, e.g. Jane Doe' }
    },
    required: ['reg_no', 'full_name']
  }
};

const SCAN_PROMPT = `
Extract all valid student records from this result sheet table image.
Locate the columns for Registration Number, Test, Lab, and Exam scores.
Course code, course title, and credit unit are configured by the adviser in the web app when launching a course. Do not extract or return those fields.
Ignore row headers, empty rows, or NaN values that lack a valid Reg No.
Clean registration numbers: strip ALL non-digit characters (slashes,
letters, spaces) and keep the first 11 digits only. e.g. "2021/1234567"
becomes "20211234567".
If a score column is missing, blank, dashed, or NaN, default it to 0.
If only a single total score column exists (no Test/Lab/Exam breakdown),
place the score value in the exam field with test=0 and lab=0.
Return a compact strict JSON array. Do not include explanatory text.
If no student table is visible, return an empty array [].

Schema (return exactly this shape):
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "reg_no": { "type": "string", "description": "Registration number, e.g. 20241444752 — strip all non-digit characters and keep the first 11 digits only" },
      "test": { "type": "number", "description": "Test score or 0 if empty/nan" },
      "lab": { "type": "number", "description": "Lab score or 0 if empty/nan" },
      "exam": { "type": "number", "description": "Exam score or 0 if empty/nan" }
    },
    "required": ["reg_no"]
  }
}
`;

const GROQ_PROMPT = `
You are an OCR data extractor. Extract all student result records from the
table in this image. Locate columns for Registration Number, Test, Lab, and
Exam scores. Course code, course title, and credit unit are configured by the
adviser in the web app when launching a course; do not return those fields.

Rules:
- Strip ALL non-digit characters from registration numbers and keep the
  first 11 digits only. e.g. "2021/1234567" becomes "20211234567".
- Default any missing, blank, dashed, or NaN score to 0.
- If only a single total score column exists, put it in "exam" with
  test=0 and lab=0.
- Return a compact strict JSON array. Do not include explanatory text.
- If no student table is visible, return [].

Return exactly this JSON shape (no extra keys):
{
  "type": "array",
  "items": {
    "type": "object",
    "properties": {
      "reg_no": { "type": "string" },
      "test": { "type": "number" },
      "lab": { "type": "number" },
      "exam": { "type": "number" }
    },
    "required": ["reg_no"]
  }
}
`;

const GROQ_TIMEOUT_MS = 30000;
const GROQ_MAX_TOKENS = 512;
const GROQ_MAX_TOKENS_RETRY = 256;
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const GROQ_MODEL = process.env.GROQ_MODEL || 'qwen/qwen3.8-27b';

const geminiAI = new GoogleGenAI({
  apiKey: process.env.GEMINI_API_KEY || '',
  httpOptions: {
    retryOptions: {
      attempts: 3,
      initialDelay: 1.0,
      maxDelay: 10.0,
      expBase: 2.0,
      jitter: 0.5,
    },
  },
});

let groqClient = null;
function getGroqClient() {
  if (!groqClient) {
    groqClient = new Groq({
      apiKey: process.env.GROQ_API_KEY || '',
      timeout: GROQ_TIMEOUT_MS,
      maxRetries: 2,
    });
  }
  return groqClient;
}

function isTransientError(err) {
  if (!err) return false;
  const msg = err.message || (err.error && JSON.stringify(err.error)) || '';
  return msg.includes('503') || msg.includes('UNAVAILABLE') ||
    msg.includes('high demand') || msg.includes('overloaded') ||
    msg.includes('fetch failed') || msg.includes('timeout') ||
    msg.includes('ECONNRESET') || msg.includes('ETIMEDOUT') ||
    msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429');
}

function errorText(err) {
  if (!err) return '';
  const parts = [];
  if (typeof err.message === 'string') parts.push(err.message);
  for (const value of [err.error, err.body]) {
    if (typeof value === 'string') {
      parts.push(value);
    } else if (value) {
      try {
        parts.push(JSON.stringify(value));
      } catch (e) {
        parts.push('[unserializable provider error]');
      }
    }
  }
  return parts.join(' ');
}

function isQuotaError(err) {
  if (!err) return false;
  if (err.status === 429 || err.statusCode === 429) return true;
  const error = err.error;
  if (error && (error.code === 429 || error.status === 429 || error.statusCode === 429)) return true;
  const msg = errorText(err).toLowerCase();
  return msg.includes('rate_limit_exceeded') ||
    msg.includes('resource_exhausted') ||
    msg.includes('quota') ||
    msg.includes('request too large');
}

function retryAfterSeconds(err) {
  const msg = errorText(err);
  const delay = msg.match(/(?:retry[_ -]?delay|retryDelay)\\?["']?\s*[:=]\s*\\?["']?(\d+(?:\.\d+)?)\s*(ms|s)?/i);
  if (delay) {
    const value = Number(delay[1]);
    const multiplier = delay[2] && delay[2].toLowerCase() === 'ms' ? 0.001 : 1;
    return Math.max(1, Math.ceil(value * multiplier));
  }
  const headers = err && err.headers;
  const value = headers && (typeof headers.get === 'function' ? headers.get('retry-after') : headers['retry-after']);
  if (!value) return null;
  const seconds = Number(value);
  return Number.isFinite(seconds) ? Math.max(1, seconds) : null;
}

function sendQuotaError(res, provider, retryAfter) {
  const delay = retryAfter || 60;
  res.set('Retry-After', String(delay));
  return res.status(429).json({
    error: 'AI provider quota exhausted.',
    details: `${provider} is temporarily rate-limited. Retry in about ${delay} seconds or configure a provider with higher token limits.`,
    retryAfter: delay
  });
}

function validateExtracted(extracted) {
  const errors = [];
  if (!Array.isArray(extracted)) {
    return { valid: [], errors: ['AI returned a non-array value.'] };
  }
  const valid = extracted.map((row, i) => {
    const rowErrors = [];
    if (!row || typeof row !== 'object') {
      rowErrors.push(`Item ${i}: not an object.`);
      return { valid: false, row: row, errors: rowErrors };
    }
    const reg = String(row.reg_no || '').trim().replace(/\D/g, '').slice(0, 11);
    if (!reg || !/^\d{11}$/.test(reg)) {
      rowErrors.push(`Item ${i}: missing or invalid reg_no.`);
    }
    const checked = { reg_no: reg };
    ['test', 'lab', 'exam'].forEach(field => {
      const raw = row[field];
      if (raw === undefined || raw === null || raw === '') {
        checked[field] = 0;
      } else if (typeof raw === 'number' && isFinite(raw)) {
        checked[field] = Math.max(0, Math.min(100, raw));
      } else if (typeof raw === 'string' && raw.trim() !== '') {
        const num = parseFloat(raw.replace(/[^\d.-]/g, '').trim());
        if (!isNaN(num) && isFinite(num)) {
          checked[field] = Math.max(0, Math.min(100, num));
        } else {
          checked[field] = 0;
        }
      } else {
        checked[field] = 0;
      }
    });
    if (row.remark !== undefined) {
      checked.remark = String(row.remark || '').trim();
    }
    return { valid: rowErrors.length === 0, row: checked, errors: rowErrors };
  });
  const cleanRows = valid.filter(v => v.valid).map(v => v.row);
  valid.forEach(v => { if (v.errors.length) errors.push(...v.errors); });
  return { valid: cleanRows, errors };
}

function validateRoster(extracted) {
  const errors = [];
  if (!Array.isArray(extracted)) {
    return { valid: [], errors: ['AI returned a non-array value.'] };
  }
  const valid = extracted.map((row, i) => {
    const rowErrors = [];
    if (!row || typeof row !== 'object') {
      rowErrors.push(`Item ${i}: not an object.`);
      return { valid: false, row: row, errors: rowErrors };
    }
    const reg = String(row.reg_no || '').trim().replace(/\D/g, '').slice(0, 11);
    if (!reg || !/^\d{11}$/.test(reg)) {
      rowErrors.push(`Item ${i}: missing or invalid reg_no.`);
    }
    const fullName = String(row.full_name || '').trim();
    if (!fullName) {
      rowErrors.push(`Item ${i}: missing full_name.`);
    }
    return { valid: rowErrors.length === 0, row: { reg_no: reg, full_name: fullName }, errors: rowErrors };
  });
  const cleanRows = valid.filter(v => v.valid).map(v => v.row);
  valid.forEach(v => { if (v.errors.length) errors.push(...v.errors); });
  return { valid: cleanRows, errors };
}

const ROSTER_SCAN_PROMPT = `
Extract all student records from this class roster or registration list image.
For each student, find their Registration Number and Full Name.
Ignore any score, grade, or course columns — only extract reg_no and full_name.

Clean registration numbers: strip ALL non-digit characters (slashes, letters,
spaces) and keep the first 11 digits only. e.g. "2021/1234567" becomes
"20211234567".

Return a strict JSON array with this exact shape:
[
  { "reg_no": "20211234567", "full_name": "Jane Doe" }
]

If no student list is visible, return an empty array [].
Do not include any explanatory text.
`;

const ROSTER_GROQ_PROMPT = `
You are an OCR data extractor. Extract all student records from the
class roster or registration list in this image. For each student, find
their Registration Number and Full Name. Ignore any score, grade, or
course columns — only extract reg_no and full_name.

Rules:
- Strip ALL non-digit characters from registration numbers and keep the
  first 11 digits only.
- Return a strict JSON array with this exact shape:
[
  { "reg_no": "20211234567", "full_name": "Jane Doe" }
]
- If no student list is visible, return [].
- Do not include any explanatory text.
`;

const rateLimit = require('express-rate-limit');

const ocrRateLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  keyGenerator: (req) => req.user?.id || req.ip,
  handler: (req, res) => {
    res.status(429).json({
      error: 'Too many AI scan requests.',
      details: 'Please wait a moment before scanning another image.'
    });
  },
});

router.use(requireAuth);
router.use(ocrRateLimiter);

router.post('/scan-result', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'No image payload provided.' });
    }

    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '').trim();

    let extracted = null;
    let provider = null;
    let groqError = null;
    let groqQuotaError = false;
    let groqRetryAfter = null;

    // --- Groq (primary) ---
    if (process.env.GROQ_API_KEY) {
      try {
        const base64DataUrl = `data:${mimeType};base64,${cleanBase64}`;

        const result = await getGroqClient().chat.completions.create({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: GROQ_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Extract student records from this result sheet image.' },
                { type: 'image_url', image_url: { url: base64DataUrl } }
              ]
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_completion_tokens: GROQ_MAX_TOKENS,
          reasoning_effort: 'none',
          include_reasoning: false,
        });
        const text = result.choices[0]?.message?.content;

         try {
           extracted = JSON.parse(text || '[]');
         } catch (parseErr) {
           console.error('Groq JSON parse error:', parseErr.message, (text || '').slice(0, 500));
           groqError = 'PARSE_ERROR';
         }

         if (extracted !== null) {
           provider = 'groq';
         }
        } catch (gErr) {
          groqError = gErr.message;
          groqQuotaError = isQuotaError(gErr);
          groqRetryAfter = retryAfterSeconds(gErr);
          if (groqQuotaError) {
            console.warn('Groq quota error:', gErr.message, '— attempting Gemini fallback.');
            if (GROQ_MAX_TOKENS > GROQ_MAX_TOKENS_RETRY) {
              try {
                console.log(`Groq retry with reduced max_completion_tokens=${GROQ_MAX_TOKENS_RETRY}...`);
                const retryResult = await getGroqClient().chat.completions.create({
                  model: GROQ_MODEL,
                  messages: [
                    { role: 'system', content: GROQ_PROMPT },
                    {
                      role: 'user',
                      content: [
                        { type: 'text', text: 'Extract student records from this result sheet image.' },
                        { type: 'image_url', image_url: { url: base64DataUrl } }
                      ]
                    }
                  ],
                  response_format: { type: 'json_object' },
                  temperature: 0.1,
                  max_completion_tokens: GROQ_MAX_TOKENS_RETRY,
                });
                const retryText = retryResult.choices[0]?.message?.content;
                try {
                  extracted = JSON.parse(retryText || '[]');
                } catch (parseErr2) {
                  console.error('Groq retry JSON parse error:', parseErr2.message);
                }
                if (extracted !== null) {
                  provider = 'groq';
                }
              } catch (retryErr) {
                console.error('Groq retry also failed:', retryErr.message);
              }
            }
          } else if (isTransientError(gErr)) {
            console.warn('Groq transient error:', gErr.message, '— attempting Gemini fallback.');
          } else {
            console.error('Groq error:', gErr.message, '— attempting Gemini fallback.');
          }
        }
      }

    // --- Gemini (fallback) ---
    if (extracted === null) {
      if (!process.env.GEMINI_API_KEY) {
        if (groqQuotaError) {
          return sendQuotaError(res, 'Groq', groqRetryAfter);
        }
        const errMsg = process.env.GROQ_API_KEY
          ? 'Gemini fallback API key not configured on server.'
          : 'Neither GROQ_API_KEY nor GEMINI_API_KEY is configured on server.';
        return res.status(500).json({
          error: errMsg,
          details: 'Set the required environment variable(s) in .env.'
        });
      }

      try {
        const response = await geminiAI.models.generateContent({
          model: GEMINI_MODEL,
          config: {
            responseMimeType: 'application/json',
            responseSchema: resultSchema,
          },
          contents: [{
            role: 'user',
            parts: [
              { text: SCAN_PROMPT },
              { inlineData: { data: cleanBase64, mimeType: mimeType } }
            ]
          }]
        });
        const text = response.text;

        try {
          extracted = JSON.parse(text || '[]');
        } catch (parseErr) {
          console.error('Gemini JSON parse error:', parseErr.message, (text || '').slice(0, 500));
          return res.status(502).json({
            error: 'AI returned invalid JSON.',
            details: 'Both Groq and Gemini models returned responses that could not be parsed as JSON.'
          });
        }

        provider = 'gemini';
      } catch (genErr) {
        if (isQuotaError(genErr)) {
          const delay = retryAfterSeconds(genErr) || groqRetryAfter;
          const quotaProvider = groqQuotaError ? 'Groq and Gemini' : 'Gemini';
          return sendQuotaError(res, quotaProvider, delay);
        }
        if (genErr.name === 'AbortError' || (genErr.message || '').includes('timeout')) {
          const details = groqQuotaError
            ? 'Groq is rate-limited and Gemini timed out. Try again later or configure a provider with higher token limits.'
            : 'Groq and Gemini both timed out. Try a smaller image.';
          return res.status(504).json({
            error: 'AI extraction timed out.',
            details
          });
        }
        const isConnection = (genErr.message || '').includes('Connection error') ||
          (genErr.message || '').includes('ECONNREFUSED') ||
          (genErr.message || '').includes('ENOTFOUND') ||
          (genErr.message || '').includes('ETIMEDOUT') ||
          (genErr.message || '').includes('EAI_AGAIN') ||
          (genErr.message || '').includes('fetch failed');
        console.error('Gemini fallback error:', genErr.message);
        if (groqQuotaError && isConnection) {
          return res.status(502).json({
            error: 'AI extraction failed.',
            details: 'Groq is rate-limited and the Gemini fallback cannot be reached. Try again later or configure another provider.'
          });
        }
        return res.status(502).json({
          error: 'AI extraction failed.',
          details: isConnection
            ? 'Cannot reach the AI API. Verify API keys are set and the server has internet access.'
            : `Groq: ${groqError || 'failed'}\nGemini: ${genErr.message}`
        });
      }
    }

    if (!Array.isArray(extracted)) {
      extracted = [];
    }

    // --- Server-side validation (Part C) ---
    const { valid: cleaned, errors: validationErrors } = validateExtracted(extracted);

    if (validationErrors.length && cleaned.length === 0) {
      console.error('OCR validation errors (all rows invalid):', validationErrors);
      return res.status(400).json({
        error: 'AI returned no valid student records.',
        details: validationErrors.join('; ')
      });
    }

    if (validationErrors.length) {
      console.warn('OCR validation warnings (partial):', validationErrors);
    }

    res.json({ success: true, data: cleaned, provider });
  } catch (err) {
    console.error('OCR scan-result error:', err.message);
    const errStr = err.message || (err.error && JSON.stringify(err.error)) || '';
    let details = err.message || 'Unknown error';

    if (errStr.includes('503') || errStr.includes('UNAVAILABLE') ||
        errStr.includes('high demand') || errStr.includes('overloaded')) {
      details = 'The AI service is experiencing high demand. Please try again in a few minutes.';
    }
    if (err.message && err.message.includes('fetch failed')) {
      details = 'Network error contacting AI API. Verify API keys are set and the server can reach the provider.';
    }

    res.status(500).json({
      error: 'Failed to process image.',
      details
    });
  }
});

/* ===================== POST /api/ocr/scan-roster =====================
   Extract { reg_no, full_name } pairs from a class roster image.
   Uses Groq (primary) with Gemini fallback, same pattern as scan-result. */
router.post('/scan-roster', async (req, res) => {
  try {
    const { imageBase64 } = req.body;
    if (!imageBase64) {
      return res.status(400).json({ error: 'No image payload provided.' });
    }

    const mimeMatch = imageBase64.match(/^data:(image\/\w+);base64,/);
    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
    const cleanBase64 = imageBase64.replace(/^data:image\/\w+;base64,/, '').trim();

    let extracted = null;
    let provider = null;

    if (process.env.GROQ_API_KEY) {
      try {
        const base64DataUrl = `data:${mimeType};base64,${cleanBase64}`;

        const result = await getGroqClient().chat.completions.create({
          model: GROQ_MODEL,
          messages: [
            { role: 'system', content: ROSTER_GROQ_PROMPT },
            {
              role: 'user',
              content: [
                { type: 'text', text: 'Extract student names and registration numbers from this roster image.' },
                { type: 'image_url', image_url: { url: base64DataUrl } }
              ]
            }
          ],
          response_format: { type: 'json_object' },
          temperature: 0.1,
          max_completion_tokens: GROQ_MAX_TOKENS,
        });
        const text = result.choices[0]?.message?.content;

        try {
          extracted = JSON.parse(text || '[]');
        } catch (parseErr) {
          console.error('Groq roster parse error:', parseErr.message, (text || '').slice(0, 500));
          extracted = null;
        }

        if (extracted !== null) {
          provider = 'groq';
        }
      } catch (gErr) {
        console.warn('Groq roster error:', gErr.message, '— attempting Gemini fallback.');
        if (isQuotaError(gErr) && GROQ_MAX_TOKENS > GROQ_MAX_TOKENS_RETRY) {
          try {
            console.log(`Groq roster retry with reduced max_completion_tokens=${GROQ_MAX_TOKENS_RETRY}...`);
            const retryResult = await getGroqClient().chat.completions.create({
              model: GROQ_MODEL,
              messages: [
                { role: 'system', content: ROSTER_GROQ_PROMPT },
                {
                  role: 'user',
                  content: [
                    { type: 'text', text: 'Extract student names and registration numbers from this roster image.' },
                    { type: 'image_url', image_url: { url: base64DataUrl } }
                  ]
                }
              ],
              response_format: { type: 'json_object' },
              temperature: 0.1,
              max_completion_tokens: GROQ_MAX_TOKENS_RETRY,
            });
            const retryText = retryResult.choices[0]?.message?.content;
            try {
              extracted = JSON.parse(retryText || '[]');
            } catch (parseErr2) {
              console.error('Groq roster retry JSON parse error:', parseErr2.message);
            }
            if (extracted !== null) {
              provider = 'groq';
            }
          } catch (retryErr) {
            console.error('Groq roster retry also failed:', retryErr.message);
          }
        }
      }
    }

    if (extracted === null) {
      if (!process.env.GEMINI_API_KEY) {
        return res.status(500).json({
          error: 'AI provider not configured.',
          details: 'Set GROQ_API_KEY and/or GEMINI_API_KEY in .env.'
        });
      }

      try {
        const response = await geminiAI.models.generateContent({
          model: GEMINI_MODEL,
          config: {
            responseMimeType: 'application/json',
            responseSchema: rosterSchema,
          },
          contents: [{
            role: 'user',
            parts: [
              { text: ROSTER_SCAN_PROMPT },
              { inlineData: { data: cleanBase64, mimeType: mimeType } }
            ]
          }]
        });
        const text = response.text;

        try {
          extracted = JSON.parse(text || '[]');
        } catch (parseErr) {
          console.error('Gemini roster parse error:', parseErr.message, (text || '').slice(0, 500));
          return res.status(502).json({
            error: 'AI returned invalid JSON.',
            details: 'Both AI providers returned unparseable responses.'
          });
        }

        provider = 'gemini';
      } catch (genErr) {
        console.error('Gemini roster fallback error:', genErr.message);
        return res.status(502).json({
          error: 'AI extraction failed.',
          details: 'Both AI providers failed. Try again later.'
        });
      }
    }

    if (!Array.isArray(extracted)) {
      extracted = [];
    }

    const { valid: cleaned, errors: validationErrors } = validateRoster(extracted);

    if (validationErrors.length && cleaned.length === 0) {
      console.error('OCR roster validation errors (all rows invalid):', validationErrors);
      return res.status(400).json({
        error: 'AI returned no valid student records.',
        details: validationErrors.join('; ')
      });
    }

    if (validationErrors.length) {
      console.warn('OCR roster validation warnings (partial):', validationErrors);
    }

    res.json({ success: true, data: cleaned, provider, count: cleaned.length });
  } catch (err) {
    console.error('OCR scan-roster error:', err.message);
    res.status(500).json({
      error: 'Failed to process image.',
      details: err.message
    });
  }
});

module.exports = router;
