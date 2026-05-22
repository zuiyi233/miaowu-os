export const compressImage = async (
  file: File, maxWidth = 600, quality = 0.7, maxHeight = 800
): Promise<string> => {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      try {
        let width = img.width, height = img.height;
        if (width > maxWidth) { height = Math.round((height * maxWidth) / width); width = maxWidth; }
        if (height > maxHeight) { width = Math.round((width * maxHeight) / height); height = maxHeight; }
        const canvas = document.createElement("canvas");
        canvas.width = width; canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) { reject(new Error("无法创建 Canvas 上下文")); return; }
        ctx.fillStyle = "#FFFFFF"; ctx.fillRect(0, 0, width, height);
        ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", quality));
      } catch (error) { reject(error); }
    };
    img.onerror = () => { URL.revokeObjectURL(objectUrl); reject(new Error("图片加载失败")); };
    img.src = objectUrl;
  });
};
