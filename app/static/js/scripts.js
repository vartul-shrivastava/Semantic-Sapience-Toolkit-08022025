const modalBackdrop = document.getElementById('modalBackdrop');
const systemTrayLinks = document.getElementById('systemTrayLinks');
const statsCardsWrapper = document.getElementById('statsCardsWrapper');

let currentFile = null;        // Uploaded file
let currentFileBase64 = null;  // Base64 file contents
let currentFileName = null;    // File name
let datasetColumns = [];       // CSV/XLSX header names
let allModals = {};            // Open/minimized modals with checkpoints

let currentDatasetStats = null; // Current dataset stats

const MODAL_TEMPLATES = {
  tfidf: 'tfidfModal',
  freq: 'freqModal',
  collocation: 'collocationModal',
  lda: 'ldaModal',
  nmf: 'nmfModal',
  bertopic: 'bertopicModal',
  lsa: 'lsaModal',
  llmbased: 'llmbasedModal',
  rulebasedsa: 'rulebasedsaModal',
  dlbasedsa: 'dlbasedsaModal',
  zeroshotSentiment: 'zeroshotSentimentModal',
  absa: 'absaModal',
  semanticwc: 'semanticwcModal',
};

const modelDisplayNames = {
  tfidf: 'Term Frequency-Inverse Document Frequency (TF-IDF)',
  freq: 'Frequency Analysis',
  collocation: 'Collocation Analysis',
  lda: 'Latent Dirichlet Allocation (LDA)',
  nmf: 'Non-negative Matrix Factorization (NMF)',
  bertopic: 'BERTopic',
  lsa: 'Latent Semantic Analysis (LSA)',
  llmbased: 'LLM-Based Sentiment Analysis',
  rulebasedsa: 'Rule-Based Sentiment Analysis',
  dlbasedsa: 'Deep Learning-Based Sentiment Analysis',
  absa: 'Aspect-Based Sentiment Analysis (ABSA)',
  zeroshotSentiment: 'Zero-Shot Sentiment Analysis',
  topicspecificwc: 'Topic-Specific Word Cloud',
  semanticwc: 'Semantic Word Cloud'
};

if (systemTrayLinks) {
  systemTrayLinks.innerHTML = '';
}

document.addEventListener('DOMContentLoaded', () => {
  initializeSystemStats();
  const largeDisplay = document.querySelector('.large-display');
  const defaultContent = document.getElementById('defaultContent');

  const updateDefaultContentVisibility = () => {
    const activeModals = largeDisplay.querySelectorAll('.modal');
    defaultContent.style.display = activeModals.length > 0 ? 'none' : 'flex';
  };

  const observer = new MutationObserver((mutationsList) => {
    for (const mutation of mutationsList) {
      if (mutation.type === 'childList') {
        updateDefaultContentVisibility();
      }
    }
  });
  observer.observe(largeDisplay, { childList: true, subtree: true });
  updateDefaultContentVisibility();
});

function attachCoherenceListener(modal) {
  const coherenceCheckbox = modal.querySelector('input[name="coherence_analysis"]');
  if (!coherenceCheckbox) return;
  const coherenceParamsDiv = modal.querySelector('div[id$="coherence-params"]');
  if (!coherenceParamsDiv) return;
  coherenceParamsDiv.style.display = coherenceCheckbox.checked ? 'block' : 'none';
  coherenceCheckbox.addEventListener('change', () => {
    coherenceParamsDiv.style.display = coherenceCheckbox.checked ? 'block' : 'none';
  });
}

function showLoading() {
  document.getElementById('loadingOverlay').style.display = 'flex';
}

function hideLoading() {
  document.getElementById('loadingOverlay').style.display = 'none';
}

async function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result.split(',')[1]);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function triggerFileUpload() {
  const fileInput = document.getElementById('fileInput');
  fileInput.value = "";
  fileInput.click();
}

function triggerProjectImport() {   
  const importInput = document.getElementById('importLspInput');
  importInput.value = "";
  importInput.click();
}

document.getElementById('fileInput').addEventListener('change', handleFileUpload);

async function handleFileUpload(event) {
  const file = event.target.files[0];
  if (!file) return;
  showLoading();
  try {
    currentFile = file;
    currentFileName = file.name;
    currentFileBase64 = await fileToBase64(file);
    const formData = new FormData();
    formData.append("file", file);
    const response = await fetch("/upload", {
      method: "POST",
      body: formData
    });
    const data = await response.json();
    if (!response.ok) {
      alert(data.error || "Error uploading file.");
      datasetColumns = [];
      currentDatasetStats = null;
      renderStats([]);
      return;
    }
    if (data.stats) {
      datasetColumns = Object.keys(data.stats);
      currentDatasetStats = data.stats;
      renderStatsFromServerStats(data.stats);
    } else {
      alert(data.message || "No stats returned from server.");
      datasetColumns = [];
      currentDatasetStats = null;
      renderStats([]);
    }
  } catch (error) {
    console.error(error);
    alert("Error processing file: " + error.message);
    datasetColumns = [];
    currentDatasetStats = null;
    renderStats([]);
  } finally {
    hideLoading();
  }
}

document.getElementById('importLspInput').addEventListener('change', handleProjectImport);

async function handleProjectImport(evt) {
  const file = evt.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = async (e) => {
    const fileBuffer = e.target.result;
    const iv = new Uint8Array(fileBuffer.slice(0, 12));
    const encryptedData = new Uint8Array(fileBuffer.slice(12));
    try {
      if (!sessionKey) throw new Error("No sessionKey set yet.");
      const decryptedData = await decryptData(encryptedData, iv);
      const projectData = JSON.parse(decryptedData);
      await setProjectConfig(projectData);
      console.log("Project imported successfully with existing sessionKey.");
      return;
    } catch (error) {
      console.warn("Initial decryption failed:", error);
    }
    let newPassword;
    try {
      newPassword = await requestDecryptionPassword();
    } catch (cancelError) {
      console.log(cancelError);
      return;
    }
    let newKey;
    try {
      newKey = await generateKeyFromPassword(newPassword);
    } catch (error) {
      console.error("Failed to generate new key:", error);
      return;
    }
    try {
      const decryptedData = await decryptData(encryptedData, iv, newKey);
      const projectData = JSON.parse(decryptedData);
      sessionKey = newKey;
      await setProjectConfig(projectData);
      console.log("Project imported successfully after re-entering password.");
      alert("Project imported successfully");
    } catch (error2) {
      console.error("Second decryption attempt failed:", error2);
      alert("Looks like a wrong password. Please try again..");
    }
  };
  reader.readAsArrayBuffer(file);
}

