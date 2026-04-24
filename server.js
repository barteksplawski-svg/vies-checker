import express from "express";
import cors from "cors";
import axios from "axios";
import PDFDocument from "pdfkit";
import { Resend } from "resend";
import dotenv from "dotenv";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 10000;

/* -------------------------
   EMAIL (RESEND)
--------------------------*/
const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

/* -------------------------
   ROOT
--------------------------*/
app.get("/", (req, res) => {
  res.json({
    service: "VIES Checker API",
    status: "live",
    endpoints: [
      "/check?country=PL&vat=1234567890",
      "/pdf?country=PL&vat=1234567890",
      "/send-email"
    ]
  });
});

/* -------------------------
   VIES CHECK (FIXED)
--------------------------*/
async function checkVAT(countryCode, vatNumber) {
  try {
    const res = await axios.get(
      "https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number",
      {
        params: {
          memberStateCode: countryCode,
          number: vatNumber
        },
        timeout: 8000
      }
    );

    return {
      valid: res.data.valid,
      name: res.data.name,
      address: res.data.address,
      countryCode,
      vatNumber
    };

  } catch (err) {
    console.log("VIES ERROR:", err.message);

    return {
      valid: null,
      error: "VIES temporary unavailable",
      retry: true
    };
  }
}

/* -------------------------
   PDF
--------------------------*/
function generatePDF(data) {
  return new Promise((resolve) => {
    const doc = new PDFDocument({ margin: 40 });
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    doc.fontSize(18).text("VAT VALIDATION REPORT", { align: "center" });
    doc.moveDown();

    doc.fontSize(12).text(`VAT: ${data.countryCode}${data.vatNumber}`);
    doc.text(`STATUS: ${data.valid === null ? "UNKNOWN" : data.valid ? "VALID" : "INVALID"}`);
    doc.text(`NAME: ${data.name || "-"}`);
    doc.text(`ADDRESS: ${data.address || "-"}`);
    doc.text(`NOTE: ${data.error || "OK"}`);

    doc.end();
  });
}

/* -------------------------
   CHECK
--------------------------*/
app.get("/check", async (req, res) => {
  const { country, vat } = req.query;

  if (!country || !vat) {
    return res.status(400).json({ error: "Missing params" });
  }

  const data = await checkVAT(country, vat);
  res.json(data);
});

/* -------------------------
   PDF
--------------------------*/
app.get("/pdf", async (req, res) => {
  const { country, vat } = req.query;

  if (!country || !vat) {
    return res.status(400).send("Missing params");
  }

  const data = await checkVAT(country, vat);
  const pdf = await generatePDF(data);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", "attachment; filename=vies.pdf");
  res.send(pdf);
});

/* -------------------------
   EMAIL
--------------------------*/
app.post("/send-email", async (req, res) => {
  try {
    if (!resend) {
      return res.status(500).json({ error: "Missing RESEND_API_KEY" });
    }

    const { email, country, vat, newsletter } = req.body;

    if (!email || !country || !vat) {
      return res.status(400).json({ error: "Missing data" });
    }

    const data = await checkVAT(country, vat);
    const pdf = await generatePDF(data);

    await resend.emails.send({
      from: "VIES Checker <onboarding@resend.dev>",
      to: email,
      subject: "VAT Validation Report",
      html: `
        <h2>VAT Report</h2>
        <p><b>VAT:</b> ${country}${vat}</p>
        <p><b>Status:</b> ${data.valid === null ? "UNKNOWN" : data.valid ? "VALID" : "INVALID"}</p>
      `,
      attachments: [
        {
          filename: "vies.pdf",
          content: pdf.toString("base64")
        }
      ]
    });

    if (newsletter) {
      console.log("NEWSLETTER OPT-IN:", email);
    }

    res.json({ success: true });

  } catch (err) {
    console.log(err);
    res.status(500).json({ error: "Email failed" });
  }
});

/* -------------------------
   START
--------------------------*/
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});
