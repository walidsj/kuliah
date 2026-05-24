(async function () {
  await import("https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js");

  const { jsPDF } = window.jspdf;
  const params = new URLSearchParams(window.location.search);

  const doc = params.get("doc");
  const subfolder = params.get("subfolder");
  const defaultConcurrency = 10;
  const defaultOrientation = "portrait";
  const defaultPaperSize = "a4";

  const body = await waitForBody();
  await ensureTailwindStylesheet();
  const detectedTotalPages = getTotalPagesFromFlowpaper(body);
  let settings;
  try {
    settings = await askForDownloadSettings(body, {
      defaultFileName: buildDefaultFileName(body, subfolder, doc),
      defaultStartPage: 1,
      defaultConcurrency,
      defaultOrientation,
      defaultPaperSize,
      defaultTotalPages: detectedTotalPages,
    });
  } catch {
    return "Pengaturan unduhan dibatalkan";
  }

  const download = createDownloadState();
  const pdf = new jsPDF({
    orientation: settings.orientation,
    unit: "px",
    format: settings.paperSize,
  });
  const ui = createStatusPanel(body, settings.concurrency);

  console.log(`Mulai unduh dari halaman ${settings.startPage} dengan concurrency=${settings.concurrency}`);

  window.addEventListener("beforeunload", download.cancel, { once: true });
  window.addEventListener("pagehide", download.cancel, { once: true });

  const lastPage = settings.totalPages !== null
    ? settings.totalPages
    : await detectLastPage(settings.startPage, download.signal, ui);
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

  function buildDefaultFileName(root, subfolderName, docName) {
    const pageTitle = getNavTitle(root);

    if (pageTitle) {
      return sanitizeName(pageTitle);
    }

    const folder = sanitizeName(subfolderName);
    const documentName = sanitizeName(docName);
    return `${folder}-${documentName}`;
  }

  function getNavTitle(root) {
    const navTitle = root.querySelector(".nav-title");
    return navTitle?.getAttribute("title")?.trim() || "";
  }

  function sanitizeName(value) {
    return (value || "").replace(/\/$/, "").replace(/\.[^/.]+$/, "");
  }

  function sanitizeFilename(value) {
    return `${value}`.replace(/[\/\\:*?"<>|]/g, "-");
  }

  function ensureTailwindStylesheet() {
    if (document.getElementById("rmv-tailwind-css")) {
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      const link = document.createElement("link");
      link.id = "rmv-tailwind-css";
      link.rel = "stylesheet";
      link.href = "https://cdnjs.cloudflare.com/ajax/libs/tailwindcss/2.2.19/tailwind.min.css";
      link.referrerPolicy = "no-referrer";
      link.onload = () => resolve();
      link.onerror = () => resolve();
      document.head.appendChild(link);
      window.setTimeout(resolve, 1500);
    });
  }

  function askForDownloadSettings(root, defaults) {
    return new Promise((resolve, reject) => {
      const overlay = document.createElement("div");
      overlay.className = "fixed inset-0 z-50 flex items-end justify-center bg-black bg-opacity-70 px-3 py-3 sm:items-center sm:px-4 sm:py-4";

      const modal = document.createElement("div");
      modal.className = "w-full max-w-xl max-h-screen overflow-auto rounded-2xl border border-gray-700 bg-gray-900 text-white shadow-2xl ring-1 ring-white ring-opacity-5 sm:max-h-screen";
      modal.innerHTML = `
        <div class="border-b border-gray-700 px-5 py-5 sm:px-6">
          <div class="flex items-start gap-3">
            <div class="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-500 bg-opacity-10 text-blue-200 ring-1 ring-blue-400 ring-opacity-20">${getUiIcon("settings")}</div>
            <div class="min-w-0">
              <div class="text-lg font-bold tracking-tight sm:text-xl">Pengaturan unduhan</div>
              <div class="mt-1 text-sm leading-6 text-gray-300">Isi nama file, halaman awal, dan jumlah worker sebelum proses dimulai.</div>
            </div>
          </div>
        </div>
        <form id="rmv-settings-form" class="grid gap-4 px-5 py-5 sm:px-6">
          <label class="grid gap-2 text-sm font-medium text-gray-200">
            <span>Nama file PDF</span>
            <input class="w-full rounded-2xl border border-gray-700 bg-gray-800 px-4 py-3 text-base text-white outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400 focus:ring-opacity-20" name="pdfFileName" type="text" value="${escapeHtml(defaults.defaultFileName)}" autocomplete="off" />
          </label>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="grid gap-2 text-sm font-medium text-gray-200">
              <span>Halaman awal</span>
              <input class="w-full rounded-2xl border border-gray-700 bg-gray-800 px-4 py-3 text-base text-white outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400 focus:ring-opacity-20" name="startPage" type="number" min="1" value="${defaults.defaultStartPage}" />
            </label>
            <label class="grid gap-2 text-sm font-medium text-gray-200">
              <span>Worker</span>
              <input class="w-full rounded-2xl border border-gray-700 bg-gray-800 px-4 py-3 text-base text-white outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400 focus:ring-opacity-20" name="concurrency" type="number" min="1" max="50" value="${defaults.defaultConcurrency}" />
            </label>
          </div>
          <label class="grid gap-2 text-sm font-medium text-gray-200">
            <span>Total halaman</span>
            <input class="w-full rounded-2xl border border-gray-700 bg-gray-800 px-4 py-3 text-base text-white outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400 focus:ring-opacity-20" name="totalPages" type="number" min="1" value="${defaults.defaultTotalPages ?? ""}" placeholder="Otomatis dari FlowPaper" />
          </label>
          <div class="grid gap-4 sm:grid-cols-2">
            <label class="grid gap-2 text-sm font-medium text-gray-200">
              <span>Orientasi</span>
              <select class="w-full rounded-2xl border border-gray-700 bg-gray-800 px-4 py-3 text-base text-white outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400 focus:ring-opacity-20" name="orientation">
                <option value="portrait" ${defaults.defaultOrientation === "portrait" ? "selected" : ""}>Portrait</option>
                <option value="landscape" ${defaults.defaultOrientation === "landscape" ? "selected" : ""}>Landscape</option>
              </select>
            </label>
            <label class="grid gap-2 text-sm font-medium text-gray-200">
              <span>Ukuran kertas</span>
              <select class="w-full rounded-2xl border border-gray-700 bg-gray-800 px-4 py-3 text-base text-white outline-none transition focus:border-blue-400 focus:ring-4 focus:ring-blue-400 focus:ring-opacity-20" name="paperSize">
                <option value="a4" ${defaults.defaultPaperSize === "a4" ? "selected" : ""}>A4</option>
                <option value="letter" ${defaults.defaultPaperSize === "letter" ? "selected" : ""}>Letter</option>
                <option value="legal" ${defaults.defaultPaperSize === "legal" ? "selected" : ""}>Legal</option>
                <option value="a5" ${defaults.defaultPaperSize === "a5" ? "selected" : ""}>A5</option>
              </select>
            </label>
          </div>
          <div class="mt-1 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" id="rmv-settings-cancel" class="inline-flex items-center justify-center gap-2 rounded-2xl border border-gray-700 bg-transparent px-4 py-3 text-sm font-semibold text-white transition hover:bg-white hover:bg-opacity-5">${getUiIcon("x")}<span>Batal</span></button>
            <button type="submit" class="inline-flex items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-blue-500 to-green-500 px-4 py-3 text-sm font-extrabold text-gray-900 shadow-lg transition hover:brightness-110">${getUiIcon("play")}<span>Mulai</span></button>
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
        const totalPages = parseTotalPages(formData.get("totalPages"), defaults.defaultTotalPages);
        const orientation = String(formData.get("orientation") || defaults.defaultOrientation).toLowerCase() === "landscape" ? "landscape" : "portrait";
        const paperSize = normalizePaperSize(formData.get("paperSize") || defaults.defaultPaperSize);

        cleanup();
        resolve({ pdfFileName, startPage, concurrency, totalPages, orientation, paperSize });
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

  function normalizePaperSize(value) {
    const allowed = new Set(["a4", "letter", "legal", "a5"]);
    const normalized = String(value || "a4").toLowerCase();
    return allowed.has(normalized) ? normalized : "a4";
  }

  function parseTotalPages(value, fallback) {
    const parsed = parseInt(String(value ?? "").trim(), 10);

    if (Number.isFinite(parsed) && parsed > 0) {
      return parsed;
    }

    return Number.isFinite(fallback) && fallback > 0 ? fallback : null;
  }

  function getTotalPagesFromFlowpaper(root) {
    const totalPagesLabel = root.querySelector(".flowpaper_lblTotalPages.flowpaper_tblabel.flowpaper_numberOfPages");
    const text = totalPagesLabel?.textContent || "";
    const match = text.match(/\/\s*(\d+)/);

    if (!match) {
      return null;
    }

    const totalPages = parseInt(match[1], 10);
    return Number.isFinite(totalPages) && totalPages > 0 ? totalPages : null;
  }

  function getUiIcon(name) {
    const base = 'class="h-4 w-4 shrink-0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

    if (name === "settings") {
      return `<svg ${base} viewBox="0 0 24 24"><path d="M10.325 4.317a1.75 1.75 0 0 1 3.35 0l.44 1.446a1.75 1.75 0 0 0 1.67 1.226h1.52a1.75 1.75 0 0 1 1.29 2.93l-.98 1.127a1.75 1.75 0 0 0-.42 1.78l.44 1.45a1.75 1.75 0 0 1-1.67 2.25h-1.82a1.75 1.75 0 0 0-1.47.79l-.84 1.36a1.75 1.75 0 0 1-3 0l-.84-1.36a1.75 1.75 0 0 0-1.47-.79H5.2a1.75 1.75 0 0 1-1.67-2.25l.44-1.45a1.75 1.75 0 0 0-.42-1.78l-.98-1.13a1.75 1.75 0 0 1 1.29-2.93h1.52a1.75 1.75 0 0 0 1.67-1.226l.44-1.446a1.75 1.75 0 0 1 1.81-1.317z"/><circle cx="12" cy="12" r="3"/></svg>`;
    }

    if (name === "play") {
      return `<svg ${base} viewBox="0 0 24 24"><path d="M8 5.6v12.8a1 1 0 0 0 1.5.86l10.2-6.4a1 1 0 0 0 0-1.72L9.5 4.74A1 1 0 0 0 8 5.6z"/></svg>`;
    }

    if (name === "x") {
      return `<svg ${base} viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>`;
    }

    if (name === "check") {
      return `<svg ${base} viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>`;
    }

    if (name === "loading") {
      return `<svg class="h-4 w-4 shrink-0 animate-spin" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12a9 9 0 1 1-6.219-8.56" stroke-linecap="round"/></svg>`;
    }

    return "";
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
    const panel = document.createElement("div");
    panel.id = "rmv-download-console";
    panel.className = "fixed bottom-32 left-3 right-3 z-[9999] max-h-[calc(100vh-2rem)] w-auto overflow-auto rounded-2xl border border-gray-700 bg-gray-900 bg-opacity-90 p-3 font-sans text-sm leading-5 text-white shadow-2xl sm:left-auto sm:right-4 sm:w-80";
    panel.dataset.mode = "probing";
    panel.innerHTML = `
      <div class="mb-3 flex items-start justify-between gap-3">
        <div class="flex min-w-0 items-center gap-2">
          <span id="rmv-status-icon" class="text-blue-200">${getUiIcon("loading")}</span>
          <strong id="rmv-status" class="rmv-status-line truncate text-sm font-semibold">Memuat...</strong>
        </div>
      </div>
      <div id="rmv-processing-details" class="hidden">
        <div class="mb-1.5 flex items-center justify-between gap-2 text-xs text-gray-300"><span>Diproses</span><span id="rmv-fetched" class="font-semibold text-white">0</span></div>
        <div class="mb-1.5 flex items-center justify-between gap-2 text-xs text-gray-300"><span>Halaman terakhir</span><span id="rmv-last" class="font-semibold text-white">-</span></div>
        <div class="mb-1.5 h-2 overflow-hidden rounded-full bg-white bg-opacity-10"><div id="rmv-bar" class="h-full w-0 rounded-full bg-blue-400 transition-all duration-200"></div></div>
        <div class="flex items-center justify-between gap-2 text-xs text-gray-400"><span>Worker</span><span id="rmv-workers" class="font-semibold text-gray-200">${concurrency}</span></div>
      </div>
      <div id="rmv-complete-details" class="hidden text-base font-bold tracking-tight">
        <div class="flex items-center gap-2 text-green-100">
           <span>Total halaman: <span id="rmv-pages-done">0</span></span>
        </div>
      </div>
    `;
    root.appendChild(panel);

    const elements = {
      status: panel.querySelector("#rmv-status"),
      statusIcon: panel.querySelector("#rmv-status-icon"),
      fetched: panel.querySelector("#rmv-fetched"),
      last: panel.querySelector("#rmv-last"),
      bar: panel.querySelector("#rmv-bar"),
      pagesDone: panel.querySelector("#rmv-pages-done"),
    };

    const ui = {
      setProbing() {
        panel.dataset.mode = "probing";
        elements.statusIcon.innerHTML = getUiIcon("loading");
        elements.statusIcon.className = "text-blue-200";
        panel.querySelector("#rmv-processing-details").classList.add("hidden");
        panel.querySelector("#rmv-complete-details").classList.add("hidden");
        elements.status.textContent = "Memuat...";
      },
      setProbingProgress(probedPages) {
        panel.dataset.mode = "probing";
        elements.statusIcon.innerHTML = getUiIcon("loading");
        elements.statusIcon.className = "text-blue-200";
        panel.querySelector("#rmv-processing-details").classList.add("hidden");
        panel.querySelector("#rmv-complete-details").classList.add("hidden");
        elements.status.textContent = `Mendeteksi ${probedPages} halaman...`;
      },
      setProcessing(progress, fetchedPages, lastKnownPage) {
        panel.dataset.mode = "processing";
        elements.statusIcon.innerHTML = getUiIcon("loading");
        elements.statusIcon.className = "text-blue-200";
        elements.status.textContent = "Memproses";
        panel.querySelector("#rmv-processing-details").classList.remove("hidden");
        panel.querySelector("#rmv-complete-details").classList.add("hidden");
        elements.fetched.textContent = String(fetchedPages);
        elements.last.textContent = String(lastKnownPage);
        elements.bar.style.width = `${Math.round(progress * 100)}%`;
      },
      setProbingComplete(lastKnownPage) {
        panel.dataset.mode = "processing";
        elements.statusIcon.innerHTML = getUiIcon("loading");
        elements.statusIcon.className = "text-blue-200";
        elements.status.textContent = "Memproses";
        panel.querySelector("#rmv-processing-details").classList.remove("hidden");
        panel.querySelector("#rmv-complete-details").classList.add("hidden");
        elements.last.textContent = String(lastKnownPage);
      },
      setCancelled() {
        panel.dataset.mode = "idle";
        panel.querySelector("#rmv-processing-details").classList.add("hidden");
        panel.querySelector("#rmv-complete-details").classList.add("hidden");
        elements.statusIcon.innerHTML = getUiIcon("x");
        elements.statusIcon.className = "text-red-300";
        elements.status.textContent = "Dibatalkan";
      },
      setDone(totalPages) {
        panel.dataset.mode = "done";
        panel.querySelector("#rmv-processing-details").classList.add("hidden");
        panel.querySelector("#rmv-complete-details").classList.remove("hidden");
        elements.statusIcon.innerHTML = getUiIcon("check");
        elements.statusIcon.className = "text-green-200";
        elements.status.textContent = "Selesai";
        elements.pagesDone.textContent = String(totalPages);
      },
    };

    ui.setProbing();
    return ui;
  }

  async function detectLastPage(startPage, signal, ui) {
    let probedPages = 0;

    const probe = async (pageNumber) => {
      probedPages += 1;
      ui?.setProbingProgress?.(probedPages);
      return probePage(pageNumber, signal);
    };

    if (!(await probe(startPage))) {
      return startPage - 1;
    }

    let lower = startPage;
    let upper = startPage + 1;

    while (await probe(upper)) {
      lower = upper;
      upper *= 2;

      if (upper > startPage + 10000) {
        upper = startPage + 10000;
        break;
      }
    }

    while (lower + 1 < upper) {
      const middle = Math.floor((lower + upper) / 2);
      if (await probe(middle)) {
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