function requestDecryptionPassword() {
  return new Promise((resolve, reject) => {
    const overlay = document.getElementById('decryptionOverlay');
    const passwordInput = document.getElementById('overlayPasswordInput');
    const confirmBtn = document.getElementById('overlayConfirmBtn');
    const cancelBtn = document.getElementById('overlayCancelBtn');
    passwordInput.value = '';
    overlay.style.display = 'flex';
    const onConfirm = () => {
      const pass = passwordInput.value.trim();
      if (!pass) return;
      hideOverlay();
      resolve(pass);
    };
    const onCancel = () => {
      hideOverlay();
      reject(new Error('User canceled password entry.'));
    };
    const hideOverlay = () => {
      overlay.style.display = 'none';
      confirmBtn.removeEventListener('click', onConfirm);
      cancelBtn.removeEventListener('click', onCancel);
    };
    confirmBtn.addEventListener('click', onConfirm);
    cancelBtn.addEventListener('click', onCancel);
  });
}

function renderStatsFromServerStats(statsObj) {
  const statsArr = Object.entries(statsObj).map(([colName, info]) => {
    if (info.type === 'Numeric') {
      return {
        colName,
        type: 'Numeric',
        mean: info.mean.toFixed(2),
        stdDev: info.stdDev.toFixed(2)
      };
    } else {
      return {
        colName,
        type: 'Textual',
        avgLen: info.avgLen.toFixed(2),
        maxLen: info.maxLen,
        minLen: info.minLen,
        uniqueCount: info.uniqueCount
      };
    }
  });
  renderStats(statsArr);
}

function renderStats(statsArr) {
  statsCardsWrapper.innerHTML = "";
  if (!statsArr || statsArr.length === 0) {
    statsCardsWrapper.textContent = "No data to display.";
    statsCardsWrapper.style.color = "#004aad";
    return;
  }
  statsArr.forEach(stat => {
    const card = document.createElement('div');
    card.className = 'stat-card';
    if (stat.type === 'Numeric') {
      card.innerHTML = `
        <h3>${stat.colName}</h3>
        <p>Type: Numeric</p>
        <p>Mean: ${stat.mean}</p>
        <p>Std Dev: ${stat.stdDev}</p>
      `;
    } else {
      card.innerHTML = `
        <h3>${stat.colName}</h3>
        <p>Type: Textual</p>
        <p>Avg Length: ${stat.avgLen}</p>
        <p>Max Length: ${stat.maxLen}</p>
        <p>Min Length: ${stat.minLen}</p>
        <p>Unique Values: ${stat.uniqueCount}</p>
      `;
    }
    statsCardsWrapper.appendChild(card);
  });
}

async function exportProject() {
  if (!sessionKey) {
    console.error("Session key is not set.");
    alert("Session password not set. Please reload the page and set a password.");
    return;
  }
  console.log("Exporting project with session key:", sessionKey);
  const projectData = await collectProjectConfig();
  const { encryptedData, iv } = await encryptData(JSON.stringify(projectData));
  const blob = new Blob([iv, encryptedData], { type: "application/octet-stream" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  const timestamp = Date.now();
  a.download = `project-${(new Date(timestamp).toLocaleString())}.ssproj`;
  a.click();
}

checkAIDependencyBtn.addEventListener('click', () => {
  showLoading();
  fetch('/check_ai_readiness', {
    method: 'GET',
    headers: { 'Content-Type': 'application/json' },
  })
    .then(response => response.json())
    .then(data => {
      hideLoading();
      if (data.success !== undefined) {
        if (!data.ollama_ready) {
          alert(`Error: ${data.error}`);
          return;
        }
        displayAIModules(data.models, data.ollama_ready, data.error);
      } else {
        displayAIModules(data.models, data.ollama_ready, data.error);
      }
    })
    .catch(error => {
      hideLoading();
      console.error('Error fetching AI dependencies:', error);
      alert('An error occurred while checking AI dependencies.');
    });
});

function displayAIModules(models, ollamaReady, error) {
  if (!ollamaReady) {
    alert(`Error: ${error}`);
    return;
  }
  if (!models || models.length === 0) {
    alert("No Ollama AI models are currently installed.");
    return;
  }
  alert(`Installed Ollama AI Models:\n\n${models.join("\n")}`);
}

function showModalLoading(modalEl) {
  let loadingOverlay = modalEl.querySelector('.modal-loading-overlay');
  if (!loadingOverlay) {
    loadingOverlay = document.createElement('div');
    loadingOverlay.className = 'modal-loading-overlay';
    loadingOverlay.innerHTML = '<div class="modal-spinner"></div><p style="margin-top: 1rem;">Processing...<br>Do not minimize this tab until operation is under process</p>';
    if (window.getComputedStyle(modalEl).position === 'static') {
      modalEl.style.position = 'relative';
    }
    modalEl.appendChild(loadingOverlay);
  }
  loadingOverlay.style.display = 'flex';
}

function hideModalLoading(modalEl) {
  const loadingOverlay = modalEl.querySelector('.modal-loading-overlay');
  if (loadingOverlay) {
    loadingOverlay.style.display = 'none';
  }
}

async function collectProjectConfig() {
  const modalsData = [];
  const openModals = modalBackdrop.querySelectorAll('.modal');
  openModals.forEach(modalEl => {
    const modalId = modalEl.dataset.modalId;
    const methodId = modalEl.dataset.methodName;
    const state = modalEl.classList.contains('maximized') ? 'maximized' : 'open';
    const fields = getModalFields(modalEl);
    const previewSection = modalEl.querySelector('.preview-section');
    const previewContent = previewSection ? previewSection.innerHTML : '';
    let checkpoints = [];
    if (allModals[modalId] && allModals[modalId].checkpoints) {
      checkpoints = allModals[modalId].checkpoints;
    }
    modalsData.push({
      modalId,
      methodId,
      state,
      fields,
      previewContent,
      checkpoints
    });
  });
  for (const modalId in allModals) {
    const entry = allModals[modalId];
    if (entry.state === 'minimized') {
      modalsData.push({
        modalId,
        methodId: entry.methodId,
        state: 'minimized',
        fields: entry.fields,
        previewContent: entry.previewContent,
        checkpoints: entry.checkpoints || []
      });
    }
  }
  const dataset = {
    fileName: currentFileName || null,
    base64: currentFileBase64 || null,
    stats: currentDatasetStats || null
  };
  return { dataset, modals: modalsData };
}

async function setProjectConfig(config) {
  closeAllModals();
  allModals = {};
  if (config.dataset) {
    currentFileName = config.dataset.fileName;
    currentFileBase64 = config.dataset.base64;
    currentDatasetStats = config.dataset.stats;
    if (currentDatasetStats) {
      datasetColumns = Object.keys(currentDatasetStats);
      renderStatsFromServerStats(currentDatasetStats);
    } else {
      datasetColumns = [];
      renderStats([]);
    }
  }
  if (config.modals && Array.isArray(config.modals)) {
    for (const modalConfig of config.modals) {
      const { modalId, methodId, state, fields, previewContent, checkpoints } = modalConfig;
      const newModal = openModal(methodId, modalId);
      if (!newModal) continue;
      setModalFields(newModal, fields);
      const previewSection = newModal.querySelector('.preview-section');
      if (previewSection && previewContent) {
        previewSection.innerHTML = previewContent;
      }
      if (!allModals[modalId]) {
        allModals[modalId] = {
          methodId: methodId,
          chosenCol: fields.textColumn || '',
          fields: fields,
          previewContent: previewContent,
          state: state,
          checkpoints: [],
          trayLink: null
        };
      } else {
        allModals[modalId].fields = fields;
        allModals[modalId].previewContent = previewContent;
        allModals[modalId].state = state;
      }
      if (state === 'minimized') {
        minimizeModal(newModal, methodId, true);
      } else if (state === 'maximized') {
        toggleMaximizeModal(newModal);
      }
      if (checkpoints && Array.isArray(checkpoints)) {
        checkpoints.forEach(checkpoint => {
          if (!allModals[modalId].checkpoints) {
            allModals[modalId].checkpoints = [];
          }
          allModals[modalId].checkpoints.push(checkpoint);
          addCheckpointToModal(newModal, checkpoint);
        });
      }
    }
  }
}

function closeAllModals() {
  const openModals = modalBackdrop.querySelectorAll('.modal');
  openModals.forEach(modal => closeModal(modal));
}

function createCheckpoint(modalEl, config, outputData) {
  const modalId = modalEl.dataset.modalId;
  const timestamp = Date.now();
  const checkpointId = `${modalId}-checkpoint-${timestamp}`;
  const checkpoint = {
    id: checkpointId,
    timestamp: timestamp,
    config: config,
    outputData: outputData
  };
  if (!allModals[modalId]) {
    allModals[modalId] = {
      methodId: config.methodId,
      chosenCol: config.fields.textColumn || '',
      fields: config.fields,
      previewContent: outputData,
      state: modalEl.classList.contains('minimized') ? 'minimized' : (modalEl.classList.contains('maximized') ? 'maximized' : 'open'),
      checkpoints: []
    };
  }
  allModals[modalId].checkpoints.push(checkpoint);
  addCheckpointToModal(modalEl, checkpoint);
}

function addCheckpointToModal(modalEl, checkpoint) {
  const checkpointTray = modalEl.querySelector('.checkpoints-list');
  if (!checkpointTray) return;
  const checkpointItem = document.createElement('div');
  checkpointItem.className = 'checkpoint-item';
  checkpointItem.textContent = `MHC-${new Date(checkpoint.timestamp).toLocaleString()}`;
  checkpointItem.title = "Click to restore this checkpoint";
  checkpointItem.onclick = () => restoreCheckpoint(modalEl, checkpoint.id);
  checkpointTray.appendChild(checkpointItem);
}

async function loadModels() {
  try {
    const response = await fetch("/get_models");
    const data = await response.json();
    if (data.success) {
      const modelSelects = document.querySelectorAll("#modelSelect");
      modelSelects.forEach(modelSelect => {
        modelSelect.innerHTML = "";
        data.models.forEach(modelName => {
          const option = document.createElement("option");
          option.value = modelName;
          option.textContent = modelName;
          modelSelect.appendChild(option);
        });
      });
    } else {
      console.error("Error fetching models:", data.error);
    }
  } catch (error) {
    console.error("Error fetching models:", error);
  }
}
window.addEventListener("DOMContentLoaded", loadModels);

function restoreCheckpoint(modalEl, checkpointId) {
  const modalId = modalEl.dataset.modalId;
  const checkpoint = allModals[modalId]?.checkpoints.find(cp => cp.id === checkpointId);
  console.log(`Attempting to restore checkpoint: ${checkpointId} for modal: ${modalId}`);
  if (!checkpoint) {
    alert("Checkpoint not found.");
    console.error(`Checkpoint with ID ${checkpointId} not found in allModals.`);
    return;
  }
  const { config, outputData } = checkpoint;
  if (!config || !config.fields) {
    alert("Invalid checkpoint configuration.");
    console.error("Checkpoint configuration is invalid:", checkpoint);
    return;
  }
  setModalFields(modalEl, config.fields);
  const previewSection = modalEl.querySelector('.preview-section');
  if (previewSection && outputData) {
    previewSection.innerHTML = outputData;
  }
  allModals[modalId].fields = config.fields;
  allModals[modalId].previewContent = outputData;
}

function getModalFields(modalEl) {
  const fields = {};
  const inputs = modalEl.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    if (!input.name) return;
    fields[input.name] = input.type === 'checkbox' ? input.checked : input.value.trim();
  });
  return fields;
}

