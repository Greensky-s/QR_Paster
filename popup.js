document.addEventListener('DOMContentLoaded', () => {
  const messageEl = document.getElementById('message');
  const recognizedImgContainer = document.getElementById('recognized-img-container');
  const recognizedImg = document.getElementById('recognized-img');
  const canvas = document.getElementById('canvas');
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const autoOpenCheckbox = document.getElementById('auto-open-checkbox');

  // 설정 저장 불러오기
  const savedSetting = localStorage.getItem('autoOpen');
  if (savedSetting !== null) {
    autoOpenCheckbox.checked = (savedSetting === 'true');
  }
  autoOpenCheckbox.addEventListener('change', (e) => {
    localStorage.setItem('autoOpen', e.target.checked);
  });

  window.focus();

  // --- 1. 공통 처리 함수 (결과 텍스트 및 썸네일 표시) ---
  function processQRCode(code, sourceImgSrc) {
    if (code) {
      const url = code.data;
      if (url.startsWith('http://') || url.startsWith('https://')) {
        if (sourceImgSrc) {
          recognizedImg.src = sourceImgSrc;
          recognizedImgContainer.style.display = "block";
        }
        if (autoOpenCheckbox.checked) {
          messageEl.innerText = "인식 성공! 이동 중...";
          messageEl.style.color = "green";
          chrome.tabs.create({ url: url });
        } else {
          messageEl.style.color = "black";
          messageEl.innerHTML = `
            <span style="color: green;">인식 성공!</span><br>
            <a href="${url}" target="_blank" style="color: #4285f4; font-size:12px;">${url}</a>
          `;
        }
      } else {
        messageEl.innerText = "웹사이트 URL이 아닙니다:\n" + url;
        messageEl.style.color = "#ff9800";
        recognizedImgContainer.style.display = "none";
      }
    } else {
      messageEl.innerText = "QR 코드를 찾을 수 없습니다.";
      messageEl.style.color = "red";
      recognizedImgContainer.style.display = "none";
    }
  }

  // --- 2. 하얀 여백 추가 + 다중 크기 시도 함수 ---
  function scanImageWithPadding(img, originalSrc) {
    const padding = 50;
    const scales = [1, 0.5, 0.25];
    const previewSrc = originalSrc || img.src;

    for (let i = 0; i < scales.length; i++) {
      let scale = scales[i];
      canvas.width = (img.width * scale) + padding * 2;
      canvas.height = (img.height * scale) + padding * 2;
      
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(img, padding, padding, img.width * scale, img.height * scale);

      const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, {
        inversionAttempts: "attemptBoth"
      });

      if (code) {
        processQRCode(code, previewSrc);
        return; 
      }
    }
    processQRCode(null); // 모든 시도 실패
  }

  // --- 💡 3. [핵심 신기술] 쓸데없는 배경(크롬 회색화면 등) 자동 자르기 ---
  function autoCropAndScan(img) {
    const tempCanvas = document.createElement('canvas');
    const ctx = tempCanvas.getContext('2d', { willReadFrequently: true });
    tempCanvas.width = img.width;
    tempCanvas.height = img.height;
    ctx.drawImage(img, 0, 0);

    const imgData = ctx.getImageData(0, 0, tempCanvas.width, tempCanvas.height);
    const data = imgData.data;

    // 맨 왼쪽 위(0,0) 픽셀의 색상을 '배경색'으로 기준 잡기
    const bgR = data[0], bgG = data[1], bgB = data[2];
    const threshold = 15; // 색상 오차 허용 범위

    function isBg(i) {
      return Math.abs(data[i] - bgR) < threshold &&
             Math.abs(data[i+1] - bgG) < threshold &&
             Math.abs(data[i+2] - bgB) < threshold;
    }

    let top = 0, bottom = tempCanvas.height - 1, left = 0, right = tempCanvas.width - 1;

    // 위에서부터 여백 찾기
    topLoop: for (let y = 0; y < tempCanvas.height; y++) {
      for (let x = 0; x < tempCanvas.width; x++) {
        if (!isBg((y * tempCanvas.width + x) * 4)) { top = y; break topLoop; }
      }
    }
    // 아래에서부터 여백 찾기
    bottomLoop: for (let y = tempCanvas.height - 1; y >= 0; y--) {
      for (let x = 0; x < tempCanvas.width; x++) {
        if (!isBg((y * tempCanvas.width + x) * 4)) { bottom = y; break bottomLoop; }
      }
    }
    // 왼쪽에서부터 여백 찾기
    leftLoop: for (let x = 0; x < tempCanvas.width; x++) {
      for (let y = top; y <= bottom; y++) {
        if (!isBg((y * tempCanvas.width + x) * 4)) { left = x; break leftLoop; }
      }
    }
    // 오른쪽에서부터 여백 찾기
    rightLoop: for (let x = tempCanvas.width - 1; x >= 0; x--) {
      for (let y = top; y <= bottom; y++) {
        if (!isBg((y * tempCanvas.width + x) * 4)) { right = x; break rightLoop; }
      }
    }

    // 알맹이 이미지가 확인되었고, 잘라낼 배경이 충분히 크다면
    if (right > left && bottom > top) {
      const cropWidth = right - left + 1;
      const cropHeight = bottom - top + 1;
      
      // 이미지를 잘라냅니다.
      if (cropWidth < tempCanvas.width - 10 || cropHeight < tempCanvas.height - 10) {
        const croppedCanvas = document.createElement('canvas');
        croppedCanvas.width = cropWidth;
        croppedCanvas.height = cropHeight;
        const croppedCtx = croppedCanvas.getContext('2d');
        croppedCtx.drawImage(tempCanvas, left, top, cropWidth, cropHeight, 0, 0, cropWidth, cropHeight);
        
        const croppedImg = new Image();
        croppedImg.onload = () => scanImageWithPadding(croppedImg, croppedCanvas.toDataURL());
        croppedImg.src = croppedCanvas.toDataURL();
        return; // 자른 이미지로 스캔 시작
      }
    }

    // 자를 배경이 없거나 일반 화면이면 원본 그대로 스캔
    scanImageWithPadding(img);
  }

  // === [기능 1: 화면 스캔 파트] ===
  const scanScreenBtn = document.getElementById('scan-screen-btn');
  scanScreenBtn.addEventListener('click', () => {
    messageEl.innerText = "화면 스캔 중...";
    messageEl.style.color = "#555";
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        messageEl.innerText = "화면 캡처 권한이 없거나 실패했습니다.";
        messageEl.style.color = "red";
        return;
      }
      const img = new Image();
      // 💡 여기서 원본 스캔 대신, 새로 만든 '자동 자르기' 함수를 먼저 실행합니다!
      img.onload = () => autoCropAndScan(img);
      img.src = dataUrl;
    });
  });

  // === [기능 2: 붙여넣기 파트] ===
  window.addEventListener('paste', (e) => {
    e.preventDefault();
    const items = (e.clipboardData || e.originalEvent.clipboardData).items;
    let imageFound = false;

    for (let item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        imageFound = true;
        const blob = item.getAsFile();
        const reader = new FileReader();
        reader.onload = (event) => {
          const img = new Image();
          img.onload = () => scanImageWithPadding(img);
          img.src = event.target.result;
        };
        reader.readAsDataURL(blob);
        break;
      }
    }

    if (!imageFound) {
      messageEl.innerText = "클립보드에 이미지가 없습니다.";
      messageEl.style.color = "red";
      recognizedImgContainer.style.display = "none";
    }
  });

  // === [기능 3: QR 코드 생성 파트] ===
  const generateBtn = document.getElementById('generate-btn');
  const qrcodeDisplay = document.getElementById('qrcode-display');
  const qrcodeInstr = document.getElementById('qrcode-instr');

  generateBtn.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, function(tabs) {
      const url = tabs[0].url;
      qrcodeDisplay.innerHTML = "";
      
      if (url.startsWith('http://') || url.startsWith('https://')) {
        new QRCode(qrcodeDisplay, { 
          text: url, 
          width: 140, 
          height: 140,
          colorDark : "#000000",
          colorLight : "#ffffff",
          correctLevel : QRCode.CorrectLevel.M
        });
        qrcodeInstr.style.display = "block";
      } else {
        messageEl.innerText = "이 페이지는 QR 코드로 만들 수 없습니다.";
        messageEl.style.color = "red";
        qrcodeInstr.style.display = "none";
      }
    });
  });

  qrcodeDisplay.addEventListener('click', () => {
    const qrImg = qrcodeDisplay.querySelector('img');
    if (qrImg && qrImg.src) {
      chrome.tabs.create({ url: qrImg.src });
    }
  });
});