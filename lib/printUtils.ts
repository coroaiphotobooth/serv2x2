
/**
 * Utility untuk mencetak gambar.
 * 
 * NOTE: Agar printing berjalan tanpa pop-up (silent printing),
 * Browser pada mesin Kiosk harus dijalankan dengan flag: --kiosk-printing
 * Contoh Chrome: chrome.exe --kiosk --kiosk-printing https://your-app-url.com
 */

export const printImage = (imageUrl: string) => {
    // 1. Buat iframe tersembunyi
    const iframe = document.createElement('iframe');
    
    // Style agar tidak terlihat user tapi tetap ada di DOM (untuk trigger print)
    iframe.style.position = 'fixed';
    iframe.style.right = '0';
    iframe.style.bottom = '0';
    iframe.style.width = '0';
    iframe.style.height = '0';
    iframe.style.border = '0';
    
    document.body.appendChild(iframe);

    // 2. Tulis konten ke iframe
    const doc = iframe.contentWindow?.document;
    if (doc) {
        doc.open();
        doc.write(`
            <!DOCTYPE html>
            <html>
            <head>
                <title>Print Photo</title>
                <style>
                    @page { 
                        size: auto; 
                        margin: 0mm; 
                    }
                    body { 
                        margin: 0; 
                        padding: 0; 
                        display: flex; 
                        justify-content: center; 
                        align-items: center; 
                        height: 100vh; 
                        width: 100vw;
                    }
                    img { 
                        max-width: 100%; 
                        max-height: 100%; 
                        object-fit: contain; 
                        display: block;
                    }
                </style>
            </head>
            <body>
                <img src="${imageUrl}" id="printImage" />
                <script>
                    const img = document.getElementById('printImage');
                    img.onload = function() {
                        // Tunggu sebentar untuk memastikan render
                        setTimeout(() => {
                            window.focus();
                            window.print();
                        }, 500);
                    };
                </script>
            </body>
            </html>
        `);
        doc.close();
    }

    // 3. Bersihkan iframe setelah beberapa saat (asumsi print dialog sudah trigger/selesai)
    setTimeout(() => {
        document.body.removeChild(iframe);
    }, 5000); // 5 detik delay untuk safety
};