function setModalFields(modalEl, data) {
  if (!data) return;
  const inputs = modalEl.querySelectorAll('input, textarea, select');
  inputs.forEach(input => {
    if (!input.name || !(input.name in data)) return;
    if (input.type === 'checkbox') {
      input.checked = data[input.name];
    } else {
      input.value = data[input.name];
    }
  });
}

function invokeMethod(methodId) {
  if (datasetColumns.length === 0) {
    alert("Please upload a CSV/XLSX dataset before opening a modal.");
    return;
  }
  openModal(methodId);
}

let zIndexCounter = 10;

function openModal(methodId, existingModalId = null) {
  const templateId = MODAL_TEMPLATES[methodId];
  if (!templateId) {
    console.warn(`No modal template found for method ID: ${methodId}`);
    return null;
  }
  const templateEl = document.getElementById(templateId);
  if (!templateEl) {
    console.warn(`Modal template element not found: ${templateId}`);
    return null;
  }
  const clonedModal = templateEl.querySelector('.modal').cloneNode(true);
  const uniqueId = existingModalId || `${methodId}-${Date.now()}`;
  clonedModal.dataset.modalId = uniqueId;
  clonedModal.dataset.methodName = methodId;
  const textColumnSelect = clonedModal.querySelector('select[name="textColumn"]');
  if (textColumnSelect) {
    textColumnSelect.innerHTML = '';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = '--- Select Column ---';
    textColumnSelect.appendChild(placeholderOption);
    datasetColumns.forEach(col => {
      const option = document.createElement('option');
      option.value = col;
      option.textContent = col;
      textColumnSelect.appendChild(option);
    });
    if (existingModalId && allModals[existingModalId]?.chosenCol) {
      textColumnSelect.value = allModals[existingModalId].chosenCol;
    }
  }
  attachCoherenceListener(clonedModal);
  modalBackdrop.appendChild(clonedModal);
  modalBackdrop.style.display = 'flex';
  initializeModalInteractions(clonedModal);
  randomizeModalPosition(clonedModal);
  const closeButton = clonedModal.querySelector('.close-btn');
  const minimizeButton = clonedModal.querySelector('.minimize-btn');
  const maximizeButton = clonedModal.querySelector('.maximize-btn');
  closeButton.onclick = () => closeModal(clonedModal);
  minimizeButton.onclick = () => minimizeModal(clonedModal, methodId);
  maximizeButton.onclick = () => toggleMaximizeModal(clonedModal);
  attachModalEventListeners(clonedModal, methodId);
  clonedModal.style.zIndex = zIndexCounter++;
  return clonedModal;
}

