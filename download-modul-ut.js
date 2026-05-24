(function () {
  const params = new URLSearchParams(window.location.search);

  // ambil dari URL
  let doc = params.get("doc");
  let subfolder = params.get("subfolder");

  // console log untuk debugging
  console.log("Doc:", doc);
  console.log("Subfolder:", subfolder);

  // input manual i, jika tidak ada input dari user maka akan default ke 1
  let i = parseInt(prompt("Masukkan nomor halaman awal (default 1):") || "1");

  function generateUri(docName, subfolderName, pageNumber) {
    if (!docName || !subfolderName) {
      throw new Error("Missing doc or subfolder parameter");
    }

    // get subfolder name without trailing slash and extension
    let sf = subfolderName.replace(/\/$/, "");

    sf = sf.replace(/\.[^/.]+$/, "");

    // get doc name without extension
    let d = docName.replace(/\.[^/.]+$/, "");

    let p = pageNumber;

    const base = `https://pustaka.ut.ac.id/reader/services/view.php?doc=${d}&format=jpg&subfolder=${sf}/&page=${p}`;

    return base;
  }

  function downloadNext() {
    fetch(generateUri(doc, subfolder, i))
      .then((res) => res.blob())
      .then((blob) => {
        if (!blob.type.startsWith("image") || blob.size < 5000) {
          throw new Error("Stop");
        }

        const img = new Image();
        img.onload = () => {
          if (img.width < 200 || img.height < 200) {
            console.log("Stop di halaman", i);
            console.log("Halaman terakhir:", i - 1);
            return;
          }

          const a = document.createElement("a");
          a.href = URL.createObjectURL(blob);
          a.download = `${subfolder}-${doc}-page-${i}.jpg`;
          a.click();

          console.log("Downloaded", i);

          i++;

          const delay = Math.random() * 500 + 500; // delay antara 500ms hingga 1000ms
          setTimeout(downloadNext, delay);
        };

        img.onerror = () => {
          console.log("Stop di halaman", i);
          console.log("Halaman terakhir:", i - 1);
        };

        img.src = URL.createObjectURL(blob);
      })
      .catch(() => {
        console.log("Stop di halaman", i);
        console.log("Halaman terakhir:", i - 1);
        alert(`Download selesai. Halaman terakhir: ${i - 1}`);
      });
  }

  downloadNext();

  return "Downloader started. Check console for progress...";
})();
