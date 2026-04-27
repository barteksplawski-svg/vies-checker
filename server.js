import express from "express";
import cors from "cors";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";
import { Resend } from "resend";

dotenv.config();

const app = express();
const PORT = Number(process.env.PORT) || 10000;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DEFAULT_FROM_EMAIL =
  process.env.RESEND_FROM_EMAIL || "VAT Checker <onboarding@resend.dev>";
const VIES_TIMEOUT_MS = 8000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function normalizeCountry(value) {
  return String(value || "")
    .trim()
    .toUpperCase();
}

function normalizeVat(value) {
  return String(value || "")
    .trim()
    .replace(/\s+/g, "")
    .replace(/[^a-zA-Z0-9]/g, "")
    .toUpperCase();
}

function isValidCountry(country) {
  return /^[A-Z]{2}$/.test(country);
}

function isValidVat(vat) {
  return /^[A-Z0-9]{2,20}$/.test(vat);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

function parseVatInput(source) {
  const country = normalizeCountry(source?.country);
  const vat = normalizeVat(source?.vat);

  if (!country || !vat) {
    return {
      ok: false,
      status: 400,
      error: "Missing country or vat"
    };
  }

  if (!isValidCountry(country)) {
    return {
      ok: false,
      status: 400,
      error: "Country must be a 2-letter code"
    };
  }

  if (!isValidVat(vat)) {
    return {
      ok: false,
      status: 400,
      error: "VAT must contain 2 to 20 alphanumeric characters"
    };
  }

  return {
    ok: true,
    country,
    vat
  };
}

async function fetchWithTimeout(url, timeout = VIES_TIMEOUT_MS) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);

  try {
    return await fetch(url, {
      signal: controller.signal,
      headers: {
        Accept: "application/json"
      }
    });
  } finally {
    clearTimeout(timer);
  }
}

async function checkVAT(country, vat) {
  const url =
    "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number" +
    `?memberStateCode=${encodeURIComponent(country)}` +
    `&number=${encodeURIComponent(vat)}`;

  try {
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new Error(`VIES returned HTTP ${response.status}`);
    }

    const data = await response.json();

    return {
      ok: true,
      valid: Boolean(data.valid),
      name: data.name?.trim() || "-",
      address: data.address?.trim() || "-",
      country,
      vat,
      requestDate: new Date().toISOString()
    };
  } catch (error) {
    return {
      ok: false,
      valid: false,
      name: "-",
      address: "-",
      country,
      vat,
      error: "VIES system unavailable",
      details: error instanceof Error ? error.message : "Unknown error",
      requestDate: new Date().toISOString()
    };
  }
}

function generatePDF(report) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      margin: 50,
      size: "A4"
    });
    const buffers = [];

    doc.on("data", (chunk) => buffers.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(buffers)));
    doc.on("error", reject);

    doc.info.Title = "VAT Report";
    doc.info.Author = "VIES Checker API";

    doc.fontSize(18).text("VAT Report", { align: "left" });
    doc.moveDown();

    const lines = [
      `Status: ${report.valid ? "Valid" : "Invalid or unavailable"}`,
      `Country: ${report.country}`,
      `VAT: ${report.vat}`,
      `Name: ${report.name}`,
      `Address: ${report.address}`,
      `Checked at: ${report.requestDate}`
    ];

    if (report.error) {
      lines.push(`Error: ${report.error}`);
    }

    if (report.details) {
      lines.push(`Details: ${report.details}`);
    }

    doc.fontSize(11);
    for (const line of lines) {
      doc.text(line);
      doc.moveDown(0.5);
    }

    doc.end();
  });
}

function getResendClient() {
  if (!RESEND_API_KEY) {
    throw new Error("RESEND_API_KEY is missing");
  }

  return new Resend(RESEND_API_KEY);
}

app.get("/", (req, res) => {
  res.json({
    service: "VIES Checker API",
    status: "running",
    version: "1.0.0"
  });
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime(),
    resendConfigured: Boolean(RESEND_API_KEY)
  });
});

app.get("/check", async (req, res) => {
  const parsed = parseVatInput(req.query);

  if (!parsed.ok) {
    return res.status(parsed.status).json({ error: parsed.error });
  }

  const report = await checkVAT(parsed.country, parsed.vat);
  return res.json(report);
});

app.get("/pdf", async (req, res, next) => {
  try {
    const parsed = parseVatInput(req.query);

    if (!parsed.ok) {
      return res.status(parsed.status).json({ error: parsed.error });
    }

    const report = await checkVAT(parsed.country, parsed.vat);
    const pdf = await generatePDF(report);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="vat-report-${parsed.country}-${parsed.vat}.pdf"`
    );

    return res.send(pdf);
  } catch (error) {
    return next(error);
  }
});

app.post("/send-email", async (req, res, next) => {
  try {
    const { email } = req.body ?? {};
    const parsed = parseVatInput(req.body);

    if (!email || !isValidEmail(email)) {
      return res.status(400).json({
        error: "Valid email is required"
      });
    }

    if (!parsed.ok) {
      return res.status(parsed.status).json({ error: parsed.error });
    }

    const report = await checkVAT(parsed.country, parsed.vat);
    const pdf = await generatePDF(report);
    const resend = getResendClient();

    const result = await resend.emails.send({
      from: DEFAULT_FROM_EMAIL,
      to: [String(email).trim()],
      subject: `VAT Report for ${parsed.country}${parsed.vat}`,
      text: [
        "Your VAT report is attached.",
        "",
        `Country: ${parsed.country}`,
        `VAT: ${parsed.vat}`,
        `Status: ${report.valid ? "Valid" : "Invalid or unavailable"}`
      ].join("\n"),
      attachments: [
        {
          filename: `vat-report-${parsed.country}-${parsed.vat}.pdf`,
          content: pdf.toString("base64")
        }
      ]
    });

    return res.json({
      ok: true,
      message: "Email sent",
      result
    });
  } catch (error) {
    return next(error);
  }
});

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found"
  });
});

app.use((error, req, res, next) => {
  console.error("SERVER ERROR:", error);

  res.status(500).json({
    error: "Internal server error",
    message: error instanceof Error ? error.message : "Unknown error"
  });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});