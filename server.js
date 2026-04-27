
    doc.moveDown();

    const lines = [
      `Status: ${report.valid ? "Valid" : "Invalid or unavailable"}`,
      `Country: ${report.country}`,
      `VAT: ${report.vat}`,
      `Name: ${report.name}`,
      `Address: ${report.address}`,
      `Checked at: ${report.requestDate}`
      `Status podatnika VAT EU: ${report.valid ? "Aktywny" : "Nieaktywny lub niedostepny"}`,
      `Kraj: ${report.country}`,
      `Numer VAT: ${report.vat}`,
      `Nazwa: ${report.name}`,
      `Adres: ${report.address}`,
      `Data weryfikacji z bazy VIES: ${report.requestDate}`
    ];

    if (report.error) {
      doc.moveDown(0.5);
    }

    doc.moveDown();
    doc.fontSize(14).text("Skorzystaj z pomocy ekspertow Eurofiscalis", {
      underline: true
    });
    doc.moveDown(0.5);
    doc.fontSize(11).text("Zadbaj o bezpieczenstwo swojego biznesu juz dzis.");
    doc.text("Skorzystaj z bezplatnej konsultacji na podstawowe tematy w zakresie rozliczenia e-commerce na terenie Polski.");
    doc.moveDown(0.5);
    doc.fillColor("blue").text("Umow bezplatna konsultacje: https://www.eurofiscalis.com/pl/kontakt/");
    doc.fillColor("black");

    doc.end();
  });
}
