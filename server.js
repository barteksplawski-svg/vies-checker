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

const PORT = process.env.PORT || 3001;

/**
 * VIES CHECK (fallback API style)
 */
async function checkVAT(countryCode, vatNumber) {
  try {
    const res = await axios.get(
      "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number",
      {
        params: {
          memberStateCode: countryCode,
          number: vatNumber
        }
      }
    );

    return {
      valid: res.data.valid,
      name: res.data.name,
      address: res.data.address,
      countryCode,
      vatNumber
    };
  } catch (e) {
    return {
      valid: false,
      name: null,
      address: null,
      error: "VIES unavailable"
    };
  }
}

/**
 * PDF generator
 */
function generatePDFBuffer(data) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    const id = `VIES-${data.countryCode}-${Date.now()}`;

    doc.fontSize(18).text("VAT Validation Certificate", { align: "center" });
    doc.moveDown();

    doc.fontSize(10).text(`Verification ID: ${id}`);
    doc.text(`Date: ${new Date().toISOString()}`);

    doc.moveDown();

    doc.fontSize(12).text(`VAT: ${data.countryCode}${data.vatNumber}`);
    doc.text(`Status: ${data.valid ? "VALID" : "INVALID"}`);
    doc.text(`Company: ${data.name || "-"}`);
    doc.text(`Address: ${data.address || "-"}`);

    doc.moveDown();

    doc.fontSize(10).text(
      "Validated via VIES (EU VAT Information Exchange System)."
    );

    doc.moveDown();

    doc.fontSize(12).text("Need help with EU VAT compliance?");
    doc.text("Book a consultation:");
    doc.fillColor("blue").text("https://twojadomena.pl/spotkanie");

    doc.end();
  });
}

/**
 * API: check
 */
app.get("/check", async (req, res) => {
  const { country, vat } = req.query;

  const data = await checkVAT(country, vat);
  res.json(data);
});

/**
 * API: PDF download
 */
app.get("/pdf", async (req, res) => {
  const { country, vat } = req.query;

  const data = await checkVAT(country, vat);
  const pdf = await generatePDFBuffer(data);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=vies.pdf");

  res.send(pdf);
});

/**
 * EMAIL SEND
 */
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS
  }
});

app.post("/send-email", async (req, res) => {
  const { email, country, vat, newsletter } = req.body;

  const data = await checkVAT(country, vat);
  const pdf = await generatePDFBuffer(data);

  await transporter.sendMail({
    from: "VIES Checker <no-reply@vies-checker.com>",
    to: email,
    subject: "VAT Validation PDF",
    text: "Attached VAT validation report.",
    attachments: [
      {
        filename: "vies.pdf",
        content: pdf
      }
    ]
  });

  if (newsletter) {
    console.log("NEWSLETTER ADD:", email);
  }

  res.json({ success: true });
});

app.listen(PORT, () => {
  console.log(`Server running on ${PORT}`);
});