function attachModalEventListeners(modalEl, methodId) {
  const runButton = modalEl.querySelector('.modal-footer .btn.run-btn');
  const downloadButton = modalEl.querySelector('.modal-footer .btn.download-btn');
  if (runButton && downloadButton) {
    switch (methodId) {
      case 'tfidf':
      case 'freq':
      case 'collocation':
        runButton.addEventListener('click', () => regenerateWordCloud(modalEl, methodId));
        downloadButton.addEventListener('click', () => downloadWordCloud(modalEl, methodId));
        break;
      case 'semanticwc':
        runButton.addEventListener('click', () => generateSemanticWordCloud(modalEl));
        downloadButton.addEventListener('click', () => downloadWordCloud(modalEl, methodId));
        break;
      case 'lda':
      case 'nmf':
      case 'bertopic':
      case 'lsa':
        runButton.addEventListener('click', () => runTopicModeling(modalEl, methodId));
        downloadButton.addEventListener('click', () => downloadTopicModelingResults(modalEl, methodId));
        break;
      case 'rulebasedsa':
      case 'dlbasedsa':
      case 'absa':
      case 'zeroshotSentiment':
        runButton.addEventListener('click', () => runSentimentAnalysis(modalEl, methodId));
        downloadButton.addEventListener('click', () => downloadSentimentAnalysisResults(modalEl, methodId));
        break;
      default:
        console.warn(`No run/download handlers defined for method ID: ${methodId}`);
    }
  }
}

function randomizeModalPosition(modalEl) {
  const backdropRect = modalBackdrop.getBoundingClientRect();
  const modalRect = modalEl.getBoundingClientRect();
  const maxLeft = backdropRect.width - modalRect.width;
  const maxTop = backdropRect.height - modalRect.height;
  const randomLeft = Math.floor(Math.random() * (maxLeft > 0 ? maxLeft : 0));
  const randomTop = Math.floor(Math.random() * (maxTop > 0 ? maxTop : 0));
  modalEl.style.left = `${randomLeft}px`;
  modalEl.style.top = `${randomTop}px`;
}

document.addEventListener("DOMContentLoaded", () => {
  const contextMenu = document.getElementById("contextMenu");
  const largeDisplay = document.querySelector(".large-display");
  document.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const { clientX: mouseX, clientY: mouseY } = event;
    contextMenu.style.top = `${mouseY}px`;
    contextMenu.style.left = `${mouseX}px`;
    contextMenu.style.display = "block";
  });
  document.addEventListener("click", () => {
    contextMenu.style.display = "none";
  });
});

document.addEventListener('DOMContentLoaded', () => {
  const largeDisplay = document.querySelector('.large-display');
  const toggleButton = document.querySelector('.toggle-fullscreen-btn');
  let isFullscreen = false;
  let originalStyles = {};
  toggleButton.addEventListener('click', () => {
    if (!isFullscreen) {
      originalStyles = {
        width: largeDisplay.style.width,
        height: largeDisplay.style.height,
        left: largeDisplay.style.left,
        top: largeDisplay.style.top,
        position: largeDisplay.style.position,
        zIndex: largeDisplay.style.zIndex,
      };
      largeDisplay.style.position = 'fixed';
      largeDisplay.style.left = '0';
      largeDisplay.style.top = '0';
      largeDisplay.style.width = '100%';
      largeDisplay.style.height = '100%';
      largeDisplay.style.zIndex = '3000';
      isFullscreen = true;
      toggleButton.textContent = 'Exit Fullscreen';
    } else {
      Object.assign(largeDisplay.style, originalStyles);
      isFullscreen = false;
      toggleButton.textContent = 'Toggle Fullscreen';
    }
  });
});

function initializeModalInteractions(modalEl) {
  const modalHeader = modalEl.querySelector('.modal-header');
  const resizeHandles = modalEl.querySelectorAll('.resize-handle');
  let isDragging = false;
  let dragOffsetX = 0;
  let dragOffsetY = 0;
  modalHeader.addEventListener('mousedown', () => {
    bringModalToFront(modalEl);
  });
  modalHeader.addEventListener('mousedown', (e) => {
    isDragging = true;
    const rect = modalEl.getBoundingClientRect();
    const backdropRect = modalBackdrop.getBoundingClientRect();
    dragOffsetX = e.clientX - rect.left;
    dragOffsetY = e.clientY - rect.top;
    document.addEventListener('mousemove', dragModal);
    document.addEventListener('mouseup', stopDragging);
    e.preventDefault();
  });
  function dragModal(e) {
    if (isDragging) {
      const backdropRect = modalBackdrop.getBoundingClientRect();
      const modalRect = modalEl.getBoundingClientRect();
      let newLeft = e.clientX - backdropRect.left - dragOffsetX;
      let newTop = e.clientY - backdropRect.top - dragOffsetY;
      newLeft = Math.max(0, Math.min(newLeft, backdropRect.width - modalRect.width));
      newTop = Math.max(0, Math.min(newTop, backdropRect.height - modalRect.height));
      modalEl.style.left = `${newLeft}px`;
      modalEl.style.top = `${newTop}px`;
    }
  }
  function stopDragging() {
    isDragging = false;
    document.removeEventListener('mousemove', dragModal);
    document.removeEventListener('mouseup', stopDragging);
  }
  resizeHandles.forEach(handle => {
    handle.addEventListener('mousedown', (e) => {
      e.stopPropagation();
      const rect = modalEl.getBoundingClientRect();
      const backdropRect = modalBackdrop.getBoundingClientRect();
      const startX = e.clientX;
      const startY = e.clientY;
      const startWidth = rect.width;
      const startHeight = rect.height;
      const startLeft = rect.left - backdropRect.left;
      const startTop = rect.top - backdropRect.top;
      const handleClass = handle.classList.contains('nw') ? 'nw' :
                          handle.classList.contains('ne') ? 'ne' :
                          handle.classList.contains('sw') ? 'sw' : 'se';
      function resizeModal(e) {
        let deltaX = e.clientX - startX;
        let deltaY = e.clientY - startY;
        let newWidth = startWidth;
        let newHeight = startHeight;
        let newLeft = startLeft;
        let newTop = startTop;
        if (handleClass.includes('e')) {
          newWidth = startWidth + deltaX;
        }
        if (handleClass.includes('s')) {
          newHeight = startHeight + deltaY;
        }
        if (handleClass.includes('w')) {
          newWidth = startWidth - deltaX;
          newLeft = startLeft + deltaX;
        }
        if (handleClass.includes('n')) {
          newHeight = startHeight - deltaY;
          newTop = startTop + deltaY;
        }
        newWidth = Math.max(newWidth, 200);
        newHeight = Math.max(newHeight, 100);
        if (newLeft < 0) {
          newWidth += newLeft;
          newLeft = 0;
        }
        if (newTop < 0) {
          newHeight += newTop;
          newTop = 0;
        }
        if (newLeft + newWidth > backdropRect.width) {
          newWidth = backdropRect.width - newLeft;
        }
        if (newTop + newHeight > backdropRect.height) {
          newHeight = backdropRect.height - newTop;
        }
        modalEl.style.width = `${newWidth}px`;
        modalEl.style.height = `${newHeight}px`;
        modalEl.style.left = `${newLeft}px`;
        modalEl.style.top = `${newTop}px`;
      }
      function stopResizing() {
        document.removeEventListener('mousemove', resizeModal);
        document.removeEventListener('mouseup', stopResizing);
      }
      document.addEventListener('mousemove', resizeModal);
      document.addEventListener('mouseup', stopResizing);
    });
  });
}

