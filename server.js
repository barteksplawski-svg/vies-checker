import express from "express";
import fetch from "node-fetch";
import PDFDocument from "pdfkit";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "frontend")));

// ── Health check ─────────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ status: "ok" }));

// ── VIES proxy ────────────────────────────────────────────────────────────────
app.get("/check", async (req, res) => {
  const { country, vat } = req.query;

  if (!country || !vat) {
    return res.status(400).json({ error: "Brak parametrów: country i vat są wymagane." });
  }

  try {
    const url = `https://ec.europa.eu/taxation_customs/vies/rest-api/ms/${encodeURIComponent(country)}/vat/${encodeURIComponent(vat)}`;
    const response = await fetch(url);
    const data = await response.json();

    // Log bez danych osobowych — wyłącznie do celów operacyjnych
    console.log(JSON.stringify({
      event: "vies_check",
      timestamp: new Date().toISOString(),
      country,
      vat,
      valid: data.valid ?? null,
    }));

    return res.json(data);
  } catch (err) {
    console.error("VIES fetch error:", err.message);
    return res.status(502).json({ error: "Błąd połączenia z VIES API." });
  }
});

// ── PDF generator ─────────────────────────────────────────────────────────────
app.post("/pdf", (req, res) => {
  const report = req.body;

  if (!report || !report.vat) {
    return res.status(400).json({ error: "Brak danych raportu." });
  }

  // Log bez danych osobowych
  console.log(JSON.stringify({
    event: "pdf_generated",
    timestamp: new Date().toISOString(),
    country: report.country,
    vat: report.vat,
    valid: report.valid ?? null,
  }));

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="VIES_${report.country}_${report.vat}.pdf"`
  );

  const doc = new PDFDocument({ margin: 50, size: "A4" });
  doc.pipe(res);

  const fontDir = path.join(__dirname, "fonts");

  const fontBold = (size) => {
    try { doc.font(path.join(fontDir, "DejaVuSans-Bold.ttf")); }
    catch { doc.font("Helvetica-Bold"); }
    doc.fontSize(size);
  };

  const fontRegular = (size) => {
    try { doc.font(path.join(fontDir, "DejaVuSans.ttf")); }
    catch { doc.font("Helvetica"); }
    doc.fontSize(size);
  };

  const divider = () => {
    doc.moveDown(0.8)
      .moveTo(50, doc.y)
      .lineTo(545, doc.y)
      .strokeColor("#dddddd")
      .lineWidth(0.5)
      .stroke();
    doc.moveDown(0.8);
  };

  // ── Nagłówek ────────────────────────────────────────────────────────────────
  fontBold(20);
  doc.fillColor("#1a3a6b").text("Raport weryfikacji VAT UE", { align: "center" });
  doc.moveDown(0.2);
  fontRegular(10);
  doc.fillColor("#555555").text("System VIES — Komisja Europejska", { align: "center" });
  doc.moveDown(0.2);
  fontRegular(9);
  doc.fillColor("#888888").text(
    `Wygenerowano: ${new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })}`,
    { align: "center" }
  );

  divider();

  // ── Wynik weryfikacji ───────────────────────────────────────────────────────
  fontBold(12);
  doc.fillColor("#1a3a6b").text("Wynik weryfikacji");
  doc.moveDown(0.5);

  const statusColor = report.valid ? "#1a7a1a" : "#cc0000";
  const statusLabel = report.valid ? "✓  Aktywny" : "✗  Nieaktywny lub niedostępny";

  const rows = [
    ["Status podatnika VAT UE", statusLabel, statusColor],
    ["Kraj",                    report.country   || "—", "#111111"],
    ["Numer VAT",               report.vat       || "—", "#111111"],
    ["Nazwa",                   report.name      || "—", "#111111"],
    ["Adres",                   report.address   || "—", "#111111"],
    ["Data weryfikacji VIES",   report.requestDate
                                  ? new Date(report.requestDate).toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" })
                                  : new Date().toLocaleString("pl-PL", { timeZone: "Europe/Warsaw" }),
                                "#111111"],
  ];

  for (const [label, value, color] of rows) {
    const y = doc.y;
    fontRegular(9);
    doc.fillColor("#777777").text(label, 50, y, { width: 170 });
    fontRegular(9);
    doc.fillColor(color).text(value, 230, y, { width: 315 });
    doc.moveDown(0.5);
  }

  if (report.error) {
    doc.moveDown(0.3);
    fontRegular(9);
    doc.fillColor("#cc0000").text(`Komunikat VIES: ${report.error}`);
  }

  divider();

  // ── Sekcja Eurofiscalis ─────────────────────────────────────────────────────
  fontBold(12);
  doc.fillColor("#1a3a6b").text("Skorzystaj z pomocy ekspertów Eurofiscalis");
  doc.moveDown(0.5);

  fontRegular(10);
  doc.fillColor("#222222").text(
    "Zadbaj o bezpieczeństwo swojego biznesu już dziś. Skorzystaj z bezpłatnej konsultacji " +
    "na podstawowe tematy w zakresie rozliczenia e-commerce na terenie Polski.",
    { lineGap: 3 }
  );

  doc.moveDown(0.6);

  fontRegular(10);
  doc.fillColor("#1a5fa8").text(
    "Umów bezpłatną konsultację → https://www.eurofiscalis.com/pl/kontakt/",
    { link: "https://www.eurofiscalis.com/pl/kontakt/", underline: true }
  );

  divider();

  // ── Stopka prawna ───────────────────────────────────────────────────────────
  fontRegular(7.5);
  doc.fillColor("#999999").text(
    "Niniejszy raport został wygenerowany automatycznie na podstawie danych pobranych w czasie rzeczywistym " +
    "z systemu VIES Komisji Europejskiej. Dokument ma charakter wyłącznie informacyjny i nie stanowi " +
    "poświadczenia urzędowego ani decyzji administracyjnej. Dane podatnika (nazwa, adres) są danymi publicznie " +
    "dostępnymi w rejestrze VIES i przetwarzanymi wyłącznie w celu weryfikacji statusu VAT UE, " +
    "na podstawie art. 6 ust. 1 lit. c) RODO (obowiązek prawny) oraz art. 6 ust. 1 lit. f) RODO " +
    "(uzasadniony interes weryfikującego). Narzędzie nie przechowuje danych osobowych użytkowników.",
    { lineGap: 2, align: "justify" }
  );

  doc.end();
});

// ── Start ─────────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(JSON.stringify({
    event: "server_start",
    timestamp: new Date().toISOString(),
    port: PORT,
  }));
});
