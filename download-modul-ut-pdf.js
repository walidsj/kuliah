(async function () {
  await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");

  const { jsPDF } = window.jspdf;

  const params = new URLSearchParams(window.location.search);

  let doc = params.get("doc");
  let subfolder = params.get("subfolder");

  let pdfFileName = prompt("Masukkan nama file PDF (tanpa ekstensi, default: " + subfolder + "-" + doc + "):") || generateFileName(subfolder, doc);

  let i = parseInt(prompt("Masukkan nomor halaman awal (default 1):") || "1");
  let cancelled = false;
  const abortController = new AbortController();

  const cancelDownload = () => {
    cancelled = true;
    abortController.abort();
  };

  window.addEventListener("beforeunload", cancelDownload, { once: true });
  window.addEventListener("pagehide", cancelDownload, { once: true });

 
  function generateUri(docName, subfolderName, pageNumber) {
    if (!docName || !subfolderName) {
      throw new Error("Missing doc or subfolder parameter");
    }

    let sf = subfolderName.replace(/\/$/, "");
    sf = sf.replace(/\.[^/.]+$/, "");

    let d = docName.replace(/\.[^/.]+$/, "");

    return `https://pustaka.ut.ac.id/reader/services/view.php?doc=${d}&format=jpg&subfolder=${sf}/&page=${pageNumber}`;
  }

  function generateFileName(subfolderName, docName) {
    let sf = subfolderName.replace(/\/$/, "");
    sf = sf.replace(/\.[^/.]+$/, "");

    let d = docName.replace(/\.[^/.]+$/, "");

    return `${sf}-${d}`;
  }


  function blobToDataURL(blob) {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  }

  function loadImage(src) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = src;
    });
  }

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "px",
    format: "a4",
  });

  let firstPage = true;

  while (true) {
    try {
      const url = generateUri(doc, subfolder, i);
      const res = await fetch(url, { signal: abortController.signal });
      const blob = await res.blob();

      if (!blob.type.startsWith("image") || blob.size < 5000) {
        break;
      }

      const dataUrl = await blobToDataURL(blob);
      const img = await loadImage(dataUrl);

      if (img.width < 200 || img.height < 200) {
        break;
      }

      const pageWidth = pdf.internal.pageSize.getWidth();
      const pageHeight = pdf.internal.pageSize.getHeight();

      const ratio = Math.min(pageWidth / img.width, pageHeight / img.height);
      const width = img.width * ratio;
      const height = img.height * ratio;

      const x = (pageWidth - width) / 2;
      const y = (pageHeight - height) / 2;

      if (!firstPage) {
        pdf.addPage();
      }

      pdf.addImage(dataUrl, "JPEG", x, y, width, height);

      console.log("Added page", i);

      firstPage = false;
      i++;

      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * 100 + 500) // delay antara 500ms hingga 600ms
      );
    } catch (err) {
      if (cancelled || err.name === "AbortError") {
        alert("Download dibatalkan sebelum selesai.");
        return "Download cancelled";
      }

      alert(`Gagal memproses halaman ${i}. ${err?.message || err}`);
      break;
    }
  }

  if (cancelled || abortController.signal.aborted) {
    alert("PDF tidak disimpan karena proses dibatalkan.");
    return "Download cancelled";
  }

  const filename = `${pdfFileName}`.replace(/[\/\\:*?"<>|]/g, "-");

  pdf.save(filename);

  console.log("PDF selesai:", filename);

  return "PDF generated";
})();