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

app.get("/", (req, res) => {
  res.json({ status: "ok", service: "VIES Checker" });
});

async function checkVAT(country, vat) {
  try {
    const r = await fetch(
      `https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number?memberStateCode=${country}&number=${vat}`
    );
    return await r.json();
  } catch {
    return { valid: false, error: "VIES unavailable" };
  }
}

function generatePDF(data) {
  return new Promise((resolve) => {
    const doc = new PDFDocument();
    const buffers = [];

    doc.on("data", buffers.push.bind(buffers));
    doc.on("end", () => resolve(Buffer.concat(buffers)));

    doc.text("VAT REPORT");
    doc.text(JSON.stringify(data, null, 2));

    doc.end();
  });
}

app.get("/check", async (req, res) => {
  const data = await checkVAT(req.query.country, req.query.vat);
  res.json(data);
});

app.get("/pdf", async (req, res) => {
  const data = await checkVAT(req.query.country, req.query.vat);
  const pdf = await generatePDF(data);

  res.setHeader("Content-Type", "application/pdf");
  res.send(pdf);
});

const resend = new Resend(process.env.RESEND_API_KEY);

app.post("/send-email", async (req, res) => {
  const { email, country, vat } = req.body;

  if (!email) return res.status(400).json({ error: "missing email" });

  const data = await checkVAT(country, vat);
  const pdf = await generatePDF(data);

  try {
    await resend.emails.send({
      from: "onboarding@resend.dev",
      to: email,
      subject: "VAT Report",
      text: "Attached report",
      attachments: [
        { filename: "report.pdf", content: pdf }
      ]
    });

    res.json({ ok: true });
  } catch {
    res.status(500).json({ error: "email failed" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log("Server running on " + PORT);
});
