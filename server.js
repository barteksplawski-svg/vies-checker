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
   RESEND (EMAIL API)
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
   VIES CHECK
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
    return {
      valid: null,
      error: "VIES system unavailable"
    };
  }
}

/* -------------------------
   PDF GENERATOR
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
    doc.text(`STATUS: ${data.valid ? "VALID" : "INVALID"}`);
    doc.text(`NAME: ${data.name || "-"}`);
    doc.text(`ADDRESS: ${data.address || "-"}`);

    doc.end();
  });
}

/* -------------------------
   CHECK ENDPOINT
--------------------------*/
app.get("/check", async (req, res) => {
  const { country, vat } = req.query;

  if (!country || !vat) {
    return res.status(400).json({ error: "Missing country or vat" });
  }

  const data = await checkVAT(country, vat);
  res.json(data);
});

/* -------------------------
   PDF ENDPOINT
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
   EMAIL (RESEND)
--------------------------*/
app.post("/send-email", async (req, res) => {
  try {
    if (!resend) {
      return res.status(500).json({
        error: "Email not configured (missing RESEND_API_KEY)"
      });
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
        <h2>VAT Validation Report</h2>
        <p><b>VAT:</b> ${country}${vat}</p>
        <p><b>Status:</b> ${data.valid ? "VALID" : "INVALID"}</p>
        <p><b>Company:</b> ${data.name || "-"}</p>
      `,
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

  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Email sending failed" });
  }
});

/* -------------------------
   START SERVER
--------------------------*/
app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on port " + PORT);
});
