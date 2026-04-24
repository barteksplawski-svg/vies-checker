import express from "express";
import cors from "cors";
import axios from "axios";
import PDFDocument from "pdfkit";
import nodemailer from "nodemailer";
import dotenv from "dotenv";

dotenv.config();

const app = express();

app.use(cors());
app.use(express.json());

/**
 * CRITICAL FOR RENDER:
 * ONLY process.env.PORT (NO FALLBACKS)
 */
const PORT = process.env.PORT;

/* -------------------------
   HEALTH CHECK ROOT
   (fixes: Cannot GET /)
--------------------------*/
app.get("/", (req, res) => {
  res.status(200).json({
    service: "VIES Checker API",
    status: "live",
    commit: "376394f",
    endpoints: [
      "/check?country=PL&vat=1234567890",
      "/pdf?country=PL&vat=1234567890",
      "/send-email"
    ]
  });
});

/* -------------------------
   VIES CHECK (EU VAT API)
--------------------------*/
async function checkVAT(countryCode, vatNumber) {
  try {
    const response = await axios.get(
      "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number",
      {
        params: {
          memberStateCode: countryCode,
          number: vatNumber
        }
      }
    );

    return {
      valid: response.data.valid,
      name: response.data.name,
      address: response.data.address,
      countryCode,
      vatNumber
    };
  } catch (err) {
    return {
      valid: false,
      error: "VIES system unavailable"
    };
  }
}

/* -------------------------
   PDF GENERATION
--------------------------*/
function generatePDF(data) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    const id = `VIES-${Date.now()}`;

    doc.fontSize(18).text("VAT VALIDATION REPORT", { align: "center" });
    doc.moveDown();

    doc.fontSize(10).text(`Report ID: ${id}`);
    doc.text(`Generated: ${new Date().toISOString()}`);

    doc.moveDown();

    doc.fontSize(12).text(`VAT: ${data.countryCode}${data.vatNumber}`);
    doc.text(`STATUS: ${data.valid ? "VALID" : "INVALID"}`);
    doc.text(`COMPANY: ${data.name || "-"}`);
    doc.text(`ADDRESS: ${data.address || "-"}`);

    doc.moveDown();

    doc.fontSize(10).text(
      "Validated via EU VIES (VAT Information Exchange System)"
    );

    doc.end();
  });
}

/* -------------------------
   API: CHECK
--------------------------*/
app.get("/check", async (req, res) => {
  const { country, vat } = req.query;

  if (!country || !vat) {
    return res.status(400).json({ error: "Missing parameters" });
  }

  const data = await checkVAT(country, vat);
  res.json(data);
});

/* -------------------------
   API: PDF
--------------------------*/
app.get("/pdf", async (req, res) => {
  const { country, vat } = req.query;

  if (!country || !vat) {
    return res.status(400).send("Missing parameters");
  }

  const data = await checkVAT(country, vat);
  const pdf = await generatePDF(data);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=vies.pdf");

  res.send(pdf);
});

/* -------------------------
   EMAIL LEAD FLOW
--------------------------*/
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

app.post("/send-email", async (req, res) => {
  const { email, country, vat, newsletter } = req.body;

  if (!email || !country || !vat) {
    return res.status(400).json({ error: "Missing data" });
  }

  const data = await checkVAT(country, vat);
  const pdf = await generatePDF(data);

  await transporter.sendMail({
    from: "VIES Checker <no-reply@vies-checker.com>",
    to: email,
    subject: "VAT Validation Report",
    text: "Your VAT report is attached.",
    attachments: [
      {
        filename: "vies.pdf",
        content: pdf
      }
    ]
  });

  if (newsletter) {
    console.log("NEWSLETTER OPT-IN:", email);
  }

  res.json({ success: true });
});

/* -------------------------
   START SERVER (RENDER SAFE)
--------------------------*/
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port", PORT);
});