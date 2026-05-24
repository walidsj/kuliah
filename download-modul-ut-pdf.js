(async function () {
  await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");

  const { jsPDF } = window.jspdf;

  const params = new URLSearchParams(window.location.search);

  let doc = params.get("doc");
  let subfolder = params.get("subfolder");

  let pdfFileName = prompt("Masukkan nama file PDF (tanpa ekstensi, default: " + generateFileName(subfolder, doc) + "):") || generateFileName(subfolder, doc);

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
  // Faster: fetch pages in batches (limited concurrency) and process with createImageBitmap
  const CONCURRENCY = 4;
  let pageCursor = i;
  const images = []; // {p, dataUrl, width, height}

  console.log(`Start download from page ${i} with concurrency=${CONCURRENCY}`);

  outer: while (true) {
    const batch = Array.from({ length: CONCURRENCY }, (_, k) => pageCursor + k);
    console.log(`Fetching pages ${batch[0]}..${batch[batch.length - 1]}`);

    const promises = batch.map(async (p) => {
      const url = generateUri(doc, subfolder, p);
      const res = await fetch(url, { signal: abortController.signal });
      const blob = await res.blob();

      if (!blob.type.startsWith("image") || blob.size < 5000) {
        console.log(`Page ${p} is not a valid image or too small.`);
        return { p, valid: false };
      }

      const bitmap = await createImageBitmap(blob);
      if (bitmap.width < 200 || bitmap.height < 200) {
        console.log(`Page ${p} image dimensions too small: ${bitmap.width}x${bitmap.height}`);
        return { p, valid: false };
      }

      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const dataUrl = canvas.toDataURL("image/jpeg", 0.92);

      return { p, valid: true, dataUrl, width: bitmap.width, height: bitmap.height };
    });

    let results;
    try {
      results = await Promise.all(promises);
    } catch (err) {
      if (cancelled || err.name === "AbortError") {
        alert("Download dibatalkan sebelum selesai.");
        return "Download cancelled";
      }

      alert(`Gagal memproses halaman ${pageCursor}. ${err?.message || err}`);
      break;
    }

    for (const r of results) {
      if (!r.valid) {
        console.log(`No more pages after ${r.p - 1}`);
        break outer; // stop when a page signals end
      }
      images.push(r);
      console.log(`Fetched page ${r.p} (queued ${images.length})`);
    }

    pageCursor += CONCURRENCY;
  }

  // Add images to PDF in order
  images.sort((a, b) => a.p - b.p);
  for (const img of images) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();

    const ratio = Math.min(pageWidth / img.width, pageHeight / img.height);
    const width = img.width * ratio;
    const height = img.height * ratio;

    const x = (pageWidth - width) / 2;
    const y = (pageHeight - height) / 2;

    if (!firstPage) pdf.addPage();
    pdf.addImage(img.dataUrl, "JPEG", x, y, width, height);
    console.log("Added page", img.p);
    firstPage = false;
  }

  if (cancelled || abortController.signal.aborted) {
    alert("PDF tidak disimpan karena proses dibatalkan.");
    return "Download cancelled";
  }
 

  pdf.save(pdfFileName);

  console.log("PDF selesai:", pdfFileName);

  return "PDF generated";
})();