function closeModal(modalEl) {
  const modalId = modalEl.dataset.modalId;
  modalEl.remove();
  if (!modalBackdrop.querySelector('.modal')) {
    modalBackdrop.style.display = 'none';
  }
  if (allModals[modalId]) {
    if (allModals[modalId].trayLink) {
      allModals[modalId].trayLink.remove();
    }
    delete allModals[modalId];
  }
}

function minimizeModal(modalEl, methodId, force = false) {
  const modalId = modalEl.dataset.modalId;
  const textColumnSelect = modalEl.querySelector('select[name="textColumn"]');
  const chosenCol = textColumnSelect ? textColumnSelect.value.trim() : '';
  if (!chosenCol) {
    alert("Please select a text column before minimizing.");
    return;
  }
  if (!force) {
    for (const existingId in allModals) {
      const entry = allModals[existingId];
      if (entry.methodId === methodId && entry.chosenCol === chosenCol && entry.state === 'minimized') {
        alert(`A minimized modal for "${modelDisplayNames[methodId] || methodId}" and column "${chosenCol}" already exists in the tray!`);
        return;
      }
    }
  }
  const currentFields = getModalFields(modalEl);
  const previewSection = modalEl.querySelector('.preview-section');
  const previewHTML = previewSection ? previewSection.innerHTML : '';
  modalEl.remove();
  if (!modalBackdrop.querySelector('.modal')) {
    modalBackdrop.style.display = 'none';
  }
  const methodIdFromModal = modalEl.dataset.methodName;
  const methodDisplayName = modelDisplayNames[methodIdFromModal] || 'Modal';
  const trayTitle = `${methodDisplayName} (${chosenCol})`;
  const trayLink = document.createElement('button');
  trayLink.type = 'button';
  trayLink.className = 'tray-link';
  trayLink.textContent = trayTitle;
  trayLink.onclick = () => restoreModal(modalId);
  systemTrayLinks.appendChild(trayLink);
  if (!allModals[modalId]) {
    allModals[modalId] = {
      methodId: methodIdFromModal,
      chosenCol: chosenCol,
      fields: currentFields,
      previewContent: previewHTML,
      state: 'minimized',
      checkpoints: [],
      trayLink: trayLink
    };
  } else {
    allModals[modalId].state = 'minimized';
    allModals[modalId].chosenCol = chosenCol;
    allModals[modalId].fields = currentFields;
    allModals[modalId].previewContent = previewHTML;
    allModals[modalId].trayLink = trayLink;
  }
}

function restoreModal(modalId) {
  const entry = allModals[modalId];
  if (!entry || entry.state !== 'minimized') {
    alert("No minimized modal found with the specified ID.");
    return;
  }
  const templateId = MODAL_TEMPLATES[entry.methodId];
  const templateEl = document.getElementById(templateId);
  if (!templateEl) {
    alert("Modal template not found.");
    return;
  }
  const clonedModal = templateEl.querySelector('.modal').cloneNode(true);
  clonedModal.dataset.modalId = modalId;
  clonedModal.dataset.methodName = entry.methodId;
  setModalFields(clonedModal, entry.fields);
  const textColumnSelect = clonedModal.querySelector('select[name="textColumn"]');
  if (textColumnSelect) {
    textColumnSelect.innerHTML = '';
    const placeholderOption = document.createElement('option');
    placeholderOption.value = '';
    placeholderOption.textContent = '--- Select Column ---';
    textColumnSelect.appendChild(placeholderOption);
    datasetColumns.forEach(col => {
      const option = document.createElement('option');
      option.value = col;
      option.textContent = col;
      textColumnSelect.appendChild(option);
    });
    if (entry.chosenCol) {
      textColumnSelect.value = entry.chosenCol;
    }
  }
  const previewSection = clonedModal.querySelector('.preview-section');
  if (previewSection && entry.previewContent) {
    previewSection.innerHTML = entry.previewContent;
  }
  modalBackdrop.appendChild(clonedModal);
  modalBackdrop.style.display = 'flex';
  initializeModalInteractions(clonedModal);
  randomizeModalPosition(clonedModal);
  const closeButton = clonedModal.querySelector('.close-btn');
  const minimizeButton = clonedModal.querySelector('.minimize-btn');
  const maximizeButton = clonedModal.querySelector('.maximize-btn');
  closeButton.onclick = () => closeModal(clonedModal);
  minimizeButton.onclick = () => minimizeModal(clonedModal, entry.methodId);
  maximizeButton.onclick = () => toggleMaximizeModal(clonedModal);
  const runButton = clonedModal.querySelector('.modal-footer .btn.run-btn');
  const downloadButton = clonedModal.querySelector('.modal-footer .btn.download-btn');
  if (runButton && downloadButton) {
    switch (entry.methodId) {
      case 'tfidf':
      case 'freq':
      case 'collocation':
        runButton.addEventListener('click', () => regenerateWordCloud(clonedModal, entry.methodId));
        downloadButton.addEventListener('click', () => downloadWordCloud(clonedModal, entry.methodId));
        break;
      case 'semanticwc':
        runButton.addEventListener('click', () => generateSemanticWordCloud(clonedModal));
        downloadButton.addEventListener('click', () => downloadWordCloud(clonedModal, entry.methodId));
        break;
      case 'lda':
      case 'nmf':
      case 'bertopic':
      case 'lsa':
        runButton.addEventListener('click', () => runTopicModeling(clonedModal, entry.methodId));
        downloadButton.addEventListener('click', () => downloadTopicModelingResults(clonedModal, entry.methodId));
        break;
      case 'rulebasedsa':
      case 'dlbasedsa':
      case 'absa':
      case 'zeroshotSentiment':
      case 'topicspecificwc':
        runButton.addEventListener('click', () => runSentimentAnalysis(clonedModal, entry.methodId));
        downloadButton.addEventListener('click', () => downloadSentimentAnalysisResults(clonedModal, entry.methodId));
        break;
      default:
        console.warn(`No run/download handlers defined for method ID: ${entry.methodId}`);
    }
  }
  if (entry.checkpoints && Array.isArray(entry.checkpoints)) {
    entry.checkpoints.forEach(checkpoint => {
      addCheckpointToModal(clonedModal, checkpoint);
    });
  }
  if (entry.trayLink) {
    entry.trayLink.remove();
    delete allModals[modalId].trayLink;
  }
  allModals[modalId].state = 'open';
  bringModalToFront(clonedModal);
}

