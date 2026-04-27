import express from "express";
import cors from "cors";
import PDFDocument from "pdfkit";
import dotenv from "dotenv";
import { Resend } from "resend";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* ---------------- ROOT ---------------- */
app.get("/", (req, res) => {
  res.json({
    service: "VIES Checker API",
    status: "running"
  });
});

/* ---------------- VIES CHECK ---------------- */
async function checkVAT(countryCode, vatNumber) {
  try {
    const response = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number?memberStateCode=${countryCode}&number=${vatNumber}`
    );

    const data = await response.json();

    return {
      valid: data.valid,
      name: data.name,
      address: data.address,
      countryCode,
      vatNumber
    };
  } catch (err) {
    return {
      valid: false,
      error: "VIES unavailable"
    };
  }
}

/* ---------------- PDF ---------------- */
function generatePDF(data) {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    doc.fontSize(16).text("VAT VALIDATION REPORT");
    doc.moveDown();

    doc.text(`VAT: ${data.countryCode}${data.vatNumber}`);
    doc.text(`STATUS: ${data.valid ? "VALID" : "INVALID"}`);
    doc.text(`COMPANY: ${data.name || "-"}`);
    doc.text(`ADDRESS: ${data.address || "-"}`);

    doc.end();
  });
}

/* ---------------- API ---------------- */
app.get("/check", async (req, res) => {
  const { country, vat } = req.query;

  if (!country || !vat) {
    return res.status(400).json({ error: "Missing data" });
  }

  const data = await checkVAT(country, vat);
  res.json(data);
});

app.get("/pdf", async (req, res) => {
  const { country, vat } = req.query;

  const data = await checkVAT(country, vat);
  const pdf = await generatePDF(data);

  res.setHeader("Content-Type", "application/pdf");
  res.send(pdf);
});

/* ---------------- EMAIL ---------------- */
const resend = new Resend(process.env.RESEND_API_KEY);

app.post("/send-email", async (req, res) => {
  const { email, country, vat } = req.body;

  if (!email) {
    return res.status(400).json({ error: "Missing email" });
  }

  const data = await checkVAT(country, vat);
  const pdf = await generatePDF(data);

  try {
    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: email,
      subject: "VAT Report",
      text: "Your VAT report attached",
      attachments: [
        {
          filename: "report.pdf",
          content: pdf
        }
      ]
    });

    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: "Email failed" });
  }
});

/* ---------------- START ---------------- */
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on " + PORT);
});
