(async function () {
  await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");

  const { jsPDF } = window.jspdf;

  const params = new URLSearchParams(window.location.search);

  let doc = params.get("doc");
  let subfolder = params.get("subfolder");

  function generateFileName(subfolderName, docName) {
    let sf = (subfolderName || "").replace(/\/$/, "");
    sf = sf.replace(/\.[^/.]+$/, "");

    let d = (docName || "").replace(/\.[^/.]+$/, "");

    return `${sf}-${d}`;
  }

  function generateUri(docName, subfolderName, pageNumber) {
    if (!docName || !subfolderName) {
      throw new Error("Missing doc or subfolder parameter");
    }

    let sf = subfolderName.replace(/\/$/, "");
    sf = sf.replace(/\.[^/.]+$/, "");

    let d = docName.replace(/\.[^/.]+$/, "");

    return `https://pustaka.ut.ac.id/reader/services/view.php?doc=${d}&format=jpg&subfolder=${sf}/&page=${pageNumber}`;
  }

  let pdfFileName = prompt("Masukkan nama file PDF (tanpa ekstensi, default: " + generateFileName(subfolder, doc) + "):") || generateFileName(subfolder, doc);
  let startPage = parseInt(prompt("Masukkan nomor halaman awal (default 1):") || "1");

  let cancelled = false;
  const abortController = new AbortController();

  const cancelDownload = () => {
    cancelled = true;
    abortController.abort();
  };

  window.addEventListener("beforeunload", cancelDownload, { once: true });
  window.addEventListener("pagehide", cancelDownload, { once: true });

  const pdf = new jsPDF({
    orientation: "portrait",
    unit: "px",
    format: "a4",
  });

  let firstPage = true;

  // Worker-pool concurrency so logs appear as each page completes
  const CONCURRENCY = 6;
  let nextPage = startPage;
  let finished = false;
  const images = []; // collected {p, dataUrl, width, height}

  console.log(`Start download from page ${startPage} with concurrency=${CONCURRENCY}`);

  // --- Floating console UI ---
  // Ensure document.body exists before creating/appending the UI
  if (!document.body) {
    await new Promise((resolve) => {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", resolve, { once: true });
      } else {
        resolve();
      }
    });
  }

  const ui = document.createElement("div");
  ui.id = "rmv-download-console";
  ui.style.position = "fixed";
  ui.style.right = "12px";
  ui.style.top = "12px";
  ui.style.width = "300px";
  ui.style.background = "rgba(0,0,0,0.8)";
  ui.style.color = "#fff";
  ui.style.padding = "10px";
  ui.style.fontFamily = "Arial, sans-serif";
  ui.style.fontSize = "13px";
  ui.style.borderRadius = "8px";
  ui.style.zIndex = 999999;
  ui.style.boxShadow = "0 6px 18px rgba(0,0,0,0.3)";
  ui.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
      <strong id="rmv-status">Starting...</strong>
      <button id="rmv-cancel" style="background:#c0392b;border:none;color:#fff;padding:4px 8px;border-radius:4px;cursor:pointer">Cancel</button>
    </div>
    <div style="margin-bottom:6px;">Fetched: <span id="rmv-fetched">0</span></div>
    <div style="margin-bottom:6px;">Last page: <span id="rmv-last">-</span></div>
    <div style="height:8px;background:#333;border-radius:4px;overflow:hidden;margin-bottom:6px;"><div id="rmv-bar" style="height:100%;width:0%;background:#2ecc71"></div></div>
    <div style="font-size:11px;opacity:0.85">Workers: <span id="rmv-workers">${CONCURRENCY}</span></div>
  `;
  document.body.appendChild(ui);

  const elStatus = ui.querySelector('#rmv-status');
  const elFetched = ui.querySelector('#rmv-fetched');
  const elLast = ui.querySelector('#rmv-last');
  const elBar = ui.querySelector('#rmv-bar');
  const btnCancel = ui.querySelector('#rmv-cancel');

  btnCancel.addEventListener('click', () => {
    cancelDownload();
    elStatus.textContent = 'Cancelling...';
  });

  let fetchedCount = 0;

  function updateUI() {
    elFetched.textContent = String(fetchedCount);
    elLast.textContent = String(Math.max(startPage, nextPage - 1));
    // progress fraction = fetched / assigned (nextPage-startPage)
    const assigned = Math.max(1, nextPage - startPage);
    const frac = Math.min(1, fetchedCount / assigned);
    elBar.style.width = `${Math.round(frac * 100)}%`;
    elStatus.textContent = cancelled ? 'Cancelled' : (finished ? 'Completed' : 'Running');
  }

  updateUI();
  // --- end UI ---

  async function fetchAndProcess(p) {
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
  }

  const workers = Array.from({ length: CONCURRENCY }, () =>
    (async () => {
      while (!finished) {
        const p = nextPage++;
        try {
          const r = await fetchAndProcess(p);
          if (!r.valid) {
            finished = true;
            break;
          }
          images.push(r);
          fetchedCount++;
          console.log(`Fetched page ${r.p} (queued ${images.length})`);
          updateUI();
        } catch (err) {
          if (cancelled || err.name === "AbortError") {
            alert("Download dibatalkan sebelum selesai.");
            finished = true;
            break;
          }
          alert(`Gagal memproses halaman ${p}. ${err?.message || err}`);
          finished = true;
          break;
        }
      }
    })()
  );

  await Promise.all(workers);

  // mark finished and update UI
  finished = true;
  updateUI();
  btnCancel.disabled = true;

  if (cancelled || abortController.signal.aborted) {
    alert("PDF tidak disimpan karena proses dibatalkan.");
    return "Download cancelled";
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

  const filename = `${pdfFileName}`.replace(/[\/\\:*?"<>|]/g, "-");

  pdf.save(filename);

  console.log("PDF selesai:", filename);

  return "PDF generated";
})();