function bringModalToFront(modalEl) {
  const allModalEls = document.querySelectorAll('.modal');
  let highestZIndex = 0;
  allModalEls.forEach(modal => {
    const zIndex = parseInt(window.getComputedStyle(modal).zIndex, 10) || 0;
    if (zIndex > highestZIndex) highestZIndex = zIndex;
  });
  modalEl.style.zIndex = highestZIndex + 1;
}

function toggleMaximizeModal(modalEl) {
  const modalId = modalEl.dataset.modalId;
  modalEl.classList.toggle('maximized');
  if (modalEl.classList.contains('maximized')) {
    modalEl.dataset.originalLeft = modalEl.style.left;
    modalEl.dataset.originalTop = modalEl.style.top;
    modalEl.dataset.originalWidth = modalEl.style.width;
    modalEl.dataset.originalHeight = modalEl.style.height;
    const backdropRect = modalBackdrop.getBoundingClientRect();
    modalEl.style.left = `0px`;
    modalEl.style.top = `0px`;
    modalEl.style.width = `${backdropRect.width}px`;
    modalEl.style.height = `${backdropRect.height}px`;
    if (allModals[modalId]) {
      allModals[modalId].state = 'maximized';
    }
  } else {
    modalEl.style.left = modalEl.dataset.originalLeft || '50%';
    modalEl.style.top = modalEl.dataset.originalTop || '50%';
    modalEl.style.width = modalEl.dataset.originalWidth || '40%';
    modalEl.style.height = modalEl.dataset.originalHeight || '60%';
    if (allModals[modalId]) {
      allModals[modalId].state = 'open';
    }
  }
}

