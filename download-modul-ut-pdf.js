(async function () {
  await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");

  const { jsPDF } = window.jspdf;
  const params = new URLSearchParams(window.location.search);

  const doc = params.get("doc");
  const subfolder = params.get("subfolder");
  const defaultConcurrency = 10;

  const body = await waitForBody();
  let settings;
  try {
    settings = await askForDownloadSettings(body, {
      defaultFileName: buildDefaultFileName(subfolder, doc),
      defaultStartPage: 1,
      defaultConcurrency,
    });
  } catch {
    return "Pengaturan unduhan dibatalkan";
  }

  const download = createDownloadState();
  const pdf = new jsPDF({ orientation: "portrait", unit: "px", format: "a4" });
  const ui = createStatusPanel(body, settings.concurrency);

  console.log(`Mulai unduh dari halaman ${settings.startPage} dengan concurrency=${settings.concurrency}`);

  window.addEventListener("beforeunload", download.cancel, { once: true });
  window.addEventListener("pagehide", download.cancel, { once: true });

  const lastPage = await detectLastPage(settings.startPage, download.signal);
  ui.setProbingComplete(lastPage);

  const pages = await fetchPagesToPdf({
    startPage: settings.startPage,
    lastPage,
    concurrency: settings.concurrency,
    download,
    ui,
  });

  if (download.cancelled || download.signal.aborted) {
    ui.setCancelled();
    alert("PDF tidak disimpan karena proses dibatalkan.");
    return "Unduhan dibatalkan";
  }

  await buildPdfFromPages(pdf, pages);
  ui.setDone(pages.length);

  const filename = sanitizeFilename(settings.pdfFileName);
  pdf.save(filename);
  console.log("PDF selesai:", filename);

  return "PDF selesai dibuat";

  function buildDefaultFileName(subfolderName, docName) {
    const folder = sanitizeName(subfolderName);
    const documentName = sanitizeName(docName);
    return `${folder}-${documentName}`;
  }

  function sanitizeName(value) {
    return (value || "").replace(/\/$/, "").replace(/\.[^/.]+$/, "");
  }

  function sanitizeFilename(value) {
    return `${value}`.replace(/[\/\\:*?"<>|]/g, "-");
  }

  function askForDownloadSettings(root, defaults) {
    return new Promise((resolve, reject) => {
      const overlay = document.createElement("div");
      overlay.style.position = "fixed";
      overlay.style.inset = "0";
      overlay.style.background = "rgba(0,0,0,0.72)";
      overlay.style.display = "flex";
      overlay.style.alignItems = "center";
      overlay.style.justifyContent = "center";
      overlay.style.zIndex = "1000000";
      overlay.style.padding = "16px";

      const modal = document.createElement("div");
      modal.style.width = "100%";
      modal.style.maxWidth = "420px";
      modal.style.background = "#111827";
      modal.style.color = "#fff";
      modal.style.border = "1px solid rgba(255,255,255,0.08)";
      modal.style.borderRadius = "16px";
      modal.style.boxShadow = "0 24px 80px rgba(0,0,0,0.45)";
      modal.style.padding = "20px";
      modal.innerHTML = `
        <div style="margin-bottom:16px;">
          <div style="font-size:18px;font-weight:700;margin-bottom:6px;">Pengaturan unduhan</div>
          <div style="font-size:13px;opacity:0.8;line-height:1.5;">Isi nama file, halaman awal, dan jumlah worker sebelum proses dimulai.</div>
        </div>
        <form id="rmv-settings-form" style="display:grid;gap:12px;">
          <label style="display:grid;gap:6px;font-size:13px;">
            <span>Nama file PDF</span>
            <input name="pdfFileName" type="text" value="${escapeHtml(defaults.defaultFileName)}" autocomplete="off" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:#0b1220;color:#fff;outline:none;" />
          </label>
          <label style="display:grid;gap:6px;font-size:13px;">
            <span>Halaman awal</span>
            <input name="startPage" type="number" min="1" value="${defaults.defaultStartPage}" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:#0b1220;color:#fff;outline:none;" />
          </label>
          <label style="display:grid;gap:6px;font-size:13px;">
            <span>Worker</span>
            <input name="concurrency" type="number" min="1" max="50" value="${defaults.defaultConcurrency}" style="width:100%;padding:10px 12px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:#0b1220;color:#fff;outline:none;" />
          </label>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:4px;">
            <button type="button" id="rmv-settings-cancel" style="padding:10px 14px;border-radius:10px;border:1px solid rgba(255,255,255,0.12);background:transparent;color:#fff;cursor:pointer;">Batal</button>
            <button type="submit" style="padding:10px 14px;border-radius:10px;border:none;background:#22c55e;color:#07130b;font-weight:700;cursor:pointer;">Mulai</button>
          </div>
        </form>
      `;

      const form = modal.querySelector("#rmv-settings-form");
      const cancelButton = modal.querySelector("#rmv-settings-cancel");

      const cleanup = () => {
        overlay.remove();
      };

      cancelButton.addEventListener("click", () => {
        cleanup();
        reject(new Error("Pengguna membatalkan pengaturan."));
      });

      form.addEventListener("submit", (event) => {
        event.preventDefault();

        const formData = new FormData(form);
        const pdfFileName = String(formData.get("pdfFileName") || defaults.defaultFileName).trim() || defaults.defaultFileName;
        const startPage = Math.max(1, parseInt(String(formData.get("startPage") || defaults.defaultStartPage), 10) || defaults.defaultStartPage);
        const concurrency = Math.max(1, parseInt(String(formData.get("concurrency") || defaults.defaultConcurrency), 10) || defaults.defaultConcurrency);

        cleanup();
        resolve({ pdfFileName, startPage, concurrency });
      });

      overlay.appendChild(modal);
      root.appendChild(overlay);

      const firstInput = modal.querySelector('input[name="pdfFileName"]');
      firstInput?.focus();
      firstInput?.select();
    });
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/\"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function buildPageUrl(pageNumber) {
    if (!doc || !subfolder) {
      throw new Error("Parameter doc atau subfolder tidak ada.");
    }

    const folder = sanitizeName(subfolder);
    const documentName = sanitizeName(doc);

    return `https://pustaka.ut.ac.id/reader/services/view.php?doc=${documentName}&format=jpg&subfolder=${folder}/&page=${pageNumber}`;
  }

  function createDownloadState() {
    const controller = new AbortController();

    return {
      cancelled: false,
      signal: controller.signal,
      cancel() {
        this.cancelled = true;
        controller.abort();
      },
    };
  }

  function waitForBody() {
    if (document.body) {
      return Promise.resolve(document.body);
    }

    return new Promise((resolve) => {
      if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", () => resolve(document.body), { once: true });
      } else {
        resolve(document.body);
      }
    });
  }

  function createStatusPanel(root, concurrency) {
    const style = document.createElement("style");
    style.textContent = `
      @keyframes rmv-spin { to { transform: rotate(360deg); } }
      @keyframes rmv-pulse { 0%, 100% { opacity: 0.45; } 50% { opacity: 1; } }
      #rmv-download-console { position: fixed; right: 12px; top: 12px; width: 300px; padding: 10px; border-radius: 8px; z-index: 999999; color: #fff; font-family: Arial, sans-serif; font-size: 13px; background: rgba(0,0,0,0.8); box-shadow: 0 6px 18px rgba(0,0,0,0.3); }
      #rmv-download-console .rmv-processing-details,
      #rmv-download-console .rmv-complete-details { display: none; }
      #rmv-download-console[data-mode="processing"] .rmv-processing-details { display: block; }
      #rmv-download-console[data-mode="done"] .rmv-complete-details { display: block; }
      #rmv-download-console[data-mode="probing"] .rmv-status-line { animation: rmv-pulse 1.1s ease-in-out infinite; }
      #rmv-download-console[data-mode="probing"] .rmv-spinner { animation: rmv-spin 0.8s linear infinite; }
      #rmv-download-console[data-mode="done"] { background: linear-gradient(135deg, #0f7a3a 0%, #19a34a 100%) !important; box-shadow: 0 8px 24px rgba(25,163,74,0.35) !important; }
      #rmv-download-console[data-mode="done"] .rmv-bar { background: #d7ffe3 !important; }
      #rmv-download-console[data-mode="probing"] .rmv-bar,
      #rmv-download-console[data-mode="processing"] .rmv-bar { background: #2ecc71 !important; }
    `;
    root.appendChild(style);

    const panel = document.createElement("div");
    panel.id = "rmv-download-console";
    panel.dataset.mode = "probing";
    panel.innerHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <strong id="rmv-status" class="rmv-status-line">Memuat...</strong>
        <span id="rmv-spinner" class="rmv-spinner" style="width:14px;height:14px;border-radius:50%;border:2px solid rgba(255,255,255,0.32);border-top-color:#fff;display:inline-block;"></span>
      </div>
      <div id="rmv-processing-details" class="rmv-processing-details">
        <div style="margin-bottom:6px;">Diproses: <span id="rmv-fetched">0</span></div>
        <div style="margin-bottom:6px;">Halaman terakhir: <span id="rmv-last">-</span></div>
        <div style="height:8px;background:#333;border-radius:4px;overflow:hidden;margin-bottom:6px;"><div id="rmv-bar" class="rmv-bar" style="height:100%;width:0%;background:#2ecc71"></div></div>
        <div style="font-size:11px;opacity:0.85">Worker: <span id="rmv-workers">${concurrency}</span></div>
      </div>
      <div id="rmv-complete-details" class="rmv-complete-details" style="font-size:15px;font-weight:700;letter-spacing:0.2px;">
        Total halaman: <span id="rmv-pages-done">0</span>
      </div>
    `;
    root.appendChild(panel);

    const elements = {
      status: panel.querySelector("#rmv-status"),
      spinner: panel.querySelector("#rmv-spinner"),
      fetched: panel.querySelector("#rmv-fetched"),
      last: panel.querySelector("#rmv-last"),
      bar: panel.querySelector("#rmv-bar"),
      pagesDone: panel.querySelector("#rmv-pages-done"),
    };

    const ui = {
      setProbing() {
        panel.dataset.mode = "probing";
        elements.status.textContent = "Memuat...";
        elements.spinner.style.display = "inline-block";
      },
      setProcessing(progress, fetchedPages, lastKnownPage) {
        panel.dataset.mode = "processing";
        elements.spinner.style.display = "none";
        elements.status.textContent = "Memproses";
        elements.fetched.textContent = String(fetchedPages);
        elements.last.textContent = String(lastKnownPage);
        elements.bar.style.width = `${Math.round(progress * 100)}%`;
      },
      setProbingComplete(lastKnownPage) {
        panel.dataset.mode = "processing";
        elements.spinner.style.display = "none";
        elements.status.textContent = "Memproses";
        elements.last.textContent = String(lastKnownPage);
      },
      setCancelled() {
        panel.dataset.mode = "idle";
        panel.style.background = "rgba(0,0,0,0.8)";
        panel.style.boxShadow = "0 6px 18px rgba(0,0,0,0.3)";
        elements.spinner.style.display = "none";
        elements.status.textContent = "Dibatalkan";
      },
      setDone(totalPages) {
        panel.dataset.mode = "done";
        elements.spinner.style.display = "none";
        elements.status.textContent = "Selesai";
        elements.pagesDone.textContent = String(totalPages);
      },
    };

    ui.setProbing();
    return ui;
  }

  async function detectLastPage(startPage, signal) {
    if (!(await probePage(startPage, signal))) {
      return startPage - 1;
    }

    let lower = startPage;
    let upper = startPage + 1;

    while (await probePage(upper, signal)) {
      lower = upper;
      upper *= 2;

      if (upper > startPage + 10000) {
        upper = startPage + 10000;
        break;
      }
    }

    while (lower + 1 < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (await probePage(middle, signal)) {
        lower = middle;
      } else {
        upper = middle;
      }
    }

    return lower;
  }

  async function probePage(pageNumber, signal) {
    try {
      const result = await fetch(buildPageUrl(pageNumber), { signal });
      const blob = await result.blob();
      if (!isUsefulImage(blob)) {
        return false;
      }

      const bitmap = await createImageBitmap(blob);
      return bitmap.width >= 200 && bitmap.height >= 200;
    } catch {
      return false;
    }
  }

  async function fetchPagesToPdf({ startPage, lastPage, concurrency, download, ui }) {
    const images = [];
    let nextPage = startPage;
    let reachedEnd = false;

    const workerCount = Math.max(1, concurrency);
    const workers = Array.from({ length: workerCount }, () => runWorker());

    await Promise.all(workers);
    return images;

    async function runWorker() {
      try {
        while (!reachedEnd && !download.cancelled && !download.signal.aborted) {
          const pageNumber = nextPage++;

          if (lastPage !== null && pageNumber > lastPage) {
            reachedEnd = true;
            break;
          }

          const image = await fetchPageImage(pageNumber, download.signal);

          if (!image) {
            reachedEnd = true;
            break;
          }

          images.push(image);
          ui.setProcessing(buildProgress(images.length, startPage, lastPage, nextPage), images.length, lastPage ?? pageNumber);
          console.log(`Halaman ${pageNumber} diambil.`);
        }
      } catch (error) {
        if (download.cancelled || error?.name === "AbortError") {
          return;
        }

        reachedEnd = true;
        alert(`Gagal memproses halaman ${nextPage - 1}. ${error?.message || error}`);
      }
    }
  }

  function buildProgress(fetchedPages, startPage, lastPage, nextPage) {
    const totalPages = lastPage !== null ? Math.max(1, lastPage - startPage + 1) : Math.max(1, nextPage - startPage);
    return Math.min(1, fetchedPages / totalPages);
  }

  async function fetchPageImage(pageNumber, signal) {
    const response = await fetch(buildPageUrl(pageNumber), { signal });
    const blob = await response.blob();

    if (!isUsefulImage(blob)) {
      return null;
    }

    const bitmap = await createImageBitmap(blob);
    if (bitmap.width < 200 || bitmap.height < 200) {
      return null;
    }

    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;

    const context = canvas.getContext("2d");
    context.drawImage(bitmap, 0, 0);

    return {
      pageNumber,
      width: bitmap.width,
      height: bitmap.height,
      dataUrl: canvas.toDataURL("image/jpeg", 0.92),
    };
  }

  async function buildPdfFromPages(pdf, pages) {
    const orderedPages = [...pages].sort((a, b) => a.pageNumber - b.pageNumber);

    orderedPages.forEach((page, index) => {
      addImageToPdf(pdf, page, index > 0);
      console.log(`Menambahkan halaman ${page.pageNumber}`);
    });
  }

  function addImageToPdf(pdf, page, addNewPage) {
    const pageWidth = pdf.internal.pageSize.getWidth();
    const pageHeight = pdf.internal.pageSize.getHeight();
    const ratio = Math.min(pageWidth / page.width, pageHeight / page.height);
    const width = page.width * ratio;
    const height = page.height * ratio;
    const x = (pageWidth - width) / 2;
    const y = (pageHeight - height) / 2;

    if (addNewPage) {
      pdf.addPage();
    }

    pdf.addImage(page.dataUrl, "JPEG", x, y, width, height);
  }

  function isUsefulImage(blob) {
    return blob.type.startsWith("image") && blob.size >= 5000;
  }
})();