async function regenerateWordCloud(modalEl, methodId) {
  try {
    const fields = getModalFields(modalEl);
    if (!fields.textColumn) {
      alert("Please select a text column.");
      return;
    }
    const payload = {
      method: methodId,
      base64: currentFileBase64,
      fileName: currentFileName,
      column: fields.textColumn,
      maxWords: parseInt(fields.maxWords) || 500,
      stopwords: !!fields.stopwords,
      excludeWords: fields.excludeWords ? fields.excludeWords.split(",").map(word => word.trim()).filter(word => word) : []
    };
    if (methodId === 'collocation') {
      payload.windowSize = parseInt(fields.windowSize) || 2;
    }
    showModalLoading(modalEl);
    const response = await fetch("/process/wordcloud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    hideModalLoading(modalEl);
    if (!response.ok) {
      alert(data.error || "Error generating word cloud.");
      return;
    }
    if (data.image) {
      const previewSection = modalEl.querySelector(".preview-section");
      previewSection.innerHTML = "";
      const img = document.createElement("img");
      img.src = data.image;
      img.alt = "Word Cloud Preview";
      previewSection.appendChild(img);
      const outputData = previewSection.innerHTML;
      const checkpointConfig = {
        methodId: methodId,
        fields: fields
      };
      createCheckpoint(modalEl, checkpointConfig, outputData);
    } else {
      alert(data.error || "No image returned from server.");
    }
  } catch (error) {
    hideModalLoading(modalEl);
    console.error(error);
    alert("Error generating word cloud: " + error.message);
  }
}

function downloadWordCloud(modalEl, methodId) {
  const previewSection = modalEl.querySelector(".preview-section");
  const img = previewSection.querySelector("img");
  if (!img || !img.src) {
    alert("No word cloud image available to download.");
    return;
  }
  const link = document.createElement('a');
  link.href = img.src;
  link.download = `${methodId}_word_cloud.png`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

async function generateSemanticWordCloud(modalEl) {
  try {
    const fields = getModalFields(modalEl);
    if (!fields.textColumn || !fields.query || !fields.embeddingModel) {
      alert("Please select a text column, enter a query, and specify the embedding model.");
      return;
    }
    const payload = {
      query: fields.query,
      embeddingModel: fields.embeddingModel,
      base64: currentFileBase64,
      fileName: currentFileName,
      column: fields.textColumn,
      maxWords: parseInt(fields.maxWords) || 500,
      stopwords: !!fields.stopwords,
      excludeWords: fields.excludeWords ? fields.excludeWords.split(",").map(word => word.trim()).filter(word => word) : []
    };
    showModalLoading(modalEl);
    const response = await fetch("/process/semantic_wordcloud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    hideModalLoading(modalEl);
    if (!response.ok) {
      alert(data.error || "Error generating semantic word cloud.");
      return;
    }
    if (data.image) {
      const previewSection = modalEl.querySelector(".preview-section");
      previewSection.innerHTML = "";
      const img = document.createElement("img");
      img.src = data.image;
      img.alt = "Semantic Word Cloud Preview";
      previewSection.appendChild(img);
      const outputData = previewSection.innerHTML;
      const checkpointConfig = {
        methodId: 'semanticwc',
        fields: fields
      };
      createCheckpoint(modalEl, checkpointConfig, outputData);
    } else {
      alert(data.error || "No image returned from server.");
    }
  } catch (error) {
    hideModalLoading(modalEl);
    console.error(error);
    alert("Error generating semantic word cloud: " + error.message);
  }
}

async function runTopicModeling(modalEl, methodId) {
    try {
      const fields = getModalFields(modalEl);
      if (!fields.textColumn) {
        alert("Please select a text column.");
        return;
      }
      const payload = {
        method: methodId,
        base64: currentFileBase64,
        column: fields.textColumn,
        numTopics: parseInt(fields.numTopics) || 5,
        wordsPerTopic: parseInt(fields.wordsPerTopic) || 5,
        randomState: parseInt(fields.randomState) || 42,
        stopwords: !!fields.stopwords,
        embeddingModel: fields.embeddingModel || ""
      };
      if (fields.coherence_analysis === "on" || fields.coherence_analysis === true) {
        payload.coherence_analysis = true;
        payload.min_topics = parseInt(fields.min_topics) || 2;
        payload.max_topics = parseInt(fields.max_topics) || (parseInt(fields.numTopics) || 5);
        payload.step = parseInt(fields.step) || 1;
      }
      showModalLoading(modalEl);
      const response = await fetch("/process/topic_modeling", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json();
      hideModalLoading(modalEl);
      if (!response.ok) {
        alert(data.error || "Error running topic modeling.");
        return;
      }
      const previewSection = modalEl.querySelector(".preview-section");
      previewSection.innerHTML = "";
  
      // Display extracted topics
      if (data.topics && Array.isArray(data.topics) && data.topics.length > 0) {
        const heading = document.createElement("h3");
        heading.textContent = "Extracted Topics:";
        previewSection.appendChild(heading);
        const list = document.createElement("ul");
        data.topics.forEach((topic, index) => {
          const listItem = document.createElement("li");
          listItem.textContent = `Topic ${index + 1}: ${topic}`;
          list.appendChild(listItem);
        });
        previewSection.appendChild(list);
      } else {
        const message = document.createElement("p");
        message.textContent = "No topics were extracted.";
        previewSection.appendChild(message);
      }
  
      // Display coherence analysis plot if available
      if (data.coherence_analysis) {
        const coherenceDiv = document.createElement("div");
        coherenceDiv.className = "coherence-analysis";
        coherenceDiv.style.marginTop = "1rem";
        const plotHeading = document.createElement("h4");
        plotHeading.textContent = "Coherence Analysis";
        coherenceDiv.appendChild(plotHeading);
        const plotImg = document.createElement("img");
        plotImg.src = data.coherence_analysis.coherence_plot;
        plotImg.alt = "Coherence Analysis Plot";
        plotImg.style.maxWidth = "100%";
        coherenceDiv.appendChild(plotImg);
        const bestInfo = document.createElement("p");
        bestInfo.textContent = `Best Coherence: ${data.coherence_analysis.best_coherence.toFixed(4)} at ${data.coherence_analysis.best_topic} topics.`;
        coherenceDiv.appendChild(bestInfo);
        previewSection.appendChild(coherenceDiv);
      }
  
      // NEW: Display clustering plot if available
      if (data.clustering_plot) {
        const clusteringHeading = document.createElement("h5");
        clusteringHeading.textContent = "Document Clustering (PC1 vs PC2):";
        clusteringHeading.style.marginTop = "1rem";
        previewSection.appendChild(clusteringHeading);
        const clusteringImg = document.createElement("img");
        clusteringImg.src = data.clustering_plot;
        clusteringImg.alt = "Clustering Plot (PC1 vs PC2)";
        clusteringImg.style.maxWidth = "100%";
        previewSection.appendChild(clusteringImg);
      }
  
      const outputData = previewSection.innerHTML;
      const checkpointConfig = {
        methodId: methodId,
        fields: fields
      };
      createCheckpoint(modalEl, checkpointConfig, outputData);
    } catch (error) {
      hideModalLoading(modalEl);
      console.error(error);
      alert("Error running topic modeling: " + error.message);
    }
  }
  
  
function downloadTopicModelingResults(modalEl, methodId) {
  const previewSection = modalEl.querySelector(".preview-section");
  const topics = previewSection.querySelector("ul");
  if (!topics) {
    alert("No topic modeling results available to download.");
    return;
  }
  const topicsArray = Array.from(topics.querySelectorAll("li")).map(li => li.textContent);
  const blob = new Blob([topicsArray.join("\n")], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${methodId}_topic_modeling_results.txt`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

async function runSentimentAnalysis(modalEl, methodId) {
  try {
    const fields = getModalFields(modalEl);
    if (!fields.textColumn) {
      alert("Please select a text column.");
      return;
    }
    const payload = {
      method: methodId,
      base64: currentFileBase64,
      fileType: currentFileName.toLowerCase().endsWith('.xlsx') ? 'xlsx' : 'csv',
      column: fields.textColumn,
    };
    switch (methodId) {
      case 'rulebasedsa':
        payload.ruleBasedModel = fields.ruleBasedModel || "textblob";
        break;
      case 'dlbasedsa':
        payload.dlModel = fields.dlModel || "distilbert-base-uncased-finetuned-sst-2-english";
        break;
      case 'absa':
        payload.aspect = fields.aspect || "";
        payload.model = fields.modelName || "llama3";
        break;
      case 'zeroshotSentiment':
        payload.model = fields.modelName || "llama3";
        break;
      default:
        console.warn(`No additional fields defined for method ID: ${methodId}`);
    }
    showModalLoading(modalEl);
    const endpointMap = {
      'rulebasedsa': "/process/sentiment",
      'dlbasedsa': "/process/sentiment",
      'absa': "/process/absa",
      'zeroshotSentiment': "/process/zero_shot_sentiment"
    };
    const endpoint = endpointMap[methodId] || "/process/sentiment";
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await response.json();
    hideModalLoading(modalEl);
    if (!response.ok) {
      alert(data.error || "Error running sentiment analysis.");
      return;
    }
    const previewSection = modalEl.querySelector(".preview-section");
    previewSection.innerHTML = "";
    if (methodId === 'absa') {
      renderABSAResults(previewSection, data);
    } else if (methodId === 'zeroshotSentiment') {
      renderZeroShotSentimentResults(previewSection, data);
    } else {
      renderOtherSentimentResults(previewSection, data);
    }
    const outputData = previewSection.innerHTML;
    const checkpointConfig = {
      methodId: methodId,
      fields: fields
    };
    createCheckpoint(modalEl, checkpointConfig, outputData);
  } catch (error) {
    hideModalLoading(modalEl);
    console.error(error);
    alert("Error running sentiment analysis: " + error.message);
  }
}

function renderABSAResults(previewSection, data) {
  if (data.results && Array.isArray(data.results) && data.results.length > 0) {
    const summaryHeading = document.createElement("h5");
    summaryHeading.textContent = "Sentiment Summary:";
    summaryHeading.style.marginTop = "1rem";
    previewSection.appendChild(summaryHeading);
    const sentimentCounts = data.results.reduce((acc, curr) => {
      acc[curr.sentiment] = (acc[curr.sentiment] || 0) + 1;
      return acc;
    }, {});
    const total = data.results.length;
    const sentiments = ["Positive", "Neutral", "Negative"];
    const summaryTable = document.createElement("table");
    summaryTable.className = "summary-table";
    summaryTable.style.marginBottom = "1rem";
    summaryTable.innerHTML = `
      <thead>
        <tr>
          <th>Sentiment</th>
          <th>Count</th>
          <th>Percentage</th>
        </tr>
      </thead>
      <tbody>
        ${sentiments.map(sentiment => `
          <tr>
            <td>${sentiment}</td>
            <td>${sentimentCounts[sentiment] || 0}</td>
            <td>${((sentimentCounts[sentiment] || 0) / total * 100).toFixed(2)}%</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    previewSection.appendChild(summaryTable);
    const detailedHeading = document.createElement("h5");
    detailedHeading.textContent = "Detailed Sentiment Results:";
    detailedHeading.style.marginTop = "1rem";
    previewSection.appendChild(detailedHeading);
    const table = document.createElement("table");
    table.className = "results-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Text</th>
          <th>Aspect</th>
          <th>Sentiment</th>
        </tr>
      </thead>
      <tbody>
        ${data.results.map(result => `
          <tr>
            <td>${escapeHtml(result.text)}</td>
            <td>${escapeHtml(result.aspect)}</td>
            <td>${result.sentiment}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    previewSection.appendChild(table);
  } else {
    const message = document.createElement("p");
    message.textContent = "No ABSA results available.";
    previewSection.appendChild(message);
  }
}

function renderZeroShotSentimentResults(previewSection, data) {
  previewSection.innerHTML = "";
  if (data.results && Array.isArray(data.results) && data.results.length > 0) {
    const summaryHeading = document.createElement("h5");
    summaryHeading.textContent = "Sentiment Summary:";
    summaryHeading.style.marginTop = "1rem";
    previewSection.appendChild(summaryHeading);
    const sentimentCounts = data.results.reduce((acc, curr) => {
      acc[curr.sentiment] = (acc[curr.sentiment] || 0) + 1;
      return acc;
    }, {});
    const total = data.results.length;
    const sentiments = ["Positive", "Neutral", "Negative"];
    const summaryTable = document.createElement("table");
    summaryTable.className = "summary-table";
    summaryTable.style.marginBottom = "1rem";
    summaryTable.innerHTML = `
      <thead>
        <tr>
          <th>Sentiment</th>
          <th>Count</th>
          <th>Percentage</th>
        </tr>
      </thead>
      <tbody>
        ${sentiments.map(sentiment => `
          <tr>
            <td>${sentiment}</td>
            <td>${sentimentCounts[sentiment] || 0}</td>
            <td>${((sentimentCounts[sentiment] || 0) / total * 100).toFixed(2)}%</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    previewSection.appendChild(summaryTable);
    if (data.chart) {
      const chartHeading = document.createElement("h5");
      chartHeading.textContent = "Sentiment Distribution Chart:";
      chartHeading.style.marginTop = "1rem";
      previewSection.appendChild(chartHeading);
      const chartImg = document.createElement("img");
      chartImg.src = data.chart;
      chartImg.alt = "Sentiment Distribution Chart";
      chartImg.style.maxWidth = "100%";
      previewSection.appendChild(chartImg);
    }
    const detailedHeading = document.createElement("h5");
    detailedHeading.textContent = "Zero-Shot Sentiment Analysis Results:";
    detailedHeading.style.marginTop = "1rem";
    previewSection.appendChild(detailedHeading);
    const table = document.createElement("table");
    table.className = "results-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Text</th>
          <th>Sentiment</th>
        </tr>
      </thead>
      <tbody>
        ${data.results.map(result => `
          <tr>
            <td>${escapeHtml(result.text)}</td>
            <td>${result.sentiment}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    previewSection.appendChild(table);
  } else {
    const message = document.createElement("p");
    message.textContent = "No sentiment analysis results available.";
    previewSection.appendChild(message);
  }
}

function renderOtherSentimentResults(previewSection, data) {
  previewSection.innerHTML = "";
  if (data.stats) {
    const detailedHeading = document.createElement("h5");
    detailedHeading.textContent = "Sentiment Analysis Results:";
    detailedHeading.style.marginTop = "1rem";
    previewSection.appendChild(detailedHeading);
    const table = document.createElement("table");
    table.className = "results-table";
    table.innerHTML = `
      <thead>
        <tr>
          <th>Sentiment</th>
          <th>Count</th>
          <th>Average Score</th>
        </tr>
      </thead>
      <tbody>
        ${Object.entries(data.stats).map(([sentiment, values]) => `
          <tr>
            <td>${sentiment}</td>
            <td>${values.Count}</td>
            <td>${values["Average Score"] !== null ? values["Average Score"] : "N/A"}</td>
          </tr>
        `).join('')}
      </tbody>
    `;
    previewSection.appendChild(table);
    if (data.chart) {
      const chartHeading = document.createElement("h5");
      chartHeading.textContent = "Sentiment Distribution Chart:";
      chartHeading.style.marginTop = "1rem";
      previewSection.appendChild(chartHeading);
      const chartImg = document.createElement("img");
      chartImg.src = data.chart;
      chartImg.alt = "Sentiment Distribution Chart";
      chartImg.style.maxWidth = "100%";
      previewSection.appendChild(chartImg);
    }
  } else {
    const message = document.createElement("p");
    message.textContent = "No sentiment analysis results available.";
    previewSection.appendChild(message);
  }
}

function escapeHtml(unsafe) {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function downloadSentimentAnalysisResults(modalEl, methodId) {
  const previewSection = modalEl.querySelector(".preview-section");
  const table = previewSection.querySelector("table");
  if (!table) {
    alert("No sentiment analysis results available to download.");
    return;
  }
  const csvRows = [];
  const headers = Array.from(table.querySelectorAll("thead th")).map(th => th.textContent);
  csvRows.push(headers.join(","));
  const rows = table.querySelectorAll("tbody tr");
  rows.forEach(row => {
    const cols = row.querySelectorAll("td");
    const sentiment = cols[0].textContent;
    const count = cols[1].textContent;
    const avgScore = cols[2].textContent;
    csvRows.push(`${sentiment},${count},${avgScore}`);
  });
  const csvContent = csvRows.join("\n");
  const blob = new Blob([csvContent], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${methodId}_sentiment_analysis_results.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

modalBackdrop.addEventListener('click', function (event) {
  if (event.target === this) {
    const modals = this.querySelectorAll('.modal');
    if (modals.length > 0) {
      const lastModal = modals[modals.length - 1];
      const methodId = lastModal.dataset.methodName;
      minimizeModal(lastModal, methodId);
    }
  }
});

const originalBodyOverflow = document.body.style.overflow;
modalBackdrop.addEventListener('transitionstart', () => {
  if (modalBackdrop.style.display === 'flex') {
    document.body.style.overflow = 'hidden';
  }
});
modalBackdrop.addEventListener('transitionend', () => {
  if (modalBackdrop.style.display !== 'flex') {
    document.body.style.overflow = originalBodyOverflow;
  }
});

let sessionKey = "";
async function generateKeyFromPassword(password) {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );
  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: encoder.encode("Semantic-Sapience-proj"),
      iterations: 100000,
      hash: "SHA-256",
    },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    true,
    ["encrypt", "decrypt"]
  );
}

async function encryptData(data) {
  const encoder = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encryptedData = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    sessionKey,
    encoder.encode(data)
  );
  return { encryptedData, iv };
}

async function decryptData(encryptedData, iv, key = null) {
  const decryptionKey = key || sessionKey;
  const decoder = new TextDecoder();
  const decryptedData = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    decryptionKey,
    encryptedData
  );
  return decoder.decode(decryptedData);
}

async function closeWelcomeOverlay() {
  const password = document.getElementById("sessionPassword").value;
  if (!password) {
    alert("Please enter a session password.");
    return;
  }
  sessionKey = await generateKeyFromPassword(password);
  alert("Session key initialized:" + sessionKey);
  document.querySelector(".welcome-overlay").style.display = "none";
}

async function fetchSystemStats() {
  try {
    const response = await fetch('/system_stats');
    if (!response.ok) {
      console.error('Failed to fetch system stats:', response.statusText);
      return;
    }
    const stats = await response.json();
    const cpuUtilization = stats.cpu_utilization_percent;
    document.getElementById('cpuUtilizationText').textContent = `${cpuUtilization}%`;
    updateProgressBar('cpuUtilizationBar', cpuUtilization, 'cpu');
    const ramUtilization = stats.ram_utilization_percent;
    document.getElementById('ramUtilizationText').textContent = `${ramUtilization}%`;
    updateProgressBar('ramUtilizationBar', ramUtilization, 'ram');
  } catch (error) {
    console.error('Error fetching system stats:', error);
  }
}

function updateProgressBar(barId, value, type) {
  const progressBar = document.getElementById(barId);
  if (!progressBar) return;
  progressBar.style.width = `${value}%`;
}

function initializeSystemStats() {
  fetchSystemStats();
  setInterval(fetchSystemStats, 2000);
